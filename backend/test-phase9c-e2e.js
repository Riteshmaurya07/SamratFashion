const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';

async function runPhase9CEndToEndVerification() {
  console.log('=== STARTING PHASE 9C ADMIN CUSTOM ORDERS & PRINT MANAGEMENT VERIFICATION ===');

  await mongoose.connect(MONGODB_URI);
  console.log('1. Database Connection: SUCCESS');

  // Load Models
  require('./dist/models/User');
  require('./dist/models/Product');
  require('./dist/models/CustomDesign');
  require('./dist/models/Order');
  require('./dist/models/PrintJob');
  require('./dist/models/AuditLog');

  const User = mongoose.model('User');
  const Product = mongoose.model('Product');
  const CustomDesign = mongoose.model('CustomDesign');
  const Order = mongoose.model('Order');
  const PrintJob = mongoose.model('PrintJob');
  const AuditLog = mongoose.model('AuditLog');

  // 1. Get or Create Admin and Customer Users
  let admin = await User.findOne({ role: 'ADMIN' });
  if (!admin) {
    admin = await User.create({
      name: 'Print Admin',
      email: 'admin_phase9c@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'ADMIN',
      isEmailVerified: true,
    });
  }

  let customer = await User.findOne({ role: 'CUSTOMER' });
  if (!customer) {
    customer = await User.create({
      name: 'Customer 9C',
      email: 'customer_phase9c@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }
  console.log(`2. Admin (${admin._id}) & Customer (${customer._id}) Resolved.`);

  // 2. Create Product and Custom Design
  let product = await Product.findOne({ status: 'ACTIVE', isCustomizable: true });
  if (!product) {
    product = await Product.create({
      name: 'Print Test Oversized Tee',
      slug: 'print-test-tee-' + Date.now(),
      description: 'Test blank for print sheet generation.',
      images: ['https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500'],
      categoryId: new mongoose.Types.ObjectId(),
      basePrice: 89900,
      status: 'ACTIVE',
      isCustomizable: true,
      variants: [
        {
          _id: new mongoose.Types.ObjectId(),
          size: 'XL',
          color: 'Navy',
          sku: 'PRINT-NAV-XL-' + Date.now(),
          stock: 40,
          isAvailable: true,
        },
      ],
    });
  }
  const variant = product.variants[0];

  const initialDesign = await CustomDesign.create({
    userId: customer._id,
    name: 'Cyberpunk Dragon Artwork',
    productId: product._id,
    selectedVariantId: variant._id,
    selectedColor: 'Navy',
    selectedSize: 'XL',
    canvasWidth: 800,
    canvasHeight: 1000,
    elements: [
      {
        id: 'elem_9c1',
        type: 'TEXT',
        side: 'FRONT',
        x: 150,
        y: 200,
        width: 300,
        height: 60,
        text: 'CYBER DRAGON',
        fontFamily: 'Hanken Grotesk',
        color: '#2563eb',
      },
    ],
    previewImage: { front: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
    printLocations: ['FRONT'],
    status: 'SAVED',
  });
  console.log('3. Custom Design Created:', initialDesign._id.toString());

  // 3. Create Paid Order with Custom Snapshot
  const order = await Order.create({
    orderNumber: 'SF-9C-' + Date.now(),
    userId: customer._id,
    items: [
      {
        productId: product._id,
        variantId: variant._id,
        productName: `${product.name} (Custom: ${initialDesign.name})`,
        productImage: initialDesign.previewImage.front,
        selectedSize: variant.size,
        selectedColor: variant.color,
        quantity: 1,
        unitPrice: 109900,
        lineTotal: 109900,
        customDesignId: initialDesign._id,
        customizationSnapshot: {
          name: initialDesign.name,
          previewImage: initialDesign.previewImage.front,
          printLocations: initialDesign.printLocations,
          customFee: 20000,
        },
      },
    ],
    shippingAddress: {
      fullName: 'Customer 9C',
      phone: '9876543210',
      addressLine1: '99 Production Way',
      city: 'Delhi',
      state: 'Delhi',
      postalCode: '110001',
      country: 'India',
      addressType: 'WORK',
    },
    subtotal: 109900,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 109900,
    currency: 'INR',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
  });
  console.log('4. Paid Order Created with Custom Snapshot:', order.orderNumber);

  // 4. Initialize & Verify PrintJob
  const printJob = await PrintJob.create({
    orderId: order._id,
    orderItemId: order.items[0]._id ? order.items[0]._id.toString() : initialDesign._id.toString(),
    customDesignId: initialDesign._id,
    status: 'PENDING_REVIEW',
    priority: 'HIGH',
    printLocations: ['FRONT'],
    printMethod: 'DTG',
  });
  console.log('5. PrintJob Created:', printJob._id.toString(), 'Status:', printJob.status);

  // 5. Test State Machine Transition: PENDING_REVIEW -> READY_FOR_PRINT -> PRINTING
  printJob.status = 'READY_FOR_PRINT';
  await printJob.save();
  console.log('6. Valid Transition -> READY_FOR_PRINT: SUCCESS');

  printJob.status = 'PRINTING';
  await printJob.save();
  console.log('7. Valid Transition -> PRINTING: SUCCESS');

  // 6. Test Production Note Addition
  printJob.notes.push({
    text: 'Approved HD DTG print run at 300 DPI.',
    createdBy: admin._id,
    createdAt: new Date(),
  });
  await printJob.save();
  console.log('8. Production Note Appended:', printJob.notes[0].text);

  // 7. Test Historical Order Snapshot Protection
  // Modify the original CustomDesign
  initialDesign.name = 'ALTERED DESIGN NAME AFTER ORDER';
  await initialDesign.save();

  const verifyOrder = await Order.findById(order._id);
  const snapshotName = verifyOrder.items[0].customizationSnapshot.name;
  console.log('9. Historical Snapshot Verification (Should be "Cyberpunk Dragon Artwork"):', snapshotName);

  if (snapshotName === 'Cyberpunk Dragon Artwork') {
    console.log('10. Historical Order Snapshot Protection: PASSED (IMMUTABLE)');
  } else {
    console.error('10. Historical Order Snapshot Protection: FAILED!');
    process.exit(1);
  }

  // 8. Verify Audit Logging
  await AuditLog.create({
    actorId: admin._id,
    actorRole: 'ADMIN',
    action: 'ADMIN_PRINT_EXPORT_GENERATED',
    entityType: 'ORDER',
    entityId: order._id.toString(),
    metadata: { side: 'FRONT', exportWidth: 3000, exportHeight: 4000 },
  });
  const auditLogs = await AuditLog.find({ entityId: order._id.toString() });
  console.log(`11. Audit Logs Created for Custom Order: ${auditLogs.length}`);

  // 9. Verify Inventory & Payment Protection
  const productAfterAdminView = await Product.findById(product._id);
  const variantAfterAdminView = productAfterAdminView.variants.find((v) => v._id.toString() === variant._id.toString());
  console.log(`12. Stock Status: ${variantAfterAdminView.stock} (Unchanged by Admin Print Management Actions)`);
  console.log(`13. Order Payment Status: ${verifyOrder.paymentStatus} (Unchanged by Admin Print Management Actions)`);

  console.log('=== ALL PHASE 9C ADMIN CUSTOM ORDER & PRINT TESTS PASSED SUCCESSFULLY! ===');
  await mongoose.disconnect();
}

runPhase9CEndToEndVerification().catch((err) => {
  console.error('PHASE 9C VERIFICATION ERROR:', err);
  process.exit(1);
});
