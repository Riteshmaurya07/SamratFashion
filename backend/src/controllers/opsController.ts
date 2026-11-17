import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { getPaymentHealthReport } from '../services/payment/paymentHealthService';
import { RecoveryCoordinatorService } from '../services/recovery/recoveryCoordinatorService';

/**
 * GET /api/ops/payments/health
 *
 * Returns 503 when the report is critical so uptime monitors can alert without
 * parsing the body. The body always contains the full diagnosis.
 */
export const getPaymentHealth = catchAsync(async (_req: Request, res: Response) => {
  const report = await getPaymentHealthReport();
  res.status(report.status === 'critical' ? 503 : 200).json({
    success: report.status !== 'critical',
    data: report,
  });
});

/**
 * GET|POST /api/ops/recovery/run
 *
 * Runs exactly one coordinated recovery cycle. Safe to call repeatedly: the
 * distributed lease makes concurrent invocations no-ops and every step is
 * idempotent. This is the serverless replacement for the embedded scheduler.
 */
export const runRecoveryCycle = catchAsync(async (req: Request, res: Response) => {
  const raw =
    (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).batchLimit : undefined) ??
    req.query.batchLimit;

  const parsed = Number(raw);
  const batchLimit = Number.isFinite(parsed)
    ? Math.min(Math.max(Math.trunc(parsed), 1), 100)
    : 20;

  const report = await RecoveryCoordinatorService.executeCoordinatedRecoveryCycle({ batchLimit });
  res.status(200).json({
    success: true,
    data: report,
  });
});
