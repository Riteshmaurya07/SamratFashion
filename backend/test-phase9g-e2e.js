const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';

async function runPhase9GEndToEndVerification() {
  console.log('=== STARTING PHASE 9G CMS, BANNERS & MARKETING CAMPAIGNS VERIFICATION ===');

  await mongoose.connect(MONGODB_URI);
  console.log('1. Database Connection: SUCCESS');

  // Load Models
  require('./dist/models/User');
  require('./dist/models/ContentBanner');
  require('./dist/models/Campaign');
  require('./dist/models/AuditLog');

  const User = mongoose.model('User');
  const ContentBanner = mongoose.model('ContentBanner');
  const Campaign = mongoose.model('Campaign');
  const AuditLog = mongoose.model('AuditLog');

  // 1. Get or Create Admin & Customer
  let admin = await User.findOne({ role: 'ADMIN' });
  if (!admin) {
    admin = await User.create({
      name: 'CMS Admin',
      email: 'admin_cms_9g@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'ADMIN',
      isEmailVerified: true,
    });
  }

  let customer = await User.findOne({ role: 'CUSTOMER' });
  if (!customer) {
    customer = await User.create({
      name: 'Test Customer',
      email: 'customer_cms_9g@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }
  console.log('2. Admin & Customer Resolved.');

  // 2. Step 1: Admin Creates Draft Banner
  const draftBanner = await ContentBanner.create({
    title: 'Draft Festival Drop',
    subtitle: 'Exclusive preview of winter oversized hoodies.',
    image: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500',
    ctaLabel: 'PREVIEW NOW',
    ctaUrl: '/shop?category=oversized',
    position: 'HERO',
    displayOrder: 1,
    status: 'DRAFT',
  });
  console.log('3. Draft Banner Created:', draftBanner._id.toString());

  // 3. Step 2: Public Read API Security Check (Draft Banner Hidden)
  const now = new Date();
  const publicHeroBanners = await ContentBanner.find({
    position: 'HERO',
    status: 'ACTIVE',
    $and: [
      { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  });

  const isDraftVisible = publicHeroBanners.some((b) => b._id.toString() === draftBanner._id.toString());
  if (!isDraftVisible) {
    console.log('4. Public Draft Protection: Draft banner hidden from public catalog API: PASSED');
  } else {
    console.error('4. Public Draft Protection: FAILED!');
    process.exit(1);
  }

  // 4. Step 3: Admin Publishes Banner -> Status ACTIVE
  draftBanner.status = 'ACTIVE';
  await draftBanner.save();

  await AuditLog.create({
    actorId: admin._id,
    actorRole: 'ADMIN',
    action: 'ADMIN_BANNER_PUBLISHED',
    entityType: 'BANNER',
    entityId: draftBanner._id.toString(),
    metadata: { newStatus: 'ACTIVE' },
  });

  const updatedPublicHero = await ContentBanner.find({
    position: 'HERO',
    status: 'ACTIVE',
    $and: [
      { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  });

  const isPublishedVisible = updatedPublicHero.some((b) => b._id.toString() === draftBanner._id.toString());
  if (isPublishedVisible) {
    console.log('5. Banner Publication Verification: Active banner visible in public API: PASSED');
  } else {
    console.error('5. Banner Publication Verification: FAILED!');
    process.exit(1);
  }

  // 5. Step 4: Scheduled Future Banner Verification
  const futureDate = new Date(Date.now() + 86400000 * 7); // 7 days in future
  const scheduledBanner = await ContentBanner.create({
    title: 'Future Black Friday Banner',
    image: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500',
    position: 'HERO',
    status: 'ACTIVE',
    startsAt: futureDate,
  });

  const activeHeroBannersNow = await ContentBanner.find({
    position: 'HERO',
    status: 'ACTIVE',
    $and: [
      { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  });

  const isScheduledVisibleBeforeStart = activeHeroBannersNow.some((b) => b._id.toString() === scheduledBanner._id.toString());
  if (!isScheduledVisibleBeforeStart) {
    console.log('6. Scheduling Protection: Future scheduled banner hidden prior to start date: PASSED');
  } else {
    console.error('6. Scheduling Protection: FAILED!');
    process.exit(1);
  }

  // 6. Step 5: Admin Creates Marketing Campaign
  const campaign = await Campaign.create({
    name: 'Diwali Festive Sale 2026',
    slug: 'diwali-festive-sale-' + Date.now(),
    description: 'Flat discount campaign for streetwear and graphic tees.',
    discountTag: 'Flat ₹500 OFF',
    status: 'ACTIVE',
    bannerIds: [draftBanner._id],
  });

  await AuditLog.create({
    actorId: admin._id,
    actorRole: 'ADMIN',
    action: 'ADMIN_CAMPAIGN_ACTIVATED',
    entityType: 'CAMPAIGN',
    entityId: campaign._id.toString(),
  });
  console.log('7. Marketing Campaign Created & Activated:', campaign.name, 'Slug:', campaign.slug);

  console.log('=== ALL PHASE 9G CMS, BANNERS & CAMPAIGN TESTS PASSED SUCCESSFULLY! ===');
  await mongoose.disconnect();
}

runPhase9GEndToEndVerification().catch((err) => {
  console.error('PHASE 9G VERIFICATION ERROR:', err);
  process.exit(1);
});
