import mongoose from "mongoose";
import { Coupon, CouponStatus } from "../../models/Coupon";
import { CouponUsage, CouponUsageStatus, ICouponUsage } from "../../models/CouponUsage";
import { AppError } from "../../utils/AppError";

const ORDER_EXPIRY_MS = Number(process.env.ORDER_EXPIRY_MS) || 15 * 60 * 1000;

export interface ReserveCouponParams {
  couponId: mongoose.Types.ObjectId | string;
  userId: mongoose.Types.ObjectId | string;
  orderId: mongoose.Types.ObjectId | string;
  discountAmount: number;
  session?: mongoose.ClientSession;
}

export interface CouponReservationResult {
  reservation: ICouponUsage;
  couponCode: string;
  slot: number;
}

export interface ReconcileCountersResult {
  couponId: string;
  code: string;
  previousReserved: number;
  reconciledReserved: number;
  previousUsed: number;
  confirmedUsageCount: number;
  adjusted: boolean;
}

function isMongoDuplicateKeyError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    err.code === 11000
  );
}

export function isTransactionSupported(conn: mongoose.Connection = mongoose.connection): boolean {
  if (conn.readyState !== 1) return false;
  const topology = (conn as unknown as { client?: { topology?: { description?: { type?: string; setName?: string | null } } } })?.client?.topology?.description;
  if (!topology) return false;
  return Boolean(topology.setName) || topology.type === 'ReplicaSetWithPrimary' || topology.type === 'Sharded';
}
/**
 * Reconciles Coupon.reservedCount against the ground truth of active RESERVED records.
 * Observable self-healing mechanism that detects and corrects any counter discrepancies.
 */
export async function reconcileCouponCounters(
  couponId: mongoose.Types.ObjectId | string,
  session?: mongoose.ClientSession
): Promise<ReconcileCountersResult> {
  const couponObjId = new mongoose.Types.ObjectId(couponId.toString());
  const now = new Date();

  const coupon = await Coupon.findById(couponObjId).session(session || null);
  if (!coupon) {
    throw new AppError("Coupon not found for reconciliation", 404, "COUPON_NOT_FOUND");
  }

  const activeReservationsCount = await CouponUsage.countDocuments({
    couponId: couponObjId,
    status: CouponUsageStatus.RESERVED,
    expiresAt: { $gt: now },
  }).session(session || null);

  const confirmedUsageCount = await CouponUsage.countDocuments({
    couponId: couponObjId,
    status: CouponUsageStatus.CONFIRMED,
  }).session(session || null);

  const previousReserved = coupon.reservedCount || 0;
  const previousUsed = coupon.usedCount || 0;
  let adjusted = false;

  const updateSet: Record<string, number> = {};

  if (previousReserved !== activeReservationsCount) {
    updateSet.reservedCount = activeReservationsCount;
    adjusted = true;
  }

  if (confirmedUsageCount > previousUsed) {
    updateSet.usedCount = confirmedUsageCount;
    adjusted = true;
  }

  if (adjusted) {
    await Coupon.updateOne(
      { _id: couponObjId },
      { $set: updateSet },
      { session: session || undefined }
    );

    console.warn(
      JSON.stringify({
        level: "WARN",
        event: "COUPON_COUNTERS_RECONCILED",
        couponId: couponObjId.toString(),
        code: coupon.code,
        previousReserved,
        reconciledReserved: activeReservationsCount,
        previousUsed,
        confirmedUsageCount,
      })
    );
  }

  return {
    couponId: couponObjId.toString(),
    code: coupon.code,
    previousReserved,
    reconciledReserved: activeReservationsCount,
    previousUsed,
    confirmedUsageCount,
    adjusted,
  };
}

/**
 * Counts active redemptions and non-expired reservations for a user on a given coupon.
 */
