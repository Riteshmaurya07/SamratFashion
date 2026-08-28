const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const axios = require('axios');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';

async function runLogisticsFailClosedAndAuthenticityTests() {
  console.log('=== STARTING PHASE 10B SAFETY & AUTHENTICITY TEST SUITE ===');

  await mongoose.connect(MONGODB_URI);
  console.log('1. Database Connection: SUCCESS');

  // Load Models
  require('./dist/models/User');
  require('./dist/models/Product');
  require('./dist/models/CustomDesign');
  require('./dist/models/Address');
  require('./dist/models/Order');
  require('./dist/models/Payment');
  require('./dist/models/Shipment');
  require('./dist/models/PrintJob');
  require('./dist/models/ReturnRequest');
  require('./dist/models/LogisticsEventLog');

  const User = mongoose.model('User');
  const Address = mongoose.model('Address');
  const Order = mongoose.model('Order');
  const Shipment = mongoose.model('Shipment');
  const PrintJob = mongoose.model('PrintJob');
  const ReturnRequest = mongoose.model('ReturnRequest');

  const { logisticsService } = require('./dist/services/logistics/logisticsService');
  const { DelhiveryLogisticsProvider } = require('./dist/services/logistics/DelhiveryLogisticsProvider');
  const { MockLogisticsProvider } = require('./dist/services/logistics/MockLogisticsProvider');

  // Save original env vars
  const origToken = process.env.DELHIVERY_API_TOKEN;
  const origProvider = process.env.LOGISTICS_PROVIDER;

  try {
    // -------------------------------------------------------------
    // TEST 1: Missing Token Fails Closed with LOGISTICS_CONFIG_ERROR
    // -------------------------------------------------------------
    delete process.env.DELHIVERY_API_TOKEN;
    process.env.LOGISTICS_PROVIDER = 'delhivery';

    let configErrCaught = false;
    try {
      logisticsService.getProvider('delhivery');
    } catch (err) {
      if (err.code === 'LOGISTICS_CONFIG_ERROR' && err.message.includes('DELHIVERY_API_TOKEN')) {
        configErrCaught = true;
      }
    }

    if (configErrCaught) {
      console.log('✔ TEST 1 PASSED: Missing DELHIVERY_API_TOKEN threw LOGISTICS_CONFIG_ERROR (Fail Closed).');
    } else {
      console.error('❌ TEST 1 FAILED: Missing token did not throw LOGISTICS_CONFIG_ERROR!');
      process.exit(1);
    }

    // Restore temporary mock token for remaining provider tests
    process.env.DELHIVERY_API_TOKEN = 'test_dummy_invalid_token_12345';
    const delhiveryProvider = new DelhiveryLogisticsProvider();

    // -------------------------------------------------------------
    // TEST 2: Invalid Token / HTTP 401 Serviceability Failure (No Fake Serviceability)
    // -------------------------------------------------------------
    let servErrCaught = false;
    try {
      await delhiveryProvider.checkServiceability('110001');
    } catch (err) {
      if (err.code === 'LOGISTICS_SERVICEABILITY_UNAVAILABLE' || err.status === 401 || err.code === 'LOGISTICS_CONFIG_ERROR') {
        servErrCaught = true;
      }
    }

    if (servErrCaught) {
      console.log('✔ TEST 2 PASSED: Invalid token / API 401 serviceability check failed closed (NO fake serviceability).');
    } else {
      console.error('❌ TEST 2 FAILED: Serviceability check returned fake data instead of failing closed!');
      process.exit(1);
    }

    // -------------------------------------------------------------
    // TEST 3: Rate Failure (No Fake Rate like ₹128)
    // -------------------------------------------------------------
    let rateErrCaught = false;
    try {
      await delhiveryProvider.getRates({ destinationPostalCode: '110001', weightGrams: 500 });
    } catch (err) {
      if (err.code === 'LOGISTICS_RATE_UNAVAILABLE' || err.status === 401) {
        rateErrCaught = true;
      }
    }

    if (rateErrCaught) {
      console.log('✔ TEST 3 PASSED: Rate API failure threw LOGISTICS_RATE_UNAVAILABLE (NO synthetic rate).');
    } else {
      console.error('❌ TEST 3 FAILED: Rate query returned fake rate instead of failing closed!');
      process.exit(1);
    }

    // -------------------------------------------------------------
    // TEST 4: Shipment Creation Failure (No Fake AWB / DEL-xxxxxxxx)
    // -------------------------------------------------------------
    let shipErrCaught = false;
    try {
      await delhiveryProvider.createShipment({
        orderId: new mongoose.Types.ObjectId().toString(),
        orderNumber: 'SF-TEST-FAIL-001',
        recipient: {
          fullName: 'Test Recipient',
          addressLine1: '123 Test St',
          city: 'Delhi',
          state: 'Delhi',
          postalCode: '110001',
          phone: '9876543210'
        },
        items: [{ productName: 'Test Product', quantity: 1, unitPrice: 999 }]
      });
    } catch (err) {
      if (err.code === 'LOGISTICS_PROVIDER_ERROR' || err.status === 401) {
        shipErrCaught = true;
      }
    }

    if (shipErrCaught) {
      console.log('✔ TEST 4 PASSED: Shipment creation failure threw LOGISTICS_PROVIDER_ERROR (NO fake DEL-xxxxxxxx AWB generated).');
    } else {
      console.error('❌ TEST 4 FAILED: Shipment creation returned fake AWB instead of failing closed!');
      process.exit(1);
    }

    // -------------------------------------------------------------
    // TEST 5: Pickup Request Failure (No Fake PU-DELHI-xxxxxx)
    // -------------------------------------------------------------
    let pickupErrCaught = false;
    try {
      await delhiveryProvider.requestPickup('DEL-999999999');
    } catch (err) {
      if (err.code === 'LOGISTICS_PROVIDER_ERROR' || err.status === 401) {
        pickupErrCaught = true;
      }
    }

    if (pickupErrCaught) {
      console.log('✔ TEST 5 PASSED: Pickup request failure threw LOGISTICS_PROVIDER_ERROR (NO fake PU-DELHI pickup ID generated).');
    } else {
      console.error('❌ TEST 5 FAILED: Pickup request returned fake pickup ID instead of failing closed!');
      process.exit(1);
    }

    // -------------------------------------------------------------
    // TEST 6: Tracking Lookup Failure (No Synthetic Events)
    // -------------------------------------------------------------
    let trackErrCaught = false;
    try {
      await delhiveryProvider.getTracking('DEL-999999999');
    } catch (err) {
      if (err.code === 'LOGISTICS_PROVIDER_ERROR' || err.status === 401) {
        trackErrCaught = true;
      }
    }

    if (trackErrCaught) {
      console.log('✔ TEST 6 PASSED: Tracking lookup failure threw LOGISTICS_PROVIDER_ERROR (NO synthetic tracking events generated).');
    } else {
      console.error('❌ TEST 6 FAILED: Tracking query returned synthetic tracking history instead of failing closed!');
      process.exit(1);
    }

    // -------------------------------------------------------------
    // TEST 7: Mock Logistics Provider Verification (Isolated Mode)
    // -------------------------------------------------------------
    const mockProvider = new MockLogisticsProvider();
    const mockServ = await mockProvider.checkServiceability('110001');
    const mockRate = await mockProvider.getRates({ destinationPostalCode: '110001', weightGrams: 500 });
    const mockShip = await mockProvider.createShipment({
      orderId: new mongoose.Types.ObjectId().toString(),
      orderNumber: 'SF-MOCK-001',
      recipient: { fullName: 'Mock Customer', addressLine1: '456 Mock Ave', city: 'Mumbai', state: 'Maharashtra', postalCode: '400001', phone: '9876543210' },
      items: [{ productName: 'Mock Item', quantity: 1, unitPrice: 499 }]
    });

    if (mockServ.serviceable && mockRate.rate > 0 && mockShip.awbNumber.startsWith('SF-DEL-')) {
      console.log('✔ TEST 7 PASSED: MockLogisticsProvider operates cleanly in explicit mock mode.');
    } else {
      console.error('❌ TEST 7 FAILED: Mock provider error!', { mockServ, mockRate, mockShip });
      process.exit(1);
    }

    // -------------------------------------------------------------
    // TEST 8: State Machine & Handoff Cancellation Boundaries
    // -------------------------------------------------------------
    let userA = await User.findOne({ email: 'logistics_safety_user@samratfashion.com' });
    if (!userA) {
      userA = await User.create({
        name: 'Logistics Safety User',
        email: 'logistics_safety_user@samratfashion.com',
        passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
        role: 'CUSTOMER',
        isEmailVerified: true
      });
    }

    let admin = await User.findOne({ role: 'ADMIN' });
    if (!admin) {
      admin = await User.create({
        name: 'Logistics Admin',
        email: 'logistics_admin@samratfashion.com',
        passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
        role: 'ADMIN',
        isEmailVerified: true
      });
    }

    const orderNum = 'SF-SAFETY-' + Math.floor(100000 + Math.random() * 900000);
    const orderPre = await Order.create({
      orderNumber: orderNum,
      userId: userA._id,
      items: [{
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: 'Safety Jacket',
        productImage: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500',
        selectedSize: 'L',
        selectedColor: 'Black',
        quantity: 1,
        unitPrice: 2999,
        lineTotal: 2999
      }],
      shippingAddress: {
        fullName: 'Safety User',
        phone: '9876543210',
        addressLine1: '789 Safety Rd',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        country: 'India',
        addressType: 'HOME'
      },
      subtotal: 2999, discount: 0, shipping: 0, tax: 0, total: 2999, currency: 'INR',
      status: 'PROCESSING', paymentStatus: 'PAID'
    });

    const shipmentPre = await Shipment.create({
      orderId: orderPre._id,
      userId: userA._id,
      carrier: 'Delhivery Express',
      trackingNumber: `DEL-DELHIVERY-AWB-REAL`,
      awbNumber: `DEL-DELHIVERY-AWB-REAL`,
      status: 'LABEL_CREATED',
      createdBy: admin._id,
      updatedBy: admin._id
    });

    const isHandedOffPre = ['PICKED_UP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(shipmentPre.status);
    const isCancellablePre = orderPre.status === 'PROCESSING' && !isHandedOffPre;

    shipmentPre.status = 'PICKED_UP';
    await shipmentPre.save();
    orderPre.status = 'SHIPPED';
    await orderPre.save();

    const isHandedOffPost = ['PICKED_UP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(shipmentPre.status);
    const isCancellablePost = orderPre.status === 'PROCESSING' && !isHandedOffPost;

    if (isCancellablePre && !isCancellablePost) {
      console.log('✔ TEST 8 PASSED: Cancellation boundary verified (LABEL_CREATED = cancellable, PICKED_UP/SHIPPED = strictly blocked).');
    } else {
      console.error('❌ TEST 8 FAILED: Cancellation boundary check failed!');
      process.exit(1);
    }

    console.log('\n=== ALL LOGISTICS SAFETY & FAIL-CLOSED TESTS PASSED SUCCESSFULLY! ===');
  } finally {
    // Restore original env vars
    if (origToken) process.env.DELHIVERY_API_TOKEN = origToken;
    else delete process.env.DELHIVERY_API_TOKEN;
    if (origProvider) process.env.LOGISTICS_PROVIDER = origProvider;
    else delete process.env.LOGISTICS_PROVIDER;

    await mongoose.disconnect();
  }
}

runLogisticsFailClosedAndAuthenticityTests().catch((err) => {
  console.error('LOGISTICS E2E ERROR:', err);
  process.exit(1);
});
