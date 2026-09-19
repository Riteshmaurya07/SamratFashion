import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

import { Order } from '../models/Order';
import { PrintJob, PrintJobStatus } from '../models/PrintJob';
import { Fulfillment, FulfillmentStatus } from '../models/Fulfillment';
import { Shipment } from '../models/Shipment';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/samrat_fashion';
const DRY_RUN = process.argv.includes('--dry-run');

const completedPrintStatuses: Record<string, true> = {
  [PrintJobStatus.PRINTED]: true,
  [PrintJobStatus.COMPLETED]: true,
};

const completedFulfillmentStatuses: Record<string, true> = {
  [FulfillmentStatus.READY_TO_SHIP]: true,
  [FulfillmentStatus.HANDED_OVER]: true,
};

async function wasAlreadyProducedOrShipped(orderId: mongoose.Types.ObjectId, itemId?: mongoose.Types.ObjectId) {
  const printJobQuery: Record<string, unknown> = { orderId };
  if (itemId) printJobQuery.orderItemId = itemId.toString();

  const [printJobs, fulfillment, shipment] = await Promise.all([
    PrintJob.find(printJobQuery).select('status').lean(),
    Fulfillment.findOne({ orderId }).select('status').lean(),
    Shipment.findOne({ orderId }).select('status').lean(),
  ]);

  const printJobComplete = printJobs.some((job) => completedPrintStatuses[job.status] === true);
  const fulfillmentComplete = Boolean(
    fulfillment && completedFulfillmentStatuses[fulfillment.status] === true
  );
  const shipmentComplete = Boolean(
    shipment && ['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PICKED_UP'].includes(shipment.status)
  );

  return printJobComplete || fulfillmentComplete || shipmentComplete;
}

function isLegacyMigrationApproval(item: {
  approvalStatus?: string;
  approvalHistory?: Array<{ actor?: string; note?: string }>;
}) {
  return item.approvalStatus === 'approved' &&
    item.approvalHistory?.some(
      (entry) => entry.actor === 'system' && entry.note?.includes('legacy canvas')
    );
}

async function migrateCanvasToMockupFlow() {
  console.log('Starting migration to Manual Mockup-Approval Flow...');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'WRITE'}`);
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.');

  let ordersUpdated = 0;
  let itemsUpdated = 0;
  const orders = await Order.find({});

  for (const order of orders) {
    let orderModified = false;

    for (const item of order.items) {
      const isLegacyCanvasItem = Boolean(
        item.isCustomized ||
        item.customDesignId ||
        (item.customConfigurations && item.customConfigurations.length > 0)
      );
      if (!isLegacyCanvasItem) continue;

      const needsCorrection = !item.approvalStatus || isLegacyMigrationApproval(item);
      if (!needsCorrection) continue;

      const oldStatus = item.approvalStatus || '(missing)';
      const produced = await wasAlreadyProducedOrShipped(order._id, item._id);
      const newStatus = produced ? 'in_production' : 'pending_design';

      console.log(
        `[ORDER ${order._id.toString()}] item=${item._id?.toString() || '(legacy-item)'} ` +
        `oldStatus=${oldStatus} newStatus=${newStatus}`
      );

      item.approvalStatus = newStatus;
      item.approvalHistory = [{
        status: newStatus,
        note: produced
          ? 'Corrected legacy migration: prior production/shipping state preserved'
          : 'Migrated from legacy canvas workflow into manual mockup approval',
        actor: 'system',
        timestamp: new Date(),
      }];

      if (!item.designFiles || item.designFiles.length === 0) {
        const legacyUrl = item.customizationSnapshot?.previewImage || item.productImage;
        if (legacyUrl) {
          item.designFiles = [{
            url: legacyUrl,
            fileType: 'image/png',
            filename: 'legacy_canvas_export.png',
            uploadedAt: order.createdAt || new Date(),
          }];
        }
      }

      orderModified = true;
      itemsUpdated++;
    }

    if (!orderModified) continue;
    ordersUpdated++;
    if (!DRY_RUN) await order.save();
  }

  console.log(
    `Orders ${DRY_RUN ? 'planned' : 'updated'}: ${ordersUpdated}, ` +
    `Items ${DRY_RUN ? 'planned' : 'updated'}: ${itemsUpdated}`
  );
  console.log(`Migration ${DRY_RUN ? 'dry-run completed successfully.' : 'completed successfully.'}`);
  await mongoose.disconnect();
}

migrateCanvasToMockupFlow().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
