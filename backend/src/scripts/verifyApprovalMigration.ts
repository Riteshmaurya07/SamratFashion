import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

import { Order } from '../models/Order';
import { PrintJob, PrintJobStatus } from '../models/PrintJob';
import { Fulfillment, FulfillmentStatus } from '../models/Fulfillment';
import { Shipment } from '../models/Shipment';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/samrat_fashion';

const completedPrintStatuses: Record<string, true> = {
  [PrintJobStatus.PRINTED]: true,
  [PrintJobStatus.COMPLETED]: true,
};

const completedFulfillmentStatuses: Record<string, true> = {
  [FulfillmentStatus.READY_TO_SHIP]: true,
  [FulfillmentStatus.HANDED_OVER]: true,
};

const shippedShipmentStatuses: Record<string, true> = {
  SHIPPED: true,
  IN_TRANSIT: true,
  OUT_FOR_DELIVERY: true,
  DELIVERED: true,
  PICKED_UP: true,
};

async function productionState(orderId: mongoose.Types.ObjectId, itemId?: mongoose.Types.ObjectId) {
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
  const shipmentComplete = Boolean(shipment && shippedShipmentStatuses[shipment.status] === true);

  return { printJobComplete, fulfillmentComplete, shipmentComplete };
}

async function verifyApprovalMigration() {
  console.log('Verifying approval status vs production/shipping records...');
  await mongoose.connect(MONGODB_URI);

  const orders = await Order.find({}).select('_id orderNumber items');

  const buckets = new Map<string, number>();
  let approvedShippedCount = 0;
  let approvedShippedExamples: string[] = [];
  let missingStatusCount = 0;

  for (const order of orders) {
    for (const item of order.items) {
      const status = item.approvalStatus;
      if (!status) {
        missingStatusCount++;
        continue;
      }

      const { printJobComplete, fulfillmentComplete, shipmentComplete } = await productionState(
        order._id,
        item._id
      );

      const isShippedOrProduced = printJobComplete || fulfillmentComplete || shipmentComplete;
      const breakdownKey = `${status} | ${isShippedOrProduced ? 'HAS_COMPLETE_PRINT/FULFILL/SHIP' : 'NO_PRINT/FULFILL/SHIP'}`;
      buckets.set(breakdownKey, (buckets.get(breakdownKey) || 0) + 1);

      if (status === 'approved' && isShippedOrProduced) {
        approvedShippedCount++;
        if (approvedShippedExamples.length < 5) {
          const detail =
            `${printJobComplete ? 'printjob=complete ' : ''}` +
            `${fulfillmentComplete ? 'fulfillment=complete ' : ''}` +
            `${shipmentComplete ? 'shipment=shipped' : ''}`.trim();
          approvedShippedExamples.push(`${order.orderNumber} item=${item._id?.toString() || '(no-id)'} [${detail}]`);
        }
      }
    }
  }

  console.log('\n── Approval status × production-state breakdown ──');
  for (const [key, count] of [...buckets.entries()].sort()) {
    console.log(`  ${String(count).padStart(4)}  ${key}`);
  }
  console.log(`  ${String(missingStatusCount).padStart(4)}  (missing approvalStatus)`);

  console.log('\n── VIOLATION CHECK: shipped/produced orders sitting in approved ──');
  console.log(`  ${approvedShippedCount}`);
  if (approvedShippedExamples.length) approvedShippedExamples.forEach((ex) => console.log(`    ${ex}`));

  await mongoose.disconnect();

  if (approvedShippedCount > 0) {
    console.error(`\nFAIL: ${approvedShippedCount} shipped/produced order(s) still in 'approved'`);
    process.exit(1);
  }
  console.log('\nPASS: zero shipped/produced orders in approved state.');
}

verifyApprovalMigration()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Verification failed:', err);
    process.exit(1);
  });