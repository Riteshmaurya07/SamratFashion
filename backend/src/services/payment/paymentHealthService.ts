/**
 * Payment operations health report.
 *
 * Answers the questions that matter when a payment or refund "gets stuck":
 *   - Is there money captured at the gateway that we have not applied locally?
 *   - Are refunds holding a reservation or waiting for a webhook?
 *   - Are webhooks failing and is anything retrying them?
 *   - Is the recovery loop actually running in this deployment?
 *
 * This is read-only. It never mutates payment, refund, or webhook state.
 */

import { Order } from '../../models/Order';
import { Payment } from '../../models/Payment';
import { PaymentAttempt } from '../../models/PaymentAttempt';
import { Refund } from '../../models/Refund';
import { WebhookEvent } from '../../models/WebhookEvent';
import { InventoryTransaction } from '../../models/InventoryTransaction';
import { RecoveryStatus } from '../../models/RecoveryStatus';

const DEFAULT_STUCK_AFTER_MS = 15 * 60_000;
const DEFAULT_ORDER_STUCK_AFTER_MS = 30 * 60_000;
const DEFAULT_RECOVERY_STALE_AFTER_MS = 10 * 60_000;

export interface PaymentHealthOptions {
  /** Reference time; defaults to now. Useful for tests and incident replay. */
  now?: Date;
  /** Age after which an in-flight payment attempt / refund is considered stuck. */
  stuckAfterMs?: number;
  /** Age after which an unpaid order is considered abandoned/stuck. */
  orderStuckAfterMs?: number;
  /** Age after which the last recovery cycle is considered stale. */
  recoveryStaleAfterMs?: number;
}

export interface PaymentHealthSample {
  id: string;
  status?: string;
  updatedAt?: string;
  createdAt?: string;
  detail?: string;
}

export interface PaymentHealthReport {
  generatedAt: string;
  status: 'ok' | 'degraded' | 'critical';
  alerts: string[];
  windows: {
    stuckAfterMinutes: number;
    orderStuckAfterMinutes: number;
    recoveryStaleAfterMinutes: number;
  };
  payments: {
    stuckAttempts: number;
    stuckOrders: number;
    reconciliationRequired: number;
    samples: {
      stuckAttempts: PaymentHealthSample[];
      stuckOrders: PaymentHealthSample[];
    };
  };
  refunds: {
    stuck: number;
    processing: number;
    failedRetryable: number;
    unknown: number;
    reconciliationRequired: number;
    processedButUnsettled: number;
    paymentsWithPendingReservations: number;
    samples: {
      stuck: PaymentHealthSample[];
      reconciliationRequired: PaymentHealthSample[];
    };
  };
  webhooks: {
    failed: number;
    staleProcessing: number;
    samples: {
      failed: PaymentHealthSample[];
    };
  };
  recovery: {
    schedulerMode: 'embedded' | 'external';
    embeddedSchedulerEnabled: boolean;
    lastRunStatus: string | null;
    lastRunCompletedAt: string | null;
    lastRunAgeSeconds: number | null;
    stale: boolean;
    pendingInventory: number;
    pendingCancellations: number;
  };
  configuration: {
    nodeEnv: string;
    serverlessHint: boolean;
    razorpayKeyIdConfigured: boolean;
    razorpayKeySecretConfigured: boolean;
    webhookSecretConfigured: boolean;
    paymentMockAllowed: boolean;
    opsSecretConfigured: boolean;
    embeddedRecoveryDisabled: boolean;
  };
}

function isStrictEnvironment(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
}

function looksServerless(): boolean {
  return Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY ||
    process.env.CF_PAGES
  );
}

function toSample(doc: any, detail?: string): PaymentHealthSample {
  return {
    id: String(doc?._id ?? ''),
    status: doc?.status,
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
    createdAt: doc?.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
    detail,
  };
}