export async function getActiveUserCouponUsageCount(
  couponId: mongoose.Types.ObjectId | string,
  userId: mongoose.Types.ObjectId | string,
  session?: mongoose.ClientSession
): Promise<number> {
  const couponObjId = new mongoose.Types.ObjectId(couponId.toString());
  const userObjId = new mongoose.Types.ObjectId(userId.toString());
  const now = new Date();

  return CouponUsage.countDocuments({
    couponId: couponObjId,
    userId: userObjId,
    status: { $in: [CouponUsageStatus.RESERVED, CouponUsageStatus.CONFIRMED] },
    $or: [
      { status: CouponUsageStatus.CONFIRMED },
      { status: CouponUsageStatus.RESERVED, expiresAt: { $gt: now } },
    ],
  }).session(session || null);
}

/**
 * Internal core execution of coupon reservation.
 */
async function executeReservationCore(
  params: ReserveCouponParams,
  session?: mongoose.ClientSession
): Promise<CouponReservationResult> {
  const { couponId, userId, orderId, discountAmount } = params;

  const couponObjId = new mongoose.Types.ObjectId(couponId.toString());
  const userObjId = new mongoose.Types.ObjectId(userId.toString());
  const orderObjId = new mongoose.Types.ObjectId(orderId.toString());

  // 1. Fetch Coupon
  const coupon = await Coupon.findById(couponObjId).session(session || null);
  if (!coupon) {
    throw new AppError("Invalid coupon code", 400, "COUPON_NOT_FOUND");
  }

  if (coupon.status !== CouponStatus.ACTIVE) {
    throw new AppError("Coupon is no longer active", 400, "COUPON_INACTIVE");
  }

  const now = new Date();
  if (coupon.startsAt && now < new Date(coupon.startsAt)) {
    throw new AppError("Coupon is not active yet", 400, "COUPON_NOT_STARTED");
  }

  if (coupon.expiresAt && now > new Date(coupon.expiresAt)) {
    throw new AppError("Coupon has expired", 400, "COUPON_EXPIRED");
  }

  // 2. Self-heal / clean expired reservations for this user and coupon
  const expiredForUser = await CouponUsage.find({
    couponId: couponObjId,
    userId: userObjId,
    status: CouponUsageStatus.RESERVED,
    expiresAt: { $lte: now },
  }).session(session || null);

  for (const exp of expiredForUser) {
    await releaseCouponReservation(exp.orderId, "RESERVATION_EXPIRED", session);
  }

  // 3. Global usage limit check and atomic reservation increment on Coupon
  const updateQuery: Record<string, unknown> = {
    _id: couponObjId,
    status: CouponStatus.ACTIVE,
  };

  if (coupon.usageLimit) {
    updateQuery.$expr = {
      $lt: [
        { $add: ["$usedCount", { $ifNull: ["$reservedCount", 0] }] },
        coupon.usageLimit,
      ],
    };
  }

  const claimRes = await Coupon.updateOne(
    updateQuery,
    { $inc: { reservedCount: 1 } },
    { session: session || undefined }
  );

  if (claimRes.modifiedCount === 0) {
    if (coupon.usageLimit) {
      throw new AppError("Coupon usage limit has been reached", 400, "COUPON_LIMIT_REACHED");
    }
    throw new AppError("Coupon is no longer active", 400, "COUPON_INACTIVE");
  }

  // 4. Per-user usage limit enforcement and slot assignment
  const perUserLimit = coupon.perUserUsageLimit || 1;

  try {
    const activeUsages = await CouponUsage.find({
      couponId: couponObjId,
      userId: userObjId,
      status: { $in: [CouponUsageStatus.RESERVED, CouponUsageStatus.CONFIRMED] },
      $or: [
        { status: CouponUsageStatus.CONFIRMED },
        { status: CouponUsageStatus.RESERVED, expiresAt: { $gt: now } },
      ],
    }).session(session || null);

    if (activeUsages.length >= perUserLimit) {
      throw new AppError(
        "You have already used or reserved this coupon maximum allowed times",
        400,
        "COUPON_USER_LIMIT_REACHED"
      );
    }

    const occupiedSlots = new Set(activeUsages.map((u) => u.usageSlot));
    const availableSlots: number[] = [];
    for (let slot = 1; slot <= perUserLimit; slot++) {
      if (!occupiedSlots.has(slot)) {
        availableSlots.push(slot);
      }
    }

    if (availableSlots.length === 0) {
      throw new AppError(
        "You have already used or reserved this coupon maximum allowed times",
        400,
        "COUPON_USER_LIMIT_REACHED"
      );
    }

    const expiresAt = new Date(Date.now() + ORDER_EXPIRY_MS);
    let createdUsage: ICouponUsage | null = null;
    let lastError: unknown = null;

    for (const slot of availableSlots) {
      try {
        const [usageDoc] = await CouponUsage.create(
          [
            {
              couponId: couponObjId,
              userId: userObjId,
              orderId: orderObjId,
              discountAmount,
              status: CouponUsageStatus.RESERVED,
              usageSlot: slot,
              expiresAt,
            },
          ],
          { session: session || undefined }
        );
        createdUsage = usageDoc;
        break;
      } catch (err: unknown) {
        lastError = err;
        if (isMongoDuplicateKeyError(err)) {
          continue;
        }
        throw err;
      }
    }

    if (!createdUsage) {
      throw (
        lastError ||
        new AppError(
          "You have already used or reserved this coupon maximum allowed times",
          400,
          "COUPON_USER_LIMIT_REACHED"
        )
      );
    }

    return {
      reservation: createdUsage,
      couponCode: coupon.code,
      slot: createdUsage.usageSlot,
    };
  } catch (err: unknown) {
    await Coupon.updateOne(
      { _id: couponObjId, reservedCount: { $gt: 0 } },
      { $inc: { reservedCount: -1 } },
      { session: session || undefined }
    ).catch((rollbackErr: unknown) => {
      console.error(
        JSON.stringify({
          level: "ERROR",
          event: "COUPON_RESERVATION_ROLLBACK_FAILED",
          couponId: couponObjId.toString(),
          orderId: orderObjId.toString(),
          message: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        })
      );
    });

    if (isMongoDuplicateKeyError(err)) {
      throw new AppError(
        "You have already used or reserved this coupon maximum allowed times",
        400,
        "COUPON_USER_LIMIT_REACHED"
      );
    }
    throw err;
  }
}

