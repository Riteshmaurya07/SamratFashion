import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { getDashboardMetrics, getDashboardTrend } from '../controllers/adminController';
import { Order } from '../models/Order';
import { Product, ProductStatus } from '../models/Product';
import { WebhookEvent } from '../models/WebhookEvent';
import { NotificationLog } from '../models/NotificationLog';
import { connectSafeTestDb } from './testHelpers';

dotenv.config({ path: '.env' });

function mockReq(query: Record<string, any> = {}): any {
  return {
    query,
    user: { id: new mongoose.Types.ObjectId().toString(), role: 'ADMIN' },
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
    },
  };
  return res;
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Admin Dashboard Metrics & Trend Verification Suite  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  await connectSafeTestDb();
  console.log('✅ Connected to MongoDB isolated test database\n');

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

  try {
    // Clean test collections before running
    await Order.deleteMany({ orderNumber: /^DASH-TEST-/ });
    await Product.deleteMany({ name: /^DashLowStockProd/ });
    await WebhookEvent.deleteMany({ eventId: /^dash_evt_/ });
    await NotificationLog.deleteMany({ recipientEmail: /^dash_notif_/ });

    // ────────────────────────────────────────────────────────────────
    // TEST 1: The trend endpoint returns 0 for empty days
    // ────────────────────────────────────────────────────────────────
    console.log('\n--- 1. Testing GET /admin/dashboard/trend (Empty Days Default to 0) ---');
    const resTrend7 = mockRes();
    await getDashboardTrend(mockReq({ days: '7' }), resTrend7);

    check(resTrend7.statusCode === 200, 'Trend 7-days returns HTTP 200');
    check(resTrend7.data?.success === true, 'Trend response success flag is true');
    check(resTrend7.data?.data?.days === 7, 'Trend response reflects 7 days');
    check(Array.isArray(resTrend7.data?.data?.items), 'Trend response items is an array');
    check(resTrend7.data?.data?.items?.length === 7, 'Trend items length exactly matches 7');

    const emptyDaysCount = resTrend7.data?.data?.items?.filter((d: any) => d.revenue === 0 && d.orders === 0).length;
    check(emptyDaysCount > 0, 'Empty days are present and report 0 revenue and 0 orders (never hidden)');

    // Insert an order for today to verify that non-cancelled orders aggregate into today while older empty days stay 0
    await Order.create({
      orderNumber: `DASH-TEST-${Date.now()}`,
      userId: new mongoose.Types.ObjectId(),
      items: [{
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: 'Dashboard Test Item',
        productImage: 'https://example.com/item.jpg',
        selectedSize: 'M',
        selectedColor: 'Black',
        quantity: 1,
        unitPrice: 500,
        lineTotal: 500,
      }],
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9876543210',
        addressLine1: 'Road 1',
        city: 'Delhi',
        state: 'Delhi',
        postalCode: '110001',
        country: 'India',
        addressType: 'HOME',
      },
      subtotal: 500,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 500,
      currency: 'INR',
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
    });

    const resTrendWithOrder = mockRes();
    await getDashboardTrend(mockReq({ days: '7' }), resTrendWithOrder);
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayBucket = resTrendWithOrder.data?.data?.items?.find((d: any) => d.date === todayStr);
    check(todayBucket !== undefined, 'Today date bucket exists in trend');
    check(todayBucket?.revenue >= 500, 'Today revenue includes the created order total');
    check(todayBucket?.orders >= 1, 'Today orders includes the created order count');

    // 30 days range check
    const resTrend30 = mockRes();
    await getDashboardTrend(mockReq({ days: '30' }), resTrend30);
    check(resTrend30.data?.data?.items?.length === 30, 'Trend 30-days returns exactly 30 items');
    const emptyDaysIn30 = resTrend30.data?.data?.items?.filter((d: any) => d.revenue === 0 && d.orders === 0).length;
    check(emptyDaysIn30 >= 28, 'Empty days in 30-day range correctly return 0');

    // ────────────────────────────────────────────────────────────────
    // TEST 2: The low-stock list returns at most 5 items
    // ────────────────────────────────────────────────────────────────
    console.log('\n--- 2. Testing Low-Stock List Capped at 5 Items ---');

    // Create 7 products with stock below threshold (reorderThreshold: 5, stock: 1)
    for (let i = 1; i <= 7; i++) {
      await Product.create({
        name: `DashLowStockProd ${i}`,
        description: `Description ${i}`,
        slug: `dash-low-stock-prod-${i}-${Date.now()}`,
        status: ProductStatus.ACTIVE,
        categoryId: new mongoose.Types.ObjectId(),
        basePrice: 500,
        images: ['https://example.com/p.jpg'],
        variants: [
          {
            sku: `DASH-SKU-${i}`,
            color: 'Navy',
            size: 'L',
            stock: 2, // low stock (<= 5)
            reorderThreshold: 5,
            additionalPrice: 0,
            images: [],
            isAvailable: true,
          },
        ],
      });
    }

    const resMetrics = mockRes();
    await getDashboardMetrics(mockReq(), resMetrics);

    check(resMetrics.statusCode === 200, 'getDashboardMetrics returns HTTP 200');
    check(resMetrics.data?.data?.lowStockProducts >= 7, 'lowStockProducts count reflects total low stock variants');
    check(Array.isArray(resMetrics.data?.data?.lowStockList), 'lowStockList is returned as an array');
    check(resMetrics.data?.data?.lowStockList?.length <= 5, 'lowStockList is capped at at most 5 items');
    check(resMetrics.data?.data?.lowStockList?.length === 5, 'lowStockList contains exactly 5 items when > 5 exist');

    const firstItem = resMetrics.data?.data?.lowStockList?.[0];
    check(Boolean(firstItem?.id), 'Low stock item has id');
    check(Boolean(firstItem?.name), 'Low stock item has name');
    check(typeof firstItem?.stock === 'number', 'Low stock item has stock count');

    // ────────────────────────────────────────────────────────────────
    // TEST 3: Real System Health Operational Status (Database, Webhooks, Emails, Scheduler)
    // ────────────────────────────────────────────────────────────────
    console.log('\n--- 3. Testing Real System Health Operational Services ---');

    check(resMetrics.data?.data?.services?.database?.connected === true, 'Database reports connected: true');
    check(typeof resMetrics.data?.data?.services?.razorpay?.configured === 'boolean', 'Razorpay configured boolean present');
    check(resMetrics.data?.data?.services?.razorpay?.lastWebhookAt !== undefined, 'Razorpay lastWebhookAt field present');
    check(resMetrics.data?.data?.services?.email?.configured !== undefined, 'Email configured field present');
    check(typeof resMetrics.data?.data?.services?.email?.recentFailures === 'boolean', 'Email recentFailures boolean present');
    check(typeof resMetrics.data?.data?.services?.recoveryScheduler?.running === 'boolean', 'Recovery scheduler running boolean present');

    // ────────────────────────────────────────────────────────────────
    // TEST 4: Payment Health Breakdown Counts
    // ────────────────────────────────────────────────────────────────
    console.log('\n--- 4. Testing Payment Health Widget Data Breakdown ---');
    check(typeof resMetrics.data?.data?.paymentHealth?.webhooks?.processed === 'number', 'Webhooks processed count present');
    check(typeof resMetrics.data?.data?.paymentHealth?.webhooks?.failed === 'number', 'Webhooks failed count present');
    check(typeof resMetrics.data?.data?.paymentHealth?.attempts?.captured === 'number', 'Attempts captured count present');
    check(typeof resMetrics.data?.data?.paymentHealth?.attempts?.pending === 'number', 'Attempts pending count present');
    check(typeof resMetrics.data?.data?.paymentHealth?.attempts?.failed === 'number', 'Attempts failed count present');

    // Clean up test data
    await Order.deleteMany({ orderNumber: /^DASH-TEST-/ });
    await Product.deleteMany({ name: /^DashLowStockProd/ });

  } catch (err) {
    console.error('Unexpected test runner error:', err);
    failed++;
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exit(1);
    } else {
      console.log('All backend dashboard metrics checks passed successfully!');
      process.exit(0);
    }
  }
}

runTests();
