import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { catchAsync } from '../utils/catchAsync';
import { RecoveryCoordinatorService } from '../services/recovery/recoveryCoordinatorService';
import { ReturnRequest } from '../models/ReturnRequest';
import { Order } from '../models/Order';
import { InventoryAllocationService } from '../services/inventory/inventoryAllocationService';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
export const getRecoveryMetrics = catchAsync(async (req: Request, res: Response) => {
  const metrics = await RecoveryCoordinatorService.getRecoverySystemMetrics();
  res.status(200).json({
    success: true,
    data: metrics,
  });
});

export const triggerRecoveryCycle = catchAsync(async (req: Request, res: Response) => {
  const report = await RecoveryCoordinatorService.executeCoordinatedRecoveryCycle();
  res.status(200).json({
    success: true,
    data: report,
  });
});

export const getUnresolvedHistoricalReturns = catchAsync(async (req: Request, res: Response) => {
  const returns = await ReturnRequest.find({ requiresInventoryReconciliation: true }).sort({ createdAt: -1 });
  res.status(200).json({
    success: true,
    data: returns,
  });
});

export const resolveHistoricalReturnReconciliation = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { action, adminReason } = req.body;

  if (!adminReason || typeof adminReason !== 'string' || !adminReason.trim()) {
    throw new AppError('Administrative reason is strictly required for historical return reconciliation', 400);
  }

  if (!action || !['RESTORE_INVENTORY', 'MARK_ALREADY_RESTORED'].includes(action)) {
    throw new AppError('Action must be either RESTORE_INVENTORY or MARK_ALREADY_RESTORED', 400);
  }

  const returnRequest = await ReturnRequest.findById(id);
  if (!returnRequest) throw new AppError('Return request not found', 404);
  if (!returnRequest.requiresInventoryReconciliation) {
    throw new AppError('Return request does not require inventory reconciliation', 400);
  }

  const order = await Order.findById(returnRequest.orderId);
  if (!order) throw new AppError('Associated order not found', 404);

  if (action === 'RESTORE_INVENTORY') {
    const res = await InventoryAllocationService.restoreReturnInventory(returnRequest, order._id, {
      allowHistoricalReconciliation: true,
    });
    if (res.restoredCount === 0 && !res.alreadyRestored) {
      throw new AppError('Inventory restoration could not be verified; reconciliation flag preserved', 500);
    }
    returnRequest.requiresInventoryReconciliation = false;
    returnRequest.inventoryRestored = true;
    returnRequest.inventoryRestoredAt = new Date();
    returnRequest.refundStatus = 'FAILED'; // Places return in retryable state for acceptReturn
    returnRequest.refundError = `Historical inventory verified & restored by admin: ${adminReason.trim()}`;
    returnRequest.inventoryReconciliationReason = `Administratively resolved (restored): ${adminReason.trim()}`;
    await returnRequest.save();
  } else {
    returnRequest.requiresInventoryReconciliation = false;
    returnRequest.inventoryRestored = true;
    returnRequest.inventoryRestoredAt = new Date();
    returnRequest.refundStatus = 'FAILED';
    returnRequest.refundError = `Historical return marked restored by admin: ${adminReason.trim()}`;
    returnRequest.inventoryReconciliationReason = `Administratively resolved (marked restored): ${adminReason.trim()}`;
    await returnRequest.save();
  }
  const user = (req as { user?: { id?: string; role?: string } }).user;
  await AuditLog.create({
    actorId: user?.id ? new mongoose.Types.ObjectId(user.id) : new mongoose.Types.ObjectId(),
    actorRole: user?.role || 'ADMIN',
    action: 'ADMIN_HISTORICAL_RETURN_RECONCILED',
    entityType: 'RETURN',
    entityId: returnRequest._id,
    metadata: { action, adminReason }
  });

  res.status(200).json({
    success: true,
    data: returnRequest,
  });
});
