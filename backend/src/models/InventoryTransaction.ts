import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IInventoryTransaction extends Document {
  orderId?: Types.ObjectId;
  orderItemId?: Types.ObjectId;
  operationId?: string;
  productId: Types.ObjectId;
  variantId: Types.ObjectId;
  quantity: number;
  type: 'SALE' | 'RESTOCK' | 'ADJUSTMENT' | 'REFUND' | 'RETURN';
  refundId?: Types.ObjectId;
  returnId?: Types.ObjectId;
  reason?: string;
  status?: 'PENDING' | 'COMPLETED' | 'FAILED';
  createdAt: Date;
  updatedAt: Date;
}

const inventoryTransactionSchema = new Schema<IInventoryTransaction>({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
  orderItemId: { type: Schema.Types.ObjectId },
  operationId: { type: String, index: true },
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
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED'],
    default: 'COMPLETED'
  },
}, { timestamps: true });

// 1. SALE Idempotency: Exactly one SALE record per order per variant
inventoryTransactionSchema.index(
  { orderId: 1, variantId: 1 },
  {
    unique: true,
    name: 'uniq_sale_order_variant',
    partialFilterExpression: { type: 'SALE' },
  }
);

// 2. RETURN Idempotency: Exactly one RETURN record per returnRequest per variant (when returnId is present)
// 2. RETURN Idempotency: Exactly one RETURN record per returnRequest per variant (when returnId is present and valid ObjectId)
inventoryTransactionSchema.index(
  { returnId: 1, variantId: 1 },
  {
    unique: true,
    name: 'uniq_return_variant',
    partialFilterExpression: { type: 'RETURN', returnId: { $exists: true, $type: 'objectId' } },
  }
);

// 3. REFUND Idempotency: Exactly one REFUND record per order per variant (order cancellation refunds)
inventoryTransactionSchema.index(
  { orderId: 1, variantId: 1 },
  {
    unique: true,
    name: 'uniq_refund_order_variant',
    partialFilterExpression: { type: 'REFUND' },
  }
);

// 4. RESTOCK Idempotency: Exactly one RESTOCK record per cancellation operation per variant
inventoryTransactionSchema.index(
  { operationId: 1, variantId: 1 },
  {
    unique: true,
    name: 'uniq_restock_op_variant',
    partialFilterExpression: { type: 'RESTOCK', operationId: { $exists: true, $type: 'string' } },
  }
);

// 5. Query indexes for efficient ledger queries and admin audit views
inventoryTransactionSchema.index({ orderId: 1, type: 1 });
inventoryTransactionSchema.index({ returnId: 1, type: 1 });
inventoryTransactionSchema.index({ productId: 1, createdAt: -1 });

export const InventoryTransaction = mongoose.model<IInventoryTransaction>('InventoryTransaction', inventoryTransactionSchema);
