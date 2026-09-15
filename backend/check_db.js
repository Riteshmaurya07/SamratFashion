const mongoose = require('mongoose');

async function run() {
  await mongoose.connect('mongodb://localhost:27017/samrat-fashion');
  const db = mongoose.connection;
  
  const product = await db.collection('products').findOne({ name: 'Cyber Neon Heavyweight Oversized Tee' });
  console.log("Product variants count:", product?.variants?.length);
  if (product && product.variants) {
    product.variants.forEach(v => {
      console.log(`Variant ID: ${v._id}, SKU: ${v.sku}, Color: ${v.color}, Images count: ${v.images?.length}`);
    });
  }

  const wishlist = await db.collection('wishlists').find().toArray();
  console.log("\nWishlists:", JSON.stringify(wishlist, null, 2));

  mongoose.disconnect();
}

run().catch(console.error);
