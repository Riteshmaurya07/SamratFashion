import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IInventoryTransaction extends Document {
  orderId?: Types.ObjectId;
  productId: Types.ObjectId;
  variantId: Types.ObjectId;
  quantity: number;
  type: 'SALE' | 'RESTOCK' | 'ADJUSTMENT' | 'REFUND' | 'RETURN';
  refundId?: Types.ObjectId;
  returnId?: Types.ObjectId;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const inventoryTransactionSchema = new Schema<IInventoryTransaction>({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  quantity: { type: Number, required: true },
  type: { 
    type: String, 
    enum: ['SALE', 'RESTOCK', 'ADJUSTMENT', 'REFUND', 'RETURN'], 
    required: true 
  },
  refundId: { type: Schema.Types.ObjectId, ref: 'Refund' },
  returnId: { type: Schema.Types.ObjectId, ref: 'ReturnRequest' },
  reason: { type: String },
}, { timestamps: true });

// Ensure idempotency for SALE transactions per variant per order (sparse allows multiple nulls)
inventoryTransactionSchema.index({ orderId: 1, variantId: 1, type: 1 }, { unique: true, sparse: true });

export const InventoryTransaction = mongoose.model<IInventoryTransaction>('InventoryTransaction', inventoryTransactionSchema);
