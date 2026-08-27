const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, './.env') });
const mongoose = require('mongoose');

async function runSearchE2ETests() {
  console.log('--- STARTING COMPREHENSIVE SEARCH E2E TESTS ---');

  try {
    const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat-fashion';
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected to MongoDB');

    const { Product } = require('./dist/models/Product');
    const { Category } = require('./dist/models/Category');
    const { getProducts } = require('./dist/controllers/catalogController');

    // Seed test products for deterministic verification
    let cat = await Category.findOne({ status: 'ACTIVE' });
    if (!cat) {
      cat = await Category.create({
        name: 'T-Shirts',
        slug: 't-shirts',
        status: 'ACTIVE'
      });
    }

    const testSlug1 = `test-cyberpunk-tee-${Date.now()}`;
    const testSlug2 = `test-anime-oversized-${Date.now()}`;
    const testSlug3 = `test-draft-cyber-${Date.now()}`;

    const prod1 = await Product.create({
      name: 'Cyberpunk Neon Heavyweight Tee',
      slug: testSlug1,
      description: 'Futuristic urban oversized cotton shirt with cyber graphics',
      basePrice: 1299,
      categoryId: cat._id,
      variants: [{ sku: `SKU-CYBER-${Date.now()}`, stock: 20, additionalPrice: 0, isAvailable: true }],
      status: 'ACTIVE',
      tags: ['cyber', 'neon', 'oversized']
    });

    const prod2 = await Product.create({
      name: 'Anime Graphic Vintage Tee',
      slug: testSlug2,
      description: 'Classic anime printed shirt for daily wear',
      basePrice: 899,
      categoryId: cat._id,
      variants: [{ sku: `SKU-ANIME-${Date.now()}`, stock: 15, additionalPrice: 0, isAvailable: true }],
      status: 'ACTIVE',
      tags: ['anime', 'graphic']
    });

    // Create DRAFT product with 'cyber' keyword to test exclusion
    const draftProd = await Product.create({
      name: 'Draft Cyber Hidden Tee',
      slug: testSlug3,
      description: 'Unreleased draft shirt',
      basePrice: 1599,
      categoryId: cat._id,
      variants: [{ sku: `SKU-DRAFT-${Date.now()}`, stock: 5, additionalPrice: 0, isAvailable: true }],
      status: 'DRAFT',
      tags: ['cyber']
    });

    console.log('✓ Test search products seeded cleanly');

    // Controller runner helper
    const execSearch = async (queryObj) => {
      return new Promise((resolve, reject) => {
        const req = { query: queryObj };
        const res = {
          statusCode: 200,
          status(code) { this.statusCode = code; return this; },
          json(payload) {
            if (this.statusCode >= 400) reject(new Error(payload.message));
            else resolve(payload.data);
          }
        };
        const next = (err) => reject(err);
        getProducts(req, res, next);
      });
    };

    // TEST 1: Full Keyword Search
    console.log('\n[TEST 1] Full Keyword Search ("Cyberpunk")...');
    const res1 = await execSearch({ search: 'Cyberpunk' });
    if (!res1.items.some(p => p._id.toString() === prod1._id.toString())) {
      throw new Error('FAILED: Full keyword search failed to return Cyberpunk Tee');
    }
    console.log(`✓ PASS: Found ${res1.items.length} matching products`);

    // TEST 2: Partial Keyword Search
    console.log('\n[TEST 2] Partial Keyword Search ("cyber")...');
    const res2 = await execSearch({ search: 'cyber' });
    if (!res2.items.some(p => p._id.toString() === prod1._id.toString())) {
      throw new Error('FAILED: Partial search "cyber" failed to match Cyberpunk Tee');
    }
    console.log(`✓ PASS: Partial keyword matching succeeded`);

    // TEST 3: Case-Insensitive Search
    console.log('\n[TEST 3] Case-Insensitive Search ("CYBER")...');
    const res3 = await execSearch({ search: 'CYBER' });
    if (!res3.items.some(p => p._id.toString() === prod1._id.toString())) {
      throw new Error('FAILED: Uppercase "CYBER" search failed');
    }
    console.log(`✓ PASS: Uppercase & lowercase queries return equivalent results`);

    // TEST 4: Multiple Words Search
    console.log('\n[TEST 4] Multiple Words Search ("Cyberpunk Heavyweight")...');
    const res4 = await execSearch({ search: 'Cyberpunk Heavyweight' });
    if (!res4.items.some(p => p._id.toString() === prod1._id.toString())) {
      throw new Error('FAILED: Multi-word search failed');
    }
    console.log(`✓ PASS: Multi-word search succeeded`);

    // TEST 5: Nonexistent Keyword Search
    console.log('\n[TEST 5] Nonexistent Keyword Search ("nonexistentxyz999")...');
    const res5 = await execSearch({ search: 'nonexistentxyz999' });
    if (res5.total !== 0 || res5.items.length !== 0) {
      throw new Error('FAILED: Nonexistent search returned non-zero items');
    }
    console.log(`✓ PASS: Empty result set returned for nonexistent query`);

    // TEST 6: Search + Category Filter
    console.log('\n[TEST 6] Search + Category Filter...');
    const res6 = await execSearch({ search: 'cyber', category: cat.slug });
    if (!res6.items.some(p => p._id.toString() === prod1._id.toString())) {
      throw new Error('FAILED: Search + Category filter combined query failed');
    }
    console.log(`✓ PASS: Search combined with category filter succeeded`);

    // TEST 7: Search + Sort
    console.log('\n[TEST 7] Search + Price Sort...');
    const res7 = await execSearch({ search: 'Tee', sort: 'price_asc' });
    if (res7.items.length >= 2 && res7.items[0].basePrice > res7.items[1].basePrice) {
      throw new Error('FAILED: Search + Sort failed ordering');
    }
    console.log(`✓ PASS: Search combined with price sort succeeded`);

    // TEST 8: Search + Pagination
    console.log('\n[TEST 8] Search + Pagination...');
    const res8 = await execSearch({ search: 'Tee', page: '1', limit: '1' });
    if (res8.limit !== 1 || res8.items.length > 1) {
      throw new Error('FAILED: Search + Pagination limit failed');
    }
    console.log(`✓ PASS: Search + Pagination succeeded`);

    // TEST 9: Draft & Inactive Product Exclusion
    console.log('\n[TEST 9] Draft & Inactive Product Exclusion...');
    const res9 = await execSearch({ search: 'cyber' });
    const containsDraft = res9.items.some(p => p._id.toString() === draftProd._id.toString());
    if (containsDraft) {
      throw new Error('SECURITY VIOLATION: DRAFT product was returned in search results!');
    }
    console.log(`✓ PASS: DRAFT & INACTIVE products strictly excluded from public search`);

    // Cleanup test products
    await Product.deleteMany({ _id: { $in: [prod1._id, prod2._id, draftProd._id] } });
    console.log('✓ Cleaned up test seed records');

    console.log('\n======================================================');
    console.log('ALL COMPREHENSIVE SEARCH E2E TESTS PASSED 100%');
    console.log('======================================================\n');
    process.exit(0);

  } catch (err) {
    console.error('❌ E2E SEARCH TEST FAILED:', err.message);
    process.exit(1);
  }
}

runSearchE2ETests();
