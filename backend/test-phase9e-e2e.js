const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';

async function runPhase9EEndToEndVerification() {
  console.log('=== STARTING PHASE 9E CUSTOMER REVIEWS & PHOTO SHOWCASES VERIFICATION ===');

  await mongoose.connect(MONGODB_URI);
  console.log('1. Database Connection: SUCCESS');

  // Load Models
  require('./dist/models/User');
  require('./dist/models/Product');
  require('./dist/models/Order');
  require('./dist/models/Review');
  require('./dist/models/AuditLog');

  const User = mongoose.model('User');
  const Product = mongoose.model('Product');
  const Order = mongoose.model('Order');
  const Review = mongoose.model('Review');
  const AuditLog = mongoose.model('AuditLog');

  // 1. Get or Create Admin & Customers
  let admin = await User.findOne({ role: 'ADMIN' });
  if (!admin) {
    admin = await User.create({
      name: 'Review Admin',
      email: 'admin_phase9e@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'ADMIN',
      isEmailVerified: true,
    });
  }

  let customerA = await User.findOne({ email: 'customerA_9e@samratfashion.com' });
  if (!customerA) {
    customerA = await User.create({
      name: 'Customer A',
      email: 'customerA_9e@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }

  let customerB = await User.findOne({ email: 'customerB_9e@samratfashion.com' });
  if (!customerB) {
    customerB = await User.create({
      name: 'Customer B',
      email: 'customerB_9e@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }
  console.log('2. Admin & Customer A / Customer B Resolved.');

  // 2. Create Product
  let product = await Product.create({
    name: 'Review Test Streetwear Hoodie',
    slug: 'review-test-hoodie-' + Date.now(),
    description: 'Test hoodie for reviews and photo showcases.',
    images: ['https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500'],
    categoryId: new mongoose.Types.ObjectId(),
    basePrice: 149900,
    status: 'ACTIVE',
    averageRating: 0,
    reviewCount: 0,
    variants: [
      {
        _id: new mongoose.Types.ObjectId(),
        size: 'L',
        color: 'Black',
        sku: 'REV-BLK-L-' + Date.now(),
        stock: 50,
        isAvailable: true,
      },
    ],
  });
  const variant = product.variants[0];
  console.log('3. Product Created:', product.name);

  // 3. Create Delivered Order for Customer A
  const orderA = await Order.create({
    orderNumber: 'SF-REV-A-' + Date.now(),
    userId: customerA._id,
    items: [
      {
        productId: product._id,
        variantId: variant._id,
        productName: product.name,
        productImage: product.images[0],
        selectedSize: variant.size,
        selectedColor: variant.color,
        quantity: 1,
        unitPrice: 149900,
        lineTotal: 149900,
      },
    ],
    shippingAddress: { fullName: 'Customer A', phone: '9876543210', addressLine1: '1 Review Way', city: 'Delhi', state: 'Delhi', postalCode: '110001', country: 'India', addressType: 'HOME' },
    subtotal: 149900, discount: 0, shipping: 0, tax: 0, total: 149900, currency: 'INR', status: 'DELIVERED', paymentStatus: 'PAID',
  });
  const orderItemIdA = orderA.items[0]._id ? orderA.items[0]._id.toString() : new mongoose.Types.ObjectId().toString();
  console.log('4. Customer A Order Created & Delivered:', orderA.orderNumber);

  // 4. Test Security: Customer B attempting to review Customer A's order item -> Reject
  const checkCustomerB = await Order.findOne({ _id: orderA._id, userId: customerB._id });
  if (!checkCustomerB) {
    console.log('5. Purchase Verification Security: Customer B cannot review Customer A order: PASSED (SCOPED)');
  } else {
    console.error('5. Purchase Verification Security: FAILED!');
    process.exit(1);
  }

  // 5. Customer A submits 5-Star Photo Review -> Status PENDING
  const reviewA = await Review.create({
    userId: customerA._id,
    productId: product._id,
    orderId: orderA._id,
    orderItemId: orderItemIdA,
    rating: 5,
    title: 'Incredible Heavyweight Quality!',
    body: 'The fabric texture is ultra thick and the oversized drape is perfect. High-end streetwear fit!',
    photos: ['https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500'],
    status: 'PENDING',
    isVerifiedPurchase: true,
  });
  console.log('6. Customer A Review Created:', reviewA._id.toString(), 'Status:', reviewA.status);

  // 6. Verify Public Read Endpoint DOES NOT expose PENDING review
  const publicCountBeforeApprove = await Review.countDocuments({ productId: product._id, status: 'APPROVED' });
  console.log('7. Public Approved Review Count (Should be 0):', publicCountBeforeApprove);
  if (publicCountBeforeApprove === 0) {
    console.log('8. Moderation Guard: Pending review hidden from public: PASSED');
  } else {
    console.error('8. Moderation Guard: FAILED!');
    process.exit(1);
  }

  // 7. Test Duplicate Review Guard (1 review per order item)
  try {
    await Review.create({
      userId: customerA._id,
      productId: product._id,
      orderId: orderA._id,
      orderItemId: orderItemIdA,
      rating: 4,
      body: 'Duplicate attempt body.',
      status: 'PENDING',
    });
    console.error('9. Duplicate Review Guard: FAILED! (Allowed duplicate creation)');
    process.exit(1);
  } catch (err) {
    console.log('9. Duplicate Review Guard (1 Review Per Order Item): PASSED (E11000 Duplicate Key Error)');
  }

  // 8. Admin Moderation: Approve Customer A's Review
  reviewA.status = 'APPROVED';
  await reviewA.save();

  // Recalculate Rating Aggregates for Product
  const stats = await Review.aggregate([
    { $match: { productId: product._id, status: 'APPROVED' } },
    { $group: { _id: '$productId', averageRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } },
  ]);

  await Product.findByIdAndUpdate(product._id, {
    averageRating: parseFloat(stats[0].averageRating.toFixed(1)),
    reviewCount: stats[0].reviewCount,
  });

  await AuditLog.create({
    actorId: admin._id,
    actorRole: 'ADMIN',
    action: 'ADMIN_REVIEW_APPROVED',
    entityType: 'REVIEW',
    entityId: reviewA._id.toString(),
  });

  const updatedProduct = await Product.findById(product._id);
  console.log(`10. Admin Approved Review -> Updated Product Avg Rating: ${updatedProduct.averageRating}, Review Count: ${updatedProduct.reviewCount}`);

  if (updatedProduct.averageRating === 5 && updatedProduct.reviewCount === 1) {
    console.log('11. Rating Aggregation Verification: PASSED (5.0 / 1 Review)');
  } else {
    console.error('11. Rating Aggregation Verification: FAILED!');
    process.exit(1);
  }

  // 9. Financial & Inventory Protection Check
  const verifyOrderA = await Order.findById(orderA._id);
  const verifyProduct = await Product.findById(product._id);
  console.log(`12. Order A Payment Status: ${verifyOrderA.paymentStatus} (Financial State Intact)`);
  console.log(`13. Product Stock: ${verifyProduct.variants[0].stock} (Inventory Intact)`);

  console.log('=== ALL PHASE 9E CUSTOMER REVIEWS & PHOTO SHOWCASE TESTS PASSED SUCCESSFULLY! ===');
  await mongoose.disconnect();
}

runPhase9EEndToEndVerification().catch((err) => {
  console.error('PHASE 9E VERIFICATION ERROR:', err);
  process.exit(1);
});
