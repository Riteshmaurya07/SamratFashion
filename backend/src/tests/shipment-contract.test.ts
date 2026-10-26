process.env.ALLOW_LOGISTICS_MOCK = 'true';
process.env.LOGISTICS_PROVIDER = 'mock';

import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
process.env.ALLOW_LOGISTICS_MOCK = 'true';
process.env.LOGISTICS_PROVIDER = 'mock';

import mongoose from 'mongoose';
import { Order } from '../models/Order';
import { Shipment } from '../models/Shipment';
import { AuditLog } from '../models/AuditLog';
import { createShipment } from '../controllers/shipmentController';

function mockReq(params: Record<string, string>, body: Record<string, unknown>, userId: mongoose.Types.ObjectId): any {
  return {
    params,
    body,
    user: { id: userId.toString(), role: 'ADMIN' }
  };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.data = data;
      return this;
    }
  };
  return res;
}

function executeHandler(req: any, res: any): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const origJson = res.json.bind(res);
    res.json = (data: any) => {
      origJson(data);
      resolve();
    };
    createShipment(req, res, (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function runTests() {
  process.env.ALLOW_LOGISTICS_MOCK = 'true';
  process.env.LOGISTICS_PROVIDER = 'mock';

  let testUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/samrat_fashion';
  if (testUri.includes('?')) {
    testUri = testUri.replace('/?', '/samrat_fashion_test_isolated?');
  } else {
    testUri = testUri.replace(/\/$/, '') + '/samrat_fashion_test_isolated';
  }

  await mongoose.connect(testUri);
  console.log('✅ Connected to MongoDB isolated DB\n');

  let passed = 0;
  let failed = 0;

  const check = (condition: boolean, msg: string) => {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  };

  const testAdminId = new mongoose.Types.ObjectId();
  const testOrderId1 = new mongoose.Types.ObjectId();
  const testOrderId2 = new mongoose.Types.ObjectId();

  try {
    const order1 = await Order.create({
      _id: testOrderId1,
      orderNumber: `ORD-SHIP-${Date.now()}-1`,
      userId: testAdminId,
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          variantId: new mongoose.Types.ObjectId(),
          productName: 'Heavyweight Streetwear T-Shirt',
          productImage: '/placeholder.png',
          quantity: 2,
          unitPrice: 1299,
          lineTotal: 2598,
          selectedSize: 'L',
          selectedColor: 'Black'
        }
      ],
      shippingAddress: {
        fullName: 'Aarav Sharma',
        phone: '9876543210',
        addressLine1: 'B-12, Connaught Place',
        city: 'New Delhi',
        state: 'Delhi',
        postalCode: '110001',
        country: 'India',
        addressType: 'HOME'
      },
      subtotal: 2598,
      discount: 0,
      shipping: 0,
      tax: 467,
      total: 3065,
      currency: 'INR'
    });

    const order2 = await Order.create({
      _id: testOrderId2,
      orderNumber: `ORD-SHIP-${Date.now()}-2`,
      userId: testAdminId,
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          variantId: new mongoose.Types.ObjectId(),
          productName: 'Heavyweight Streetwear T-Shirt',
          productImage: '/placeholder.png',
          quantity: 1,
          unitPrice: 1299,
          lineTotal: 1299,
          selectedSize: 'M',
          selectedColor: 'White'
        }
      ],
      shippingAddress: {
        fullName: 'Priya Verma',
        phone: '9876543211',
        addressLine1: 'C-44, Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560038',
        country: 'India',
        addressType: 'WORK'
      },
      subtotal: 1299,
      discount: 0,
      shipping: 0,
      tax: 233,
      total: 1532,
      currency: 'INR'
    });

    // TEST 1: Provider-driven dispatch with package details
    const res1 = mockRes();
    const req1 = mockReq(
      { id: testOrderId1.toString() },
      {
        mode: 'PROVIDER',
        weightGrams: 650,
        lengthCm: 32,
        widthCm: 26,
        heightCm: 6
      },
      testAdminId
    );

    await executeHandler(req1, res1);
    check(res1.statusCode === 201, 'Provider shipment returns 201 Created');
    check(res1.data?.success === true, 'Provider shipment response has success: true');
    check(typeof res1.data?.data?.awbNumber === 'string' && res1.data.data.awbNumber.length > 0, 'Provider generates authoritative AWB');
    check(res1.data?.data?.packageDetails?.weightGrams === 650, 'Package weightGrams persisted as 650');
    check(res1.data?.data?.packageDetails?.lengthCm === 32, 'Package lengthCm persisted as 32');

    // Audit log check for provider mode
    const audit1 = await AuditLog.findOne({ entityId: order1._id, action: 'ADMIN_SHIPMENT_CREATED' });
    check(audit1?.metadata?.mode === 'PROVIDER', 'AuditLog records mode: PROVIDER');

    // TEST 2: Manual dispatch mode with custom carrier & external AWB
    const res2 = mockRes();
    const req2 = mockReq(
      { id: order2._id.toString() },
      {
        mode: 'MANUAL',
        carrier: 'BlueDart Air Express',
        trackingNumber: 'BD-AWB-987654321',
        weightGrams: 400,
        lengthCm: 28,
        widthCm: 20,
        heightCm: 4
      },
      testAdminId
    );

    await executeHandler(req2, res2);
    check(res2.statusCode === 201, 'Manual shipment returns 201 Created');
    check(res2.data?.data?.carrier === 'BlueDart Air Express', 'Manual shipment preserves carrier');
    check(res2.data?.data?.awbNumber === 'BD-AWB-987654321', 'Manual shipment preserves tracking AWB');
    check(res2.data?.data?.provider === 'manual', 'Manual shipment provider is "manual"');

    // Audit log check for manual mode
    const audit2 = await AuditLog.findOne({ entityId: order2._id, action: 'ADMIN_SHIPMENT_CREATED' });
    check(audit2?.metadata?.mode === 'MANUAL', 'AuditLog records mode: MANUAL');

    // TEST 3: Idempotency: Repeating call returns existing shipment without duplicate
    const resRepeat = mockRes();
    await executeHandler(req1, resRepeat);
    check(resRepeat.statusCode === 200, 'Repeated call returns 200 with existing shipment');
    check(resRepeat.data?.data?._id?.toString() === res1.data?.data?._id?.toString(), 'Duplicate shipment creation prevented');

    // Cleanup test records
    await Shipment.deleteMany({ orderId: { $in: [testOrderId1, testOrderId2] } });
    await Order.deleteMany({ _id: { $in: [testOrderId1, testOrderId2] } });
    await AuditLog.deleteMany({ entityId: { $in: [testOrderId1, testOrderId2] } });

  } catch (err) {
    console.error('Shipment test error:', err);
    failed++;
  } finally {
    await mongoose.disconnect();
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
