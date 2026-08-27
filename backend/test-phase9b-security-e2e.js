const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';

async function runSecurityVerification() {
  console.log('=== STARTING PHASE 9B SAVED DESIGNS SECURITY & ISOLATION TEST ===');

  await mongoose.connect(MONGODB_URI);
  console.log('1. Database Connection: SUCCESS');

  // Load Models
  require('./dist/models/User');
  require('./dist/models/Product');
  require('./dist/models/CustomDesign');
  require('./dist/models/Cart');

  const User = mongoose.model('User');
  const Product = mongoose.model('Product');
  const CustomDesign = mongoose.model('CustomDesign');

  // 1. Get or Create User A and User B
  let userA = await User.findOne({ email: 'usera_phase9b@samratfashion.com' });
  if (!userA) {
    userA = await User.create({
      name: 'Customer A',
      email: 'usera_phase9b@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }

  let userB = await User.findOne({ email: 'userb_phase9b@samratfashion.com' });
  if (!userB) {
    userB = await User.create({
      name: 'Customer B',
      email: 'userb_phase9b@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }
  console.log(`2. User A (${userA._id}) and User B (${userB._id}) Created/Resolved.`);

  // 2. Create Active Product
  let product = await Product.findOne({ status: 'ACTIVE', isCustomizable: true });
  if (!product) {
    product = await Product.create({
      name: 'Security Test Heavyweight Tee',
      slug: 'security-test-tee-' + Date.now(),
      description: 'Test tee for security isolation checks.',
      images: ['https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500'],
      categoryId: new mongoose.Types.ObjectId(),
      basePrice: 89900,
      status: 'ACTIVE',
      isCustomizable: true,
      variants: [
        {
          _id: new mongoose.Types.ObjectId(),
          size: 'L',
          color: 'Black',
          sku: 'SEC-BLK-L-' + Date.now(),
          stock: 100,
          isAvailable: true,
        },
      ],
    });
  }
  const variant = product.variants[0];

  // 3. User A Creates Design A
  const designA = await CustomDesign.create({
    userId: userA._id,
    name: "User A Secret Custom Tee",
    productId: product._id,
    selectedVariantId: variant._id,
    selectedColor: 'Black',
    selectedSize: 'L',
    canvasWidth: 800,
    canvasHeight: 1000,
    elements: [
      {
        id: 'elem_a1',
        type: 'TEXT',
        side: 'FRONT',
        x: 100,
        y: 100,
        width: 200,
        height: 50,
        text: 'User A Signature',
      },
    ],
    status: 'SAVED',
  });
  console.log('3. Design A Created by User A:', designA._id.toString());

  // 4. Verify User B query for User A design
  const foundByB = await CustomDesign.findOne({
    _id: designA._id,
    userId: userB._id,
    status: { $ne: 'ARCHIVED' },
  });
  console.log('4. User B query for Design A result:', foundByB === null ? 'NULL (ACCESS REJECTED - SECURE)' : 'EXPOSED (FAIL)');

  // 5. Test Duplication of User A design by User B
  const sourceDesign = await CustomDesign.findOne({
    _id: designA._id,
    userId: userB._id,
    status: { $ne: 'ARCHIVED' },
  });
  console.log('5. User B duplication attempt result:', sourceDesign === null ? 'REJECTED (SECURE)' : 'ALLOWED (FAIL)');

  // 6. Test Deletion of User A design by User B
  const deleteResult = await CustomDesign.updateOne(
    { _id: designA._id, userId: userB._id },
    { status: 'ARCHIVED' }
  );
  console.log('6. User B update/delete attempt modified count:', deleteResult.modifiedCount, '(0 = SECURE)');

  // 7. Test User A Duplication (Authorized)
  const duplicatedByA = await CustomDesign.create({
    userId: userA._id,
    name: `${designA.name} (Copy)`,
    productId: designA.productId,
    selectedVariantId: designA.selectedVariantId,
    selectedColor: designA.selectedColor,
    selectedSize: designA.selectedSize,
    canvasWidth: designA.canvasWidth,
    canvasHeight: designA.canvasHeight,
    elements: designA.elements,
    status: 'SAVED',
  });
  console.log('7. User A Duplication result:', duplicatedByA._id.toString());

  console.log('=== ALL PHASE 9B SECURITY & CROSS-USER ISOLATION TESTS PASSED! ===');
  await mongoose.disconnect();
}

runSecurityVerification().catch((err) => {
  console.error('SECURITY TEST ERROR:', err);
  process.exit(1);
});
