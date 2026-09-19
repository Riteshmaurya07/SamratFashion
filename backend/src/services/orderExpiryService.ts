import { Order } from '../models/Order';
import { PaymentAttempt } from '../models/PaymentAttempt';

export const ORDER_EXPIRY_MS = Number(process.env.ORDER_EXPIRY_MS) || 15 * 60 * 1000;
export const ORDER_EXPIRY_INTERVAL_MS =
  Number(process.env.ORDER_EXPIRY_INTERVAL_MS) || 5 * 60 * 1000;

const IN_FLIGHT_STATUSES = ['AUTHORIZED', 'PROCESSING', 'CAPTURED'];

/**
 * Expire PENDING orders older than ORDER_EXPIRY_MS whose payment never started.
 *
 * Design notes:
 * - Stock is only ever decremented at payment capture (SALE InventoryTransaction inside
 *   processPaymentSuccess), so an unpaid PENDING order holds NO inventory reservation.
 *   The reaper therefore only does expiry bookkeeping and never touches product stock;
 *   restoring stock here would risk double-decrements against a concurrently capturing
 *   payment.
 * - Orders with an in-flight PaymentAttempt (AUTHORIZED / PROCESSING / CAPTURED) are
 *   left alone, as are orders already paid or confirmed.
 * - Each order is flipped with an atomic guard that re-checks status/paymentStatus so a
 *   payment that captures between selection and update is never overwritten.
 */
export async function expireStalePendingOrders(): Promise<{ expired: number }> {
  const cutoff = new Date(Date.now() - ORDER_EXPIRY_MS);

  const candidates = await Order.aggregate([
    { $match: { status: 'PENDING', paymentStatus: 'PENDING', updatedAt: { $lte: cutoff } } },
    {
      $lookup: {
        from: 'paymentattempts',
        localField: '_id',
        foreignField: 'orderId',
        as: 'attempts',
      },
    },
    {
      $match: {
        attempts: { $not: { $elemMatch: { status: { $in: IN_FLIGHT_STATUSES } } } },
      },
    },
    { $project: { _id: 1 } },
  ]);

  let expired = 0;
  for (const candidate of candidates) {
    const res = await Order.updateOne(
      { _id: candidate._id, status: 'PENDING', paymentStatus: 'PENDING' },
      { $set: { status: 'EXPIRED', paymentStatus: 'FAILED' } }
    );
    // A concurrent capture/update already moved this order to a paying state; skip.
    if (res.modifiedCount !== 1) continue;

    expired += 1;

    await PaymentAttempt.updateMany(
      { orderId: candidate._id, status: 'PENDING' },
      {
        $set: {
          status: 'FAILED',
          failureCode: 'PAYMENT_EXPIRED',
          failureReason: 'Order expired after 15 minutes without payment',
        },
      }
    );
  }

  return { expired };
}

// ---------------------------------------------------------------------------
// Scheduler (not started under NODE_ENV=test so suites drive the reaper directly)
// ---------------------------------------------------------------------------

let schedulerTimer: NodeJS.Timeout | null = null;

export function startOrderExpiryScheduler(): void {
  if (schedulerTimer) return;
  if (process.env.NODE_ENV === 'test') return;

  const run = async (): Promise<void> => {
    try {
      const { expired } = await expireStalePendingOrders();
      if (expired > 0) {
        console.warn(`[ORDER_EXPIRY] Expired ${expired} stale pending order(s)`);
      }
    } catch (err) {
      console.error('[ORDER_EXPIRY] Reaper run failed:', err);
    }
  };

  run();
  schedulerTimer = setInterval(run, ORDER_EXPIRY_INTERVAL_MS);
  if (typeof (schedulerTimer as any).unref === 'function') {
    (schedulerTimer as any).unref();
  }
}

export function stopOrderExpiryScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}