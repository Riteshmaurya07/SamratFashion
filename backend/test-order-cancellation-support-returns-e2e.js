const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, './.env') });
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_fallback_access_secret_only';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_fallback_refresh_secret_only';
const axios = require('axios');
const mongoose = require('mongoose');

const API_URL = 'http://localhost:5000/api';

async function runE2ETests() {
  console.log('--- STARTING ORDER DETAILS ACTIONS, CANCELLATION, SUPPORT & RETURN E2E TESTS ---');

  try {
    // Connect DB directly for seeding test records
    const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat-fashion';
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected to MongoDB');

    const { User } = require('./dist/models/User');
    const { Order } = require('./dist/models/Order');
    const { Product } = require('./dist/models/Product');
    const { PrintJob } = require('./dist/models/PrintJob');
    const { ReturnRequest } = require('./dist/models/ReturnRequest');
    const { Shipment } = require('./dist/models/Shipment');

    // 1. Authenticate Customer
    const jwt = require('jsonwebtoken');
    const { getJwtAccessSecret } = require('./dist/config/env');
    const testEmail = `cust_e2e_${Date.now()}@example.com`;
    const testPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
    const testPassword = 'Password123!';
    
    const user = await User.create({
      name: 'E2E Customer',
      email: testEmail,
      passwordHash: '$2b$10$e80gS5Jb17g/9ZJ.o3hZ8e3E4X7uV5K1.',
      phone: testPhone,
      role: 'CUSTOMER'
    });
    const userId = user._id;
    const token = jwt.sign({ sub: user._id, role: 'CUSTOMER' }, getJwtAccessSecret(), { expiresIn: '1d' });
    const authHeaders = { headers: { Authorization: `Bearer ${token}` } };
    console.log('✓ Test Customer created & token signed directly');

    // 2. Fetch or create a test product
    let product = await Product.findOne();
    if (!product) {
      product = await Product.create({
        name: 'Classic E2E Cotton T-Shirt',
        slug: `classic-e2e-tshirt-${Date.now()}`,
        description: 'Quality cotton shirt',
        price: 999,
        basePrice: 999,
        categoryId: new mongoose.Types.ObjectId(),
        category: 'T-Shirts',
        variants: [{ color: 'Black', size: 'L', stock: 50, sku: `SKU-${Date.now()}` }],
        images: ['/placeholder.png']
      });
    }

    // TEST A: Standard Pre-shipment Cancellation
    console.log('\n[TEST A] Standard Pre-Shipment Order Cancellation...');
    const orderA = await Order.create({
      userId: userId,
      orderNumber: `SF-E2E-A-${Date.now()}`,
      items: [{
        productId: product._id,
        variantId: product.variants[0]._id,
        productName: product.name,
        productImage: product.images[0],
        selectedSize: 'L',
        selectedColor: 'Black',
        quantity: 1,
        unitPrice: 999,
        lineTotal: 999
      }],
      subtotal: 999,
      discount: 0,
      shipping: 0,
      tax: 180,
      total: 1179,
      shippingAddress: {
        fullName: 'E2E Tester',
        addressLine1: '123 Main St',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        country: 'India',
        phone: '9876543210'
      },
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      status: 'CONFIRMED'
    });

    const cancelRes = await axios.post(`${API_URL}/orders/${orderA._id}/cancel`, {
      reason: 'CHANGED_MIND'
    }, authHeaders);
    console.log('✓ Cancellation response:', cancelRes.data.message);

    const updatedOrderA = await Order.findById(orderA._id);
    if (updatedOrderA.status !== 'CANCELLED') {
      throw new Error(`Expected order status CANCELLED, got ${updatedOrderA.status}`);
    }
    console.log('✓ PASS: Standard order successfully cancelled before shipment');

    // TEST B: Shipped Order Cancellation Rejection
    console.log('\n[TEST B] Shipped Order Cancellation Rejection...');
    const orderB = await Order.create({
      userId: userId,
      orderNumber: `SF-E2E-B-${Date.now()}`,
      items: [{
        productId: product._id,
        variantId: product.variants[0]._id,
        productName: product.name,
        productImage: product.images[0],
        selectedSize: 'L',
        selectedColor: 'Black',
        quantity: 1,
        unitPrice: 999,
        lineTotal: 999
      }],
      subtotal: 999,
      discount: 0,
      shipping: 0,
      tax: 180,
      total: 1179,
      shippingAddress: {
        fullName: 'E2E Tester',
        addressLine1: '123 Main St',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        country: 'India',
        phone: '9876543210'
      },
      paymentMethod: 'COD',
      paymentStatus: 'PAID',
      status: 'SHIPPED'
    });

    try {
      await axios.post(`${API_URL}/orders/${orderB._id}/cancel`, { reason: 'CHANGED_MIND' }, authHeaders);
      throw new Error('FAILED: Shipped order cancellation should have been rejected!');
    } catch (err) {
      if (err.response && err.response.status === 400) {
        console.log('✓ PASS: Shipped order cancellation rejected as expected:', err.response.data.message);
      } else {
        throw err;
      }
    }

    // TEST C: Custom Print Confirmation Cancellation Rejection
    console.log('\n[TEST C] Custom Print Confirmed Order Cancellation Rejection...');
    const dummyCustomId = new mongoose.Types.ObjectId();
    const orderC = await Order.create({
      userId: userId,
      orderNumber: `SF-E2E-C-${Date.now()}`,
      items: [{
        productId: product._id,
        variantId: product.variants[0]._id,
        customDesignId: dummyCustomId,
        customizationSnapshot: { previewImage: 'http://example.com/custom.png' },
        productName: 'Custom Printed Tee',
        productImage: product.images[0],
        selectedSize: 'L',
        selectedColor: 'Black',
        quantity: 1,
        unitPrice: 1299,
        lineTotal: 1299
      }],
      subtotal: 1299,
      discount: 0,
      shipping: 0,
      tax: 233,
      total: 1532,
      shippingAddress: {
        fullName: 'E2E Tester',
        addressLine1: '123 Main St',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        country: 'India',
        phone: '9876543210'
      },
      paymentMethod: 'COD',
      paymentStatus: 'PAID',
      status: 'PROCESSING'
    });

    // Create a confirmed PrintJob for orderC
    await PrintJob.create({
      orderId: orderC._id,
      orderItemId: product.variants[0]._id.toString(),
      customDesignId: dummyCustomId,
      status: 'READY_FOR_PRINT',
      priority: 'MEDIUM',
      printLocations: ['FRONT']
    });

    try {
      await axios.post(`${API_URL}/orders/${orderC._id}/cancel`, { reason: 'CHANGED_MIND' }, authHeaders);
      throw new Error('FAILED: Confirmed custom print order cancellation should have been rejected!');
    } catch (err) {
      if (err.response && err.response.status === 400) {
        console.log('✓ PASS: Custom print confirmed order cancellation rejected as expected:', err.response.data.message);
      } else {
        throw err;
      }
    }

    // TEST D: Custom Print Return Policy Validation
    console.log('\n[TEST D] Custom Print Return Policy Validation...');
    const orderD = await Order.create({
      userId: userId,
      orderNumber: `SF-E2E-D-${Date.now()}`,
      items: [{
        productId: product._id,
        variantId: product.variants[0]._id,
        customDesignId: dummyCustomId,
        customizationSnapshot: { previewImage: 'http://example.com/custom.png' },
        productName: 'Custom Printed Tee',
        productImage: product.images[0],
        selectedSize: 'L',
        selectedColor: 'Black',
        quantity: 10,
        unitPrice: 1299,
        lineTotal: 12990
      }],
      subtotal: 12990,
      discount: 0,
      shipping: 0,
      tax: 2338,
      total: 15328,
      shippingAddress: {
        fullName: 'E2E Tester',
        addressLine1: '123 Main St',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        country: 'India',
        phone: '9876543210'
      },
      paymentMethod: 'COD',
      paymentStatus: 'PAID',
      status: 'DELIVERED'
    });

    const { createReturn } = require('./dist/controllers/returnController');
    async function callCreateReturn(orderId, uId, items, customerNote) {
      return new Promise((resolve, reject) => {
        const req = {
          params: { id: orderId.toString() },
          user: { id: uId.toString(), role: 'CUSTOMER' },
          body: { items, customerNote }
        };
        const res = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(payload) {
            if (this.statusCode >= 400) {
              const err = new Error(payload.message || 'API Error');
              err.response = { status: this.statusCode, data: payload };
              reject(err);
            } else {
              resolve({ data: payload });
            }
          }
        };
        const next = (err) => {
          if (err) {
            err.response = { status: err.statusCode || 500, data: { message: err.message } };
            reject(err);
          }
        };
        createReturn(req, res, next);
      });
    }

    const rejectedCustomReasons = ['DEFECTIVE', 'WRONG_SIZE', 'NOT_AS_DESCRIBED', 'OTHER'];
    for (const rReason of rejectedCustomReasons) {
      try {
        await callCreateReturn(orderD._id, userId, [{
          variantId: product.variants[0]._id.toString(),
          quantity: 1,
          reason: rReason
        }]);
        throw new Error(`FAILED: Custom item return for ${rReason} should have been rejected!`);
      } catch (err) {
        if (err.response && err.response.status === 400) {
          console.log(`✓ PASS: Custom item return for ${rReason} rejected as expected:`, err.response.data.message);
        } else {
          throw err;
        }
      }
    }

    // Attempt WRONG_PRODUCT return for custom item (must be allowed)
    const validReturnRes1 = await callCreateReturn(orderD._id, userId, [{
      variantId: product.variants[0]._id.toString(),
      quantity: 1,
      reason: 'WRONG_PRODUCT'
    }], 'Received wrong package design');
    console.log('✓ PASS: Custom item return for WRONG_PRODUCT created successfully. Return ID:', validReturnRes1.data.data._id);

    // Attempt DAMAGED return for custom item (must be allowed)
    const validReturnRes2 = await callCreateReturn(orderD._id, userId, [{
      variantId: product.variants[0]._id.toString(),
      quantity: 1,
      reason: 'DAMAGED'
    }], 'Print torn during shipping');
    console.log('✓ PASS: Custom item return for DAMAGED created successfully. Return ID:', validReturnRes2.data.data._id);

    // TEST D2: Normal Product Return Policy Validation (DEFECTIVE & WRONG_SIZE allowed)
    console.log('\n[TEST D2] Normal Product Return Policy Validation...');
    const orderD2 = await Order.create({
      userId: userId,
      orderNumber: `SF-E2E-D2-${Date.now()}`,
      items: [{
        productId: product._id,
        variantId: product.variants[0]._id,
        productName: 'Normal Cotton Tee',
        productImage: product.images[0],
        selectedSize: 'L',
        selectedColor: 'Black',
        quantity: 5,
        unitPrice: 999,
        lineTotal: 4995
      }],
      subtotal: 4995,
      discount: 0,
      shipping: 0,
      tax: 899,
      total: 5894,
      shippingAddress: {
        fullName: 'E2E Tester',
        addressLine1: '123 Main St',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        country: 'India',
        phone: '9876543210'
      },
      paymentMethod: 'COD',
      paymentStatus: 'PAID',
      status: 'DELIVERED'
    });

    const normalReturnRes1 = await callCreateReturn(orderD2._id, userId, [{
      variantId: product.variants[0]._id.toString(),
      quantity: 1,
      reason: 'DEFECTIVE'
    }]);
    console.log('✓ PASS: Normal item return for DEFECTIVE created successfully. Return ID:', normalReturnRes1.data.data._id);

    const normalReturnRes2 = await callCreateReturn(orderD2._id, userId, [{
      variantId: product.variants[0]._id.toString(),
      quantity: 1,
      reason: 'WRONG_SIZE'
    }]);
    console.log('✓ PASS: Normal item return for WRONG_SIZE created successfully. Return ID:', normalReturnRes2.data.data._id);

    // TEST E: Order-Context Support Ticket Creation
    console.log('\n[TEST E] Support Ticket Creation with Order Context...');
    const ticketRes = await axios.post(`${API_URL}/support/tickets`, {
      subject: 'Inquiry regarding cancelled order refund status',
      category: 'ORDER',
      description: 'I would like to check when the refund for my cancelled order will be processed.',
      orderId: orderA._id.toString()
    }, authHeaders);
    console.log('✓ PASS: Support ticket created with order context:', ticketRes.data.data.ticketNumber);

    console.log('\n======================================================');
    console.log('ALL ORDER DETAILS ACTIONS, CANCELLATION & RETURN E2E TESTS PASSED 100%');
    console.log('======================================================\n');
    process.exit(0);

  } catch (err) {
    console.error('❌ E2E TEST FAILED:', err.response?.data || err.message);
    process.exit(1);
  }
}

runE2ETests();