/**
 * Atomically reserves a coupon usage slot for an order before accepting checkout.
 * Enforces perUserUsageLimit via an atomic slot partial unique index on (couponId, userId, usageSlot)
 * filtered by status in ['RESERVED', 'CONFIRMED'].
 *
 * Uses multi-document transactions where supported for ACID guarantees, with reliable
 * compensating rollbacks and observable reconciliation.
 */
export async function reserveCouponForOrder(
  params: ReserveCouponParams
): Promise<CouponReservationResult> {
  // If caller already provides a transaction session, use it
  if (params.session) {
    return executeReservationCore(params, params.session);
  }

  // If no session provided, attempt managed transaction only if supported by MongoDB deployment
  if (!isTransactionSupported(mongoose.connection)) {
    return executeReservationCore(params, undefined);
  }

  let managedSession: mongoose.ClientSession | null = null;
  try {
    managedSession = await mongoose.startSession();
    managedSession.startTransaction();
  } catch {
    if (managedSession) {
      await managedSession.endSession().catch(() => {});
      managedSession = null;
    }
  }

  if (managedSession) {
    try {
      const result = await executeReservationCore(params, managedSession);
      await managedSession.commitTransaction();
      return result;
    } catch (err: unknown) {
      try {
        await managedSession.abortTransaction();
      } catch {
        // Abort failed
      }
      throw err;
    } finally {
      await managedSession.endSession().catch(() => {});
    }
  }

  // Fallback for standalone/un-transactional environments
  return executeReservationCore(params, undefined);
}

/**
 * Confirms a coupon reservation upon successful payment capture.
 * Transitions status from RESERVED to CONFIRMED and updates Coupon usedCount/reservedCount.
 * Completely idempotent: if already CONFIRMED, returns ALREADY_CONFIRMED without duplicate increment.
 */
