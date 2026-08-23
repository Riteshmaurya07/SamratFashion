const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function seedData() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/samrat_fashion";
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for mock data seeding...");

  const db = mongoose.connection.db;

  // 1. Seed Categories
  const categories = [
    {
      name: "Oversized Tees",
      slug: "oversized",
      description: "Heavyweight, relaxed-fit street tees with drop shoulders.",
      image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=800&auto=format&fit=crop",
      displayOrder: 1,
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: "Graphic Tees",
      slug: "graphic",
      description: "High-density screen prints and cyber aesthetic graphics.",
      image: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop",
      displayOrder: 2,
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: "Anime & Cyberpunk",
      slug: "anime",
      description: "Futuristic typography and manga art inspired streetwear.",
      image: "https://images.unsplash.com/photo-1613376023733-0a73315d9b06?q=80&w=800&auto=format&fit=crop",
      displayOrder: 3,
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: "Minimal Essentials",
      slug: "minimal",
      description: "Clean, unbranded boxy tees with premium 240 GSM cotton.",
      image: "https://images.unsplash.com/photo-1581655353564-df123a1eb820?q=80&w=800&auto=format&fit=crop",
      displayOrder: 4,
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  for (const cat of categories) {
    await db.collection("categories").updateOne(
      { slug: cat.slug },
      { $set: cat },
      { upsert: true }
    );
  }
  console.log("Categories seeded cleanly.");

  const createdCategories = await db.collection("categories").find({}).toArray();
  const catMap = {};
  createdCategories.forEach((c) => {
    catMap[c.slug] = c._id;
  });

  // 2. Seed Themes
  const themes = [
    {
      name: "Cyberpunk Drop 2026",
      slug: "cyberpunk-drop-2026",
      description: "Neon aesthetics and futuristic streetwear prints.",
      heroImage: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=1200&auto=format&fit=crop",
      thumbnail: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=400&auto=format&fit=crop",
      displayOrder: 1,
      isFeatured: true,
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: "Tokyo Underground",
      slug: "tokyo-underground",
      description: "Minimalist Japanese typography and raw street vibes.",
      heroImage: "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?q=80&w=1200&auto=format&fit=crop",
      thumbnail: "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?q=80&w=400&auto=format&fit=crop",
      displayOrder: 2,
      isFeatured: true,
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  for (const theme of themes) {
    await db.collection("themes").updateOne(
      { slug: theme.slug },
      { $set: theme },
      { upsert: true }
    );
  }
  console.log("Themes seeded cleanly.");

  const createdThemes = await db.collection("themes").find({}).toArray();
  const themeIds = createdThemes.map((t) => t._id);

  // Helper for T-Shirt Size Guide
  const defaultSizeGuide = [
    { size: "S", chest: 42, length: 28, shoulder: 20 },
    { size: "M", chest: 44, length: 29, shoulder: 21 },
    { size: "L", chest: 46, length: 30, shoulder: 22 },
    { size: "XL", chest: 48, length: 31, shoulder: 23 },
  ];

  // Helper for T-Shirt Variants
  const createVariants = (skuPrefix, baseStock = 25) => [
    {
      _id: new mongoose.Types.ObjectId(),
      size: "S",
      color: "Jet Black",
      hexCode: "#0f172a",
      sku: `${skuPrefix}-BLK-S`,
      stock: baseStock,
      reorderThreshold: 5,
      warehouseLocation: "Aisle A-12",
      additionalPrice: 0,
      images: [],
      isAvailable: true,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      size: "M",
      color: "Jet Black",
      hexCode: "#0f172a",
      sku: `${skuPrefix}-BLK-M`,
      stock: baseStock + 10,
      reorderThreshold: 5,
      warehouseLocation: "Aisle A-12",
      additionalPrice: 0,
      images: [],
      isAvailable: true,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      size: "L",
      color: "Jet Black",
      hexCode: "#0f172a",
      sku: `${skuPrefix}-BLK-L`,
      stock: baseStock + 15,
      reorderThreshold: 5,
      warehouseLocation: "Aisle A-12",
      additionalPrice: 0,
      images: [],
      isAvailable: true,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      size: "XL",
      color: "Jet Black",
      hexCode: "#0f172a",
      sku: `${skuPrefix}-BLK-XL`,
      stock: 8,
      reorderThreshold: 5,
      warehouseLocation: "Aisle A-12",
      additionalPrice: 100,
      images: [],
      isAvailable: true,
    },
  ];

  // 3. Seed Products
  const products = [
    {
      name: "Cyber Neon Heavyweight Oversized Tee",
      slug: "cyber-neon-heavyweight-oversized-tee",
      description:
        "Engineered with 240 GSM combed cotton for a thick, structured drape. Features high-density neon puff print on back and subtle embroidery on chest.",
      images: [
        "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=800&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop",
      ],
      categoryId: catMap["oversized"],
      themeIds: themeIds,
      basePrice: 1299,
      mrp: 1999,
      discount: 35,
      variants: createVariants("CYBER-NEON", 30),
      tags: ["oversized", "heavyweight", "streetwear", "neon"],
      status: "ACTIVE",
      isFeatured: true,
      isNewArrival: true,
      isBestSeller: true,
      averageRating: 4.8,
      reviewCount: 42,
      offers: [
        { type: "DISCOUNT", description: "Get FLAT 10% OFF on First Order (Code: FIRST10)" },
      ],
      fabric: "100% Combed Heavyweight Cotton",
      gsm: 240,
      fit: "OVERSIZED",
      gender: "UNISEX",
      careInstructions: [
        "Machine wash cold inside out",
        "Do not iron directly on print",
        "Tumble dry low",
      ],
      printTypes: ["DTG", "EMBROIDERY"],
      sizeGuideTable: defaultSizeGuide,
      seo: {
        title: "Cyber Neon Heavyweight Oversized Tee | SamratFashion",
        description: "Buy 240 GSM Cyber Neon Oversized Streetwear T-Shirt in India.",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: "Tokyo Mecha Graphic Street Tee",
      slug: "tokyo-mecha-graphic-street-tee",
      description:
        "Inspired by vintage Japanese mecha anime typography. Soft-washed 220 GSM cotton with breathable screen print.",
      images: [
        "https://images.unsplash.com/photo-1613376023733-0a73315d9b06?q=80&w=800&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=800&auto=format&fit=crop",
      ],
      categoryId: catMap["anime"],
      themeIds: [themeIds[1]],
      basePrice: 1199,
      mrp: 1799,
      discount: 33,
      variants: createVariants("TOKYO-MECHA", 20),
      tags: ["anime", "tokyo", "graphic", "streetwear"],
      status: "ACTIVE",
      isFeatured: true,
      isNewArrival: true,
      isBestSeller: false,
      averageRating: 4.6,
      reviewCount: 19,
      offers: [
        { type: "DISCOUNT", description: "Buy Any 2 Tees Get ₹200 OFF" },
      ],
      fabric: "100% Super Combed Cotton",
      gsm: 220,
      fit: "RELAXED",
      gender: "UNISEX",
      careInstructions: ["Machine wash cold", "Dry in shade"],
      printTypes: ["SCREEN_PRINT"],
      sizeGuideTable: defaultSizeGuide,
      seo: {
        title: "Tokyo Mecha Anime Graphic T-Shirt",
        description: "Tokyo streetwear mecha graphic tee.",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: "Minimalist Off-White Boxy Tee",
      slug: "minimalist-off-white-boxy-tee",
      description:
        "Pure, unbranded aesthetic. 260 GSM organic french terry jersey with a broad ribbed collar and clean boxy drop.",
      images: [
        "https://images.unsplash.com/photo-1581655353564-df123a1eb820?q=80&w=800&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=800&auto=format&fit=crop",
      ],
      categoryId: catMap["minimal"],
      themeIds: [],
      basePrice: 1499,
      mrp: 2199,
      discount: 31,
      variants: createVariants("MIN-OFFWHT", 40),
      tags: ["minimal", "boxy", "terry", "essential"],
      status: "ACTIVE",
      isFeatured: true,
      isNewArrival: false,
      isBestSeller: true,
      averageRating: 4.9,
      reviewCount: 88,
      offers: [],
      fabric: "100% Organic French Terry Cotton",
      gsm: 260,
      fit: "BOXER",
      gender: "UNISEX",
      careInstructions: ["Machine wash warm", "Line dry in shade"],
      printTypes: [],
      sizeGuideTable: defaultSizeGuide,
      seo: {
        title: "Minimalist Off-White French Terry Boxy Tee",
        description: "260 GSM Unbranded Heavyweight Boxy Fit Tee.",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: "Samrat Signature Vintage Black Tee",
      slug: "samrat-signature-vintage-black-tee",
      description:
        "Acid-washed vintage black finish with hand-distressed collar accents and subtle tonal branding.",
      images: [
        "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?q=80&w=800&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop",
      ],
      categoryId: catMap["graphic"],
      themeIds: themeIds,
      basePrice: 1399,
      mrp: 1999,
      discount: 30,
      variants: createVariants("SAMRAT-VNTG", 15),
      tags: ["vintage", "acidwash", "signature"],
      status: "ACTIVE",
      isFeatured: true,
      isNewArrival: false,
      isBestSeller: true,
      averageRating: 4.7,
      reviewCount: 56,
      offers: [],
      fabric: "100% Acid Washed Cotton",
      gsm: 240,
      fit: "OVERSIZED",
      gender: "UNISEX",
      careInstructions: ["Wash separately inside out"],
      printTypes: ["PU_PRINT"],
      sizeGuideTable: defaultSizeGuide,
      seo: {
        title: "Samrat Signature Vintage Acid Wash T-Shirt",
        description: "Vintage acid wash heavyweight oversized street tee.",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  for (const prod of products) {
    await db.collection("products").updateOne(
      { slug: prod.slug },
      { $set: prod },
      { upsert: true }
    );
  }
  console.log("Mock T-Shirt products seeded cleanly!");

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB.");
}

seedData().catch((err) => {
  console.error("Error seeding mock data:", err);
  process.exit(1);
});
