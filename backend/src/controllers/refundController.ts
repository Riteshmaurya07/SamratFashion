import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Refund } from '../models/Refund';
import { AppError } from '../utils/AppError';
import { createInternalRefund } from '../services/payment/refundService';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

export const initiateRefund = async (req: AuthRequest, res: Response) => {
  try {
    const orderId = req.params.id as string;
    const { amount, reason } = req.body; // amount is in standard currency units (e.g. INR rupees)

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new AppError('Invalid order ID', 400);
    }
    if (!req.user) throw new AppError('Unauthorized', 401);

    const refund = await createInternalRefund({
      orderId,
      amount,
      reason,
      actorId: req.user.id,
      actorRole: req.user.role
    });

    res.status(200).json({
      success: true,
      message: 'Refund initiated successfully. Awaiting webhook confirmation.',
      data: refund
    });

  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const getOrderRefunds = async (req: AuthRequest, res: Response) => {
  try {
    const orderId = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new AppError('Invalid order ID', 400);
    }

    const refunds = await Refund.find({ orderId }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: refunds
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};