export async function confirmCouponReservation(
  orderId: mongoose.Types.ObjectId | string,
  session?: mongoose.ClientSession
): Promise<{ success: boolean; status: string }> {
  const orderObjId = new mongoose.Types.ObjectId(orderId.toString());

  const usage = await CouponUsage.findOne({ orderId: orderObjId }).session(session || null);
  if (!usage) {
    return { success: true, status: "NO_COUPON" };
  }

  if (usage.status === CouponUsageStatus.CONFIRMED) {
    return { success: true, status: "ALREADY_CONFIRMED" };
  }

  if (usage.status === CouponUsageStatus.RELEASED) {
    return { success: false, status: "ALREADY_RELEASED" };
  }

  const confirmed = await CouponUsage.findOneAndUpdate(
    { _id: usage._id, status: CouponUsageStatus.RESERVED },
    {
      $set: {
        status: CouponUsageStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
      $unset: { expiresAt: 1 },
    },
    { session: session || undefined, returnDocument: "after" }
  );

  if (confirmed) {
    await Coupon.updateOne(
      { _id: usage.couponId },
      {
        $inc: { usedCount: 1, reservedCount: -1 },
      },
      { session: session || undefined }
    ).catch(async () => {
      await Coupon.updateOne(
        { _id: usage.couponId },
        { $inc: { usedCount: 1 } },
        { session: session || undefined }
      ).catch(() => {});
    });

    // Safeguard reservedCount lower bound
    await Coupon.updateOne(
      { _id: usage.couponId, reservedCount: { $lt: 0 } },
      { $set: { reservedCount: 0 } },
      { session: session || undefined }
    ).catch(() => {});

    return { success: true, status: "CONFIRMED" };
  }

  return { success: true, status: "ALREADY_CONFIRMED" };
}

/**
 * Safely releases an unconfirmed coupon reservation.
 * Strictly guards by status: RESERVED — can NEVER release or alter a CONFIRMED redemption!
 */
export async function releaseCouponReservation(
  orderId: mongoose.Types.ObjectId | string,
  reason = "ORDER_CANCELLED",
  session?: mongoose.ClientSession
): Promise<{ released: boolean }> {
  const orderObjId = new mongoose.Types.ObjectId(orderId.toString());

  const released = await CouponUsage.findOneAndUpdate(
    { orderId: orderObjId, status: CouponUsageStatus.RESERVED },
    {
      $set: {
        status: CouponUsageStatus.RELEASED,
        releasedAt: new Date(),
        releaseReason: reason,
      },
      $unset: { expiresAt: 1 },
    },
    { session: session || undefined, returnDocument: "after" }
  );

  if (released) {
    await Coupon.updateOne(
      { _id: released.couponId, reservedCount: { $gt: 0 } },
      { $inc: { reservedCount: -1 } },
      { session: session || undefined }
    ).catch((err: unknown) => {
      console.error(
        JSON.stringify({
          level: "ERROR",
          event: "COUPON_RESERVED_DECREMENT_FAILED",
          couponId: released.couponId.toString(),
          orderId: orderObjId.toString(),
          message: err instanceof Error ? err.message : String(err),
        })
      );
    });
    return { released: true };
  }

  return { released: false };
}

/**
 * Cleans up and releases all stale expired RESERVED usages whose orders were never paid.
 * Reconciles counters for all affected coupons.
 */
export async function expireStaleCouponReservations(
  batchLimit = 50
): Promise<{ expiredCount: number }> {
  const cutoff = new Date();
  const staleReservations = await CouponUsage.find({
    status: CouponUsageStatus.RESERVED,
    expiresAt: { $lte: cutoff },
  })
    .limit(batchLimit)
    .lean();

  let expiredCount = 0;
  const affectedCouponIds = new Set<string>();

  for (const item of staleReservations) {
    const res = await releaseCouponReservation(item.orderId, "RESERVATION_EXPIRED");
    if (res.released) {
      expiredCount++;
      affectedCouponIds.add(item.couponId.toString());
    }
  }

  for (const couponId of affectedCouponIds) {
    await reconcileCouponCounters(couponId).catch(() => {});
  }

  return { expiredCount };
}