export async function getPaymentHealthReport(
  options: PaymentHealthOptions = {}
): Promise<PaymentHealthReport> {
  const now = options.now ?? new Date();
  const stuckAfterMs = options.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
  const orderStuckAfterMs = options.orderStuckAfterMs ?? DEFAULT_ORDER_STUCK_AFTER_MS;
  const recoveryStaleAfterMs = options.recoveryStaleAfterMs ?? DEFAULT_RECOVERY_STALE_AFTER_MS;

  const stuckCutoff = new Date(now.getTime() - stuckAfterMs);
  const orderCutoff = new Date(now.getTime() - orderStuckAfterMs);

  const [
    stuckAttempts,
    stuckOrders,
    paymentsReconciliation,
    stuckRefunds,
    processingRefunds,
    failedRefunds,
    unknownRefunds,
    reconciliationRefunds,
    processedButUnsettled,
    paymentsWithPendingReservations,
    failedWebhooks,
    staleProcessingWebhooks,
    pendingInventory,
    pendingCancellations,
    recoveryState,
    stuckAttemptSamples,
    stuckOrderSamples,
    stuckRefundSamples,
    reconciliationSamples,
    failedWebhookSamples,
  ] = await Promise.all([
    PaymentAttempt.countDocuments({
      status: { $in: ['PENDING', 'PROCESSING'] },
      updatedAt: { $lt: stuckCutoff },
    }),
    Order.countDocuments({
      status: 'PENDING',
      paymentStatus: 'PENDING',
      createdAt: { $lt: orderCutoff },
    }),
    Payment.countDocuments({ reconciliationRequired: true }),
    Refund.countDocuments({
      status: { $in: ['PENDING', 'PROCESSING'] },
      updatedAt: { $lt: stuckCutoff },
    }),
    Refund.countDocuments({ status: 'PROCESSING' }),
    Refund.countDocuments({ status: 'FAILED' }),
    Refund.countDocuments({ status: 'UNKNOWN' }),
    Refund.countDocuments({ accountingSettlementStatus: 'RECONCILIATION_REQUIRED' }),
    Refund.countDocuments({
      status: 'PROCESSED',
      accountingSettlementStatus: { $in: ['PENDING', 'RECONCILIATION_REQUIRED'] },
    }),
    Payment.countDocuments({ 'refundReservations.status': 'PENDING' }),
    WebhookEvent.countDocuments({ status: 'FAILED' }),
    WebhookEvent.countDocuments({
      status: 'PROCESSING',
      processingLockExpiresAt: { $lt: now },
    }),
    InventoryTransaction.countDocuments({ type: 'RETURN', status: 'PENDING' }),
    Order.countDocuments({ 'cancellationOperations.status': 'PENDING' }),
    RecoveryStatus.findOne({ identifier: 'SINGLETON' }).lean(),
    PaymentAttempt.find({
      status: { $in: ['PENDING', 'PROCESSING'] },
      updatedAt: { $lt: stuckCutoff },
    })
      .sort({ updatedAt: 1 })
      .limit(5)
      .select('_id status updatedAt createdAt')
      .lean(),
    Order.find({
      status: 'PENDING',
      paymentStatus: 'PENDING',
      createdAt: { $lt: orderCutoff },
    })
      .sort({ createdAt: 1 })
      .limit(5)
      .select('_id status paymentStatus createdAt')
      .lean(),
    Refund.find({
      status: { $in: ['PENDING', 'PROCESSING'] },
      updatedAt: { $lt: stuckCutoff },
    })
      .sort({ updatedAt: 1 })
      .limit(5)
      .select('_id status submissionState accountingSettlementStatus updatedAt')
      .lean(),
    Refund.find({ accountingSettlementStatus: 'RECONCILIATION_REQUIRED' })
      .sort({ updatedAt: 1 })
      .limit(5)
      .select('_id status accountingSettlementStatus updatedAt')
      .lean(),
    WebhookEvent.find({ status: 'FAILED' })
      .sort({ updatedAt: 1 })
      .limit(5)
      .select('_id eventId eventType processingAttempts updatedAt')
      .lean(),
  ]);

  const embeddedRecoveryEnabled = process.env.DISABLE_EMBEDDED_RECOVERY !== 'true';
  const embeddedRecoveryEnabledInServerless = embeddedRecoveryEnabled && looksServerless();

  const lastRunCompletedAt = recoveryState?.lastRunCompletedAt
    ? new Date(recoveryState.lastRunCompletedAt)
    : null;
  const lastRunAgeSeconds = lastRunCompletedAt
    ? Math.max(0, Math.round((now.getTime() - lastRunCompletedAt.getTime()) / 1000))
    : null;
  const recoveryStale = lastRunAgeSeconds === null || lastRunAgeSeconds * 1000 > recoveryStaleAfterMs;

  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const strict = isStrictEnvironment();

  const configuration: PaymentHealthReport['configuration'] = {
    nodeEnv: process.env.NODE_ENV || 'development',
    serverlessHint: looksServerless(),
    razorpayKeyIdConfigured: Boolean(keyId && !keyId.toLowerCase().includes('dummy')),
    razorpayKeySecretConfigured: Boolean(keySecret && !keySecret.toLowerCase().includes('dummy')),
    webhookSecretConfigured: Boolean(webhookSecret),
    paymentMockAllowed: process.env.ALLOW_PAYMENT_MOCK === 'true',
    opsSecretConfigured: Boolean((process.env.OPS_SECRET || '').length >= 16),
    embeddedRecoveryDisabled: !embeddedRecoveryEnabled,
  };

  const critical: string[] = [];
  const degraded: string[] = [];

  if (paymentsReconciliation > 0) {
    critical.push(
      `${paymentsReconciliation} payment(s) have reconciliationRequired=true: a capture is recorded but not safely applied to an order.`
    );
  }
  if (reconciliationRefunds > 0) {
    critical.push(
      `${reconciliationRefunds} refund(s) have accountingSettlementStatus=RECONCILIATION_REQUIRED and need manual verification against the gateway.`
    );
  }
  if (unknownRefunds > 0) {
    critical.push(
      `${unknownRefunds} refund(s) are UNKNOWN: the gateway outcome is not confirmed. Do not retry until reconciled.`
    );
  }
  if (processedButUnsettled > 0) {
    critical.push(
      `${processedButUnsettled} refund(s) are PROCESSED but not accounting-complete: the money left the gateway but the local ledger is not settled.`
    );
  }
  if (recoveryStale) {
    critical.push(
      lastRunCompletedAt
        ? `Recovery has not completed for ${lastRunAgeSeconds}s (threshold ${Math.round(recoveryStaleAfterMs / 1000)}s).`
        : 'Recovery has never completed a cycle in this database.'
    );
  }
  if (embeddedRecoveryEnabledInServerless) {
    critical.push(
      'Embedded recovery scheduler is enabled in a serverless environment; setInterval is frozen between requests, so stuck payments/refunds will not be recovered.'
    );
  }
  if (strict && !configuration.webhookSecretConfigured) {
    critical.push('RAZORPAY_WEBHOOK_SECRET is not configured in a production/staging environment.');
  }
  if (strict && !configuration.razorpayKeySecretConfigured) {
    critical.push('RAZORPAY_KEY_SECRET is not configured in a production/staging environment.');
  }
  if (strict && !configuration.razorpayKeyIdConfigured) {
    critical.push('RAZORPAY_KEY_ID is not configured in a production/staging environment.');
  }
  if (strict && !configuration.opsSecretConfigured) {
    critical.push(
      'OPS_SECRET is not configured (min 16 chars); payment health and external recovery endpoints are disabled.'
    );
  }
  if (strict && configuration.paymentMockAllowed) {
    critical.push('ALLOW_PAYMENT_MOCK=true is forbidden in production/staging.');
  }

  if (stuckRefunds > 0) {
    degraded.push(`${stuckRefunds} refund(s) have been PENDING/PROCESSING longer than the stuck threshold.`);
  }
  if (stuckAttempts > 0) {
    degraded.push(`${stuckAttempts} payment attempt(s) have been in flight longer than the stuck threshold.`);
  }
  if (stuckOrders > 0) {
    degraded.push(`${stuckOrders} order(s) are still unpaid after the abandoned-order threshold.`);
  }
  if (failedWebhooks > 0) {
    (recoveryStale ? critical : degraded).push(
      `${failedWebhooks} webhook event(s) are in FAILED state and depend on recovery replay.`
    );
  }
  if (staleProcessingWebhooks > 0) {
    degraded.push(
      `${staleProcessingWebhooks} webhook event(s) are PROCESSING with an expired lease and will be reclaimed.`
    );
  }
  if (paymentsWithPendingReservations > 0) {
    degraded.push(
      `${paymentsWithPendingReservations} payment(s) hold a PENDING refund reservation.`
    );
  }
  if (pendingInventory > 0) {
    degraded.push(`${pendingInventory} inventory restoration transaction(s) are still PENDING.`);
  }
  if (pendingCancellations > 0) {
    degraded.push(`${pendingCancellations} cancellation operation(s) are still PENDING.`);
  }
  if (!configuration.opsSecretConfigured) {
    degraded.push(
      'OPS_SECRET is not configured (min 16 chars); /api/ops health and cron endpoints are disabled.'
    );
  }

  const status: PaymentHealthReport['status'] =
    critical.length > 0 ? 'critical' : degraded.length > 0 ? 'degraded' : 'ok';

  return {
    generatedAt: now.toISOString(),
    status,
    alerts: [...critical, ...degraded],
    windows: {
      stuckAfterMinutes: Math.round(stuckAfterMs / 60_000),
      orderStuckAfterMinutes: Math.round(orderStuckAfterMs / 60_000),
      recoveryStaleAfterMinutes: Math.round(recoveryStaleAfterMs / 60_000),
    },
    payments: {
      stuckAttempts,
      stuckOrders,
      reconciliationRequired: paymentsReconciliation,
      samples: {
        stuckAttempts: stuckAttemptSamples.map((doc: any) => toSample(doc)),
        stuckOrders: stuckOrderSamples.map((doc: any) =>
          toSample(doc, `paymentStatus=${doc?.paymentStatus ?? 'unknown'}`)
        ),
      },
    },
    refunds: {
      stuck: stuckRefunds,
      processing: processingRefunds,
      failedRetryable: failedRefunds,
      unknown: unknownRefunds,
      reconciliationRequired: reconciliationRefunds,
      processedButUnsettled,
      paymentsWithPendingReservations,
      samples: {
        stuck: stuckRefundSamples.map((doc: any) =>
          toSample(doc, `submission=${doc?.submissionState ?? 'none'}`)
        ),
        reconciliationRequired: reconciliationSamples.map((doc: any) => toSample(doc)),
      },
    },
    webhooks: {
      failed: failedWebhooks,
      staleProcessing: staleProcessingWebhooks,
      samples: {
        failed: failedWebhookSamples.map((doc: any) =>
          toSample(doc, `${doc?.eventType ?? 'unknown'} attempts=${doc?.processingAttempts ?? 0}`)
        ),
      },
    },
    recovery: {
      schedulerMode: embeddedRecoveryEnabled ? 'embedded' : 'external',
      embeddedSchedulerEnabled: embeddedRecoveryEnabled,
      lastRunStatus: recoveryState?.status ?? null,
      lastRunCompletedAt: lastRunCompletedAt ? lastRunCompletedAt.toISOString() : null,
      lastRunAgeSeconds,
      stale: recoveryStale,
      pendingInventory,
      pendingCancellations,
    },
    configuration,
  };
}
