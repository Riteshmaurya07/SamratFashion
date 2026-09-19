import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

import { Order } from '../models/Order';
import { PrintJob, PrintJobStatus, PrintJobPriority } from '../models/PrintJob';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/samrat_fashion';
const SCENARIO_PREFIX = 'SF-MIGEV-';

async function seedWrongMigrationScenario() {
  await mongoose.connect(MONGODB_URI);

  const existing = await Order.find({ orderNumber: { $regex: `^${SCENARIO_PREFIX}` } }).select('_id');
  for (const order of existing) {
    await PrintJob.deleteMany({ orderId: order._id });
  }
  await Order.deleteMany({ orderNumber: { $regex: `^${SCENARIO_PREFIX}` } });

  const order = await Order.create({
    orderNumber: `${SCENARIO_PREFIX}${Date.now()}`,
    userId: new mongoose.Types.ObjectId(),
    items: [{
      productId: new mongoose.Types.ObjectId(),
      variantId: new mongoose.Types.ObjectId(),
      productName: 'Migration Evidence Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'Black',
      quantity: 1,
      unitPrice: 799,
      lineTotal: 799,
      isCustomized: true,
      approvalStatus: 'approved',
      approvalHistory: [{
        status: 'approved',
        note: 'Migrated from legacy canvas flow (legacy canvas → approved)',
        actor: 'system',
        timestamp: new Date(),
      }],
      designFiles: [{
        url: 'https://example.com/legacy.png',
        fileType: 'image/png',
        filename: 'legacy_canvas_export.png',
        uploadedAt: new Date(),
      }],
    }],
    shippingAddress: {
      fullName: 'Evid', phone: '0000000000', addressLine1: 'x', city: 'Delhi',
      state: 'Delhi', postalCode: '110001', country: 'India', addressType: 'HOME',
    },
    subtotal: 799, discount: 0, shipping: 0, tax: 0, total: 799,
    currency: 'INR', status: 'PROCESSING', paymentStatus: 'PAID',
  });

  await PrintJob.create({
    orderId: order._id,
    orderItemId: order.items[0]._id?.toString() || new mongoose.Types.ObjectId().toString(),
    customDesignId: new mongoose.Types.ObjectId(),
    status: PrintJobStatus.PRINTED,
    priority: PrintJobPriority.MEDIUM,
    printLocations: ['FRONT'],
  });

  console.log(`Seeded order ${order._id.toString()} (${order.orderNumber}) with approvalStatus='approved' + PRINTED printjob`);
  await mongoose.disconnect();
}

seedWrongMigrationScenario()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });