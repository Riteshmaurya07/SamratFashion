/**
 * Phase 3 Regression Suite: Customer Return API Data Protection
 *
 * Verifies that:
 * 1. All customer-facing return endpoints (createReturn, getCustomerReturns,
 *    getOrderReturns, getReturnById, cancelReturn) and order endpoints
 *    embedding returns (getOrders, getOrder) serialize returns through an
 *    explicit allowlist.
 * 2. Internal fields (refundClaimToken, refundClaimExpiresAt, refundError,
 *    refundAttempt, requiresInventoryReconciliation,
 *    inventoryReconciliationReason, adminNote, reviewedBy, internalNotes,
 *    packageDetails, reverseShipmentId, and arbitrary extra fields) are NEVER
 *    exposed in customer responses.
 * 3. Legitimate customer-visible fields required by the frontend remain intact.
 * 4. Admin return endpoints remain unchanged and continue returning internal
 *    operational data.
 */

process.env.NODE_ENV = 'test';

import mongoose from 'mongoose';
import { Request, Response, NextFunction } from 'express';
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { Order } from '../models/Order';
import { ReturnRequest } from '../models/ReturnRequest';
import { Product } from '../models/Product';
import { User, UserRole, UserStatus } from '../models/User';
import { AuditLog } from '../models/AuditLog';
import '../models/Shipment';
import '../models/Refund';
import {
  createReturn,
  getCustomerReturns,
  getOrderReturns,
  getReturnById,
  cancelReturn,
  getAdminReturns,
  getAdminReturnById,
} from '../controllers/returnController';
import { getOrders, getOrder } from '../controllers/orderController';
import { serializeCustomerReturn } from '../utils/returnSerializer';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, detail?: string): void {
  if (condition) {
    console.log(`  PASS: ${desc}`);
    passed++;
  } else {
    const msg = detail ? `${desc} — ${detail}` : desc;
    console.error(`  FAIL: ${msg}`);
    failures.push(msg);
    failed++;
  }
}

const FORBIDDEN_FIELDS = [
  'refundClaimToken',
  'refundClaimExpiresAt',
  'refundError',
  'refundAttempt',
  'requiresInventoryReconciliation',
  'inventoryReconciliationReason',
  'inventoryRestored',
  'inventoryRestoredAt',
  'adminNote',
  'reviewedBy',
  'internalNotes',
  'packageDetails',
  'reverseShipmentId',
  'secretFutureInternalField',
  '__v',
];

function createMockRes() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
}

function assertNoForbiddenFields(obj: Record<string, unknown>, label: string): void {
  const leaked = FORBIDDEN_FIELDS.filter((field) => field in obj);
  check(
    leaked.length === 0,
    `${label}: no internal/sensitive fields leaked`,
    leaked.length > 0 ? `leaked: ${leaked.join(', ')}` : undefined
  );
}

async function invokeHandler(
  handler: (req: Request, res: Response, next: NextFunction) => void,
  req: Partial<Request> & { user?: any }
) {
  const res = createMockRes();
  let capturedErr: unknown;
  await new Promise<void>((resolve) => {
    const origJson = res.json.bind(res);
    res.json = (payload: any) => {
      origJson(payload);
      resolve();
      return res;
    };
    const next: NextFunction = (err?: unknown) => {
      capturedErr = err;
      resolve();
    };
    Promise.resolve(handler(req as Request, res as unknown as Response, next)).catch((err) => {
      capturedErr = err;
      resolve();
    });
  });
  return { res, err: capturedErr };
}

async function run() {
  console.log('=== Phase 3: Customer Return API Data Protection Suite ===');
  await connectSafeTestDb();

  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdOrderIds: mongoose.Types.ObjectId[] = [];
  const createdReturnIds: mongoose.Types.ObjectId[] = [];
  const createdProductIds: mongoose.Types.ObjectId[] = [];

  try {
    const customer = await User.create({
      name: 'Return Privacy Customer',
      email: `return_privacy_${Date.now()}@example.com`,
      passwordHash: 'hash123',
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    });
    const admin = await User.create({
      name: 'Return Privacy Admin',
      email: `return_admin_${Date.now()}@example.com`,
      passwordHash: 'hash123',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    createdUserIds.push(customer._id as mongoose.Types.ObjectId, admin._id as mongoose.Types.ObjectId);

    const { product, productId, variantIds } = await createTestProduct({
      name: 'Return Safe Shirt',
      basePrice: 999,
      variants: [{ size: 'L', color: 'BLUE', stock: 15 }],
    });
    createdProductIds.push(product._id);
    const variantId = variantIds[0];

    const order = await Order.create({
      orderNumber: `RET-SEC-${Date.now()}`,
      userId: customer._id,
      items: [
        {
          productId: new mongoose.Types.ObjectId(productId),
          variantId: new mongoose.Types.ObjectId(variantId),
          productName: 'Return Safe Shirt',
          productImage: 'https://example.com/shirt.jpg',
          selectedSize: 'L',
          selectedColor: 'BLUE',
          quantity: 3,
          unitPrice: 999,
          lineTotal: 2997,
          isCustomized: false,
        },
      ],
      shippingAddress: {
        fullName: 'Return Customer',
        phone: '9876543210',
        addressLine1: '10 Main St',
        city: 'Delhi',
        state: 'Delhi',
        postalCode: '110001',
        country: 'India',
      },
      subtotal: 2997,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 2997,
      currency: 'INR',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      deliveredAt: new Date(),
    });
    createdOrderIds.push(order._id as mongoose.Types.ObjectId);

    // 1. Unit test allowlist serializer with arbitrary unknown/internal fields
    const unitSerialized = serializeCustomerReturn({
      _id: 'ret_1',
      orderId: 'ord_1',
      items: [{ productId: 'p1', variantId: 'v1', quantity: 1, reason: 'WRONG_SIZE', internalCost: 50 }],
      status: 'APPROVED',
      customerNote: 'Too large',
      refundStatus: 'PROCESSING',
      returnAwbNumber: 'AWB12345',
      returnCarrier: 'Delhivery',
      refundClaimToken: 'secret-claim-token',
      refundClaimExpiresAt: new Date(),
      refundError: 'Gateway 500 stack trace',
      requiresInventoryReconciliation: true,
      inventoryReconciliationReason: 'Historical ledger mismatch',
      adminNote: 'Suspected wardrobing',
      reviewedBy: admin._id,
      internalNotes: 'Escalated to fraud team',
      secretFutureInternalField: 'do-not-leak',
    });
    assertNoForbiddenFields(unitSerialized as unknown as Record<string, unknown>, 'P3.1 serializeCustomerReturn unit');
    check(
      !('internalCost' in (unitSerialized.items[0] as unknown as Record<string, unknown>)),
      'P3.1b Item serializer strips non-allowlisted item fields'
    );
    check(
      unitSerialized.customerNote === 'Too large' &&
        unitSerialized.returnAwbNumber === 'AWB12345' &&
        unitSerialized.returnCarrier === 'Delhivery' &&
        unitSerialized.refundStatus === 'PROCESSING',
      'P3.1c Serializer preserves customer-visible fields'
    );

    // 2. Test createReturn response
    const createRes = await invokeHandler(createReturn, {
      user: { id: customer._id.toString(), role: 'CUSTOMER' },
      params: { id: order._id.toString() },
      body: {
        items: [{ variantId, quantity: 1, reason: 'WRONG_SIZE' }],
        customerNote: 'Please exchange for M',
      },
    });
    check(!createRes.err && createRes.res.statusCode === 201, 'P3.2 createReturn succeeds with 201');
    const createdReturnData = createRes.res.body?.data;
    createdReturnIds.push(new mongoose.Types.ObjectId(String(createdReturnData._id)));
    assertNoForbiddenFields(createdReturnData, 'P3.2 createReturn');
    check(
      createdReturnData?.status === 'REQUESTED' &&
        createdReturnData?.customerNote === 'Please exchange for M' &&
        Array.isArray(createdReturnData?.items) &&
        createdReturnData.items.length === 1 &&
        String(createdReturnData.items[0].variantId) === variantId &&
        createdReturnData.items[0].quantity === 1 &&
        createdReturnData.items[0].reason === 'WRONG_SIZE',
      'P3.2b createReturn preserves required customer fields'
    );

    // Populate ALL sensitive/internal fields directly in DB (including un-schema'd internalNotes & extra field)
    await ReturnRequest.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(String(createdReturnData._id)) },
      {
        $set: {
          refundClaimToken: 'claim_secret_token_xyz',
          refundClaimExpiresAt: new Date(Date.now() + 60_000),
          refundError: 'Razorpay 502 internal gateway error',
          refundAttempt: 3,
          requiresInventoryReconciliation: true,
          inventoryReconciliationReason: 'Legacy stock variance detected',
          inventoryRestored: false,
          adminNote: 'Internal ops note: inspect tag carefully',
          reviewedBy: admin._id,
          internalNotes: 'Private fraud review notes',
          reverseShipmentId: new mongoose.Types.ObjectId(),
          packageDetails: {
            weightGrams: 500,
            lengthCm: 30,
            widthCm: 20,
            heightCm: 5,
            isConfirmed: true,
            confirmedBy: admin._id,
          },
          returnAwbNumber: 'AWB-RET-999',
          returnCarrier: 'BlueDart',
          returnShippingMethod: 'NIMBUSPOST_REVERSE',
          refundStatus: 'PENDING',
          secretFutureInternalField: 'must_never_leak',
        },
      }
    );

    // 3. Test getCustomerReturns
    const listRes = await invokeHandler(getCustomerReturns, {
      user: { id: customer._id.toString(), role: 'CUSTOMER' },
      params: {},
    });
    check(!listRes.err && listRes.res.statusCode === 200 && listRes.res.body?.data?.length === 1, 'P3.3 getCustomerReturns succeeds');
    assertNoForbiddenFields(listRes.res.body.data[0], 'P3.3 getCustomerReturns');
    check(
      listRes.res.body.data[0].returnAwbNumber === 'AWB-RET-999' &&
        listRes.res.body.data[0].returnCarrier === 'BlueDart',
      'P3.3b getCustomerReturns preserves customer tracking fields'
    );

    // 4. Test getOrderReturns
    const orderRetRes = await invokeHandler(getOrderReturns, {
      user: { id: customer._id.toString(), role: 'CUSTOMER' },
      params: { id: order._id.toString() },
    });
    check(!orderRetRes.err && orderRetRes.res.statusCode === 200 && orderRetRes.res.body?.data?.length === 1, 'P3.4 getOrderReturns succeeds');
    assertNoForbiddenFields(orderRetRes.res.body.data[0], 'P3.4 getOrderReturns');

    // 5. Test getReturnById
    const detailRes = await invokeHandler(getReturnById, {
      user: { id: customer._id.toString(), role: 'CUSTOMER' },
      params: { id: order._id.toString(), returnId: String(createdReturnData._id) },
    });
    check(!detailRes.err && detailRes.res.statusCode === 200, 'P3.5 getReturnById succeeds');
    assertNoForbiddenFields(detailRes.res.body.data, 'P3.5 getReturnById');
    check(
      String(detailRes.res.body.data._id) === String(createdReturnData._id) &&
        detailRes.res.body.data.customerNote === 'Please exchange for M',
      'P3.5b getReturnById preserves customer fields'
    );

    // 6. Test getOrders (embedded returns)
    const ordersRes = await invokeHandler(getOrders, {
      user: { id: customer._id.toString(), role: 'CUSTOMER' },
      query: {},
    });
    check(!ordersRes.err && ordersRes.res.statusCode === 200, 'P3.6 getOrders succeeds');
    const embeddedOrder = ordersRes.res.body?.data?.find((o: any) => String(o._id) === order._id.toString());
    check(Boolean(embeddedOrder && embeddedOrder.returns?.length === 1), 'P3.6b getOrders includes order returns');
    assertNoForbiddenFields(embeddedOrder.returns[0], 'P3.6 getOrders embedded return');

    // 7. Test getOrder (embedded returns)
    const singleOrderRes = await invokeHandler(getOrder, {
      user: { id: customer._id.toString(), role: 'CUSTOMER' },
      params: { id: order._id.toString() },
    });
    check(!singleOrderRes.err && singleOrderRes.res.statusCode === 200, 'P3.7 getOrder succeeds');
    check(singleOrderRes.res.body?.data?.returns?.length === 1, 'P3.7b getOrder includes order returns');
    assertNoForbiddenFields(singleOrderRes.res.body.data.returns[0], 'P3.7 getOrder embedded return');

    // 8. Test cancelReturn response
    const cancelRes = await invokeHandler(cancelReturn, {
      user: { id: customer._id.toString(), role: 'CUSTOMER' },
      params: { id: order._id.toString(), returnId: String(createdReturnData._id) },
    });
    check(!cancelRes.err && cancelRes.res.statusCode === 200, 'P3.8 cancelReturn succeeds');
    assertNoForbiddenFields(cancelRes.res.body.data, 'P3.8 cancelReturn');
    check(
      cancelRes.res.body.data.status === 'CANCELLED' && Boolean(cancelRes.res.body.data.cancelledAt),
      'P3.8b cancelReturn returns updated CANCELLED status and cancelledAt'
    );

    // 9. Verify authorized admin responses are UNCHANGED (still expose internal operational fields)
    const adminListRes = await invokeHandler(getAdminReturns, {
      user: { id: admin._id.toString(), role: 'ADMIN' },
      params: {},
    });
    const adminItem = adminListRes.res.body?.data?.find(
      (r: any) => String(r._id) === String(createdReturnData._id)
    );
    check(
      !adminListRes.err &&
        adminListRes.res.statusCode === 200 &&
        adminItem?.adminNote === 'Internal ops note: inspect tag carefully' &&
        adminItem?.refundError === 'Razorpay 502 internal gateway error' &&
        adminItem?.requiresInventoryReconciliation === true,
      'P3.9 getAdminReturns continues returning full internal fields for admins'
    );

    const adminDetailRes = await invokeHandler(getAdminReturnById, {
      user: { id: admin._id.toString(), role: 'ADMIN' },
      params: { id: String(createdReturnData._id) },
    });
    const adminDetail = adminDetailRes.res.body?.data;
    check(
      !adminDetailRes.err &&
        adminDetailRes.res.statusCode === 200 &&
        adminDetail?.adminNote === 'Internal ops note: inspect tag carefully' &&
        String(adminDetail?.reviewedBy) === admin._id.toString() &&
        adminDetail?.inventoryReconciliationReason === 'Legacy stock variance detected',
      'P3.10 getAdminReturnById continues returning full internal fields for admins'
    );
  } finally {
    if (createdReturnIds.length > 0) {
      await ReturnRequest.deleteMany({ _id: { $in: createdReturnIds } });
    }
    if (createdOrderIds.length > 0) {
      await AuditLog.deleteMany({ entityId: { $in: createdOrderIds } });
      await Order.deleteMany({ _id: { $in: createdOrderIds } });
    }
    if (createdProductIds.length > 0) {
      await Product.deleteMany({ _id: { $in: createdProductIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await mongoose.disconnect().catch(() => {});
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('Failures:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unhandled error in customer-return-data-protection test:', err);
  process.exit(1);
});

