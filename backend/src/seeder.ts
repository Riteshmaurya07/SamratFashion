import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { Product, ProductStatus } from "./models/Product";
import { Category, CategoryStatus } from "./models/Category";

async function seed() {
  console.log("🌱 Running SamratFashion Database Seeder...");

  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion";
  await mongoose.connect(mongoUri);
  console.log("✅ Connected to MongoDB at", mongoUri);

  // 1. Ensure Category exists
  let category = await Category.findOne({ slug: "t-shirts" });
  if (!category) {
    category = await Category.create({
      name: "T-Shirts",
      slug: "t-shirts",
      description: "Premium cotton blank t-shirts and apparel",
      status: CategoryStatus.ACTIVE,
      displayOrder: 1,
    });
    console.log("✅ Created Category: T-Shirts");
  }

  // 2. Mark existing products as customizable
  const updateRes = await Product.updateMany(
    { status: ProductStatus.ACTIVE },
    { $set: { isCustomizable: true } }
  );
  console.log(`✅ Updated ${updateRes.modifiedCount} existing products with isCustomizable = true`);

  // 3. Create default customizable blank products if none exist
  const customizableCount = await Product.countDocuments({ status: ProductStatus.ACTIVE, isCustomizable: true });
  if (customizableCount === 0) {
    const productsToCreate = [
      {
        name: "ThreadVibe Heavyweight Oversized Tee",
        slug: "threadvibe-heavyweight-oversized-tee",
        description: "240 GSM 100% Super Combed Heavyweight Cotton Tee. Pre-shrunk, bio-washed, oversized boxy fit.",
        categoryId: category._id,
        basePrice: 799,
        mrp: 1299,
        discount: 38,
        status: ProductStatus.ACTIVE,
        isCustomizable: true,
        isFeatured: true,
        isNewArrival: true,
        isBestSeller: true,
        images: [
          "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=80",
          "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800&auto=format&fit=crop&q=80"
        ],
        variants: [
          { size: "S", color: "BLACK", hexCode: "#000000", sku: "TV-OVR-BLK-S", stock: 100, additionalPrice: 0, isAvailable: true, images: [] },
          { size: "M", color: "BLACK", hexCode: "#000000", sku: "TV-OVR-BLK-M", stock: 100, additionalPrice: 0, isAvailable: true, images: [] },
          { size: "L", color: "BLACK", hexCode: "#000000", sku: "TV-OVR-BLK-L", stock: 100, additionalPrice: 0, isAvailable: true, images: [] },
          { size: "XL", color: "BLACK", hexCode: "#000000", sku: "TV-OVR-BLK-XL", stock: 100, additionalPrice: 50, isAvailable: true, images: [] },
          { size: "M", color: "WHITE", hexCode: "#FFFFFF", sku: "TV-OVR-WHT-M", stock: 100, additionalPrice: 0, isAvailable: true, images: [] },
          { size: "L", color: "WHITE", hexCode: "#FFFFFF", sku: "TV-OVR-WHT-L", stock: 100, additionalPrice: 0, isAvailable: true, images: [] },
          { size: "M", color: "NAVY", hexCode: "#000080", sku: "TV-OVR-NVY-M", stock: 100, additionalPrice: 0, isAvailable: true, images: [] }
        ],
        printableZones: {
          front: [{ id: "front-zone-1", x: 50, y: 80, width: 300, height: 400 }],
          back: [{ id: "back-zone-1", x: 50, y: 80, width: 300, height: 400 }],
          leftSleeve: [{ id: "ls-zone-1", x: 20, y: 20, width: 100, height: 100 }],
          rightSleeve: [{ id: "rs-zone-1", x: 20, y: 20, width: 100, height: 100 }]
        }
      },
      {
        name: "Classic Unisex Crewneck T-Shirt",
        slug: "classic-unisex-crewneck-tshirt",
        description: "180 GSM 100% Ring-Spun Combed Cotton. Premium regular fit custom graphic T-shirt base.",
        categoryId: category._id,
        basePrice: 499,
        mrp: 899,
        discount: 44,
        status: ProductStatus.ACTIVE,
        isCustomizable: true,
        isFeatured: true,
        isBestSeller: true,
        images: [
          "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800&auto=format&fit=crop&q=80"
        ],
        variants: [
          { size: "S", color: "BLACK", hexCode: "#000000", sku: "CLS-BLK-S", stock: 80, additionalPrice: 0, isAvailable: true, images: [] },
          { size: "M", color: "BLACK", hexCode: "#000000", sku: "CLS-BLK-M", stock: 80, additionalPrice: 0, isAvailable: true, images: [] },
          { size: "L", color: "BLACK", hexCode: "#000000", sku: "CLS-BLK-L", stock: 80, additionalPrice: 0, isAvailable: true, images: [] },
          { size: "M", color: "WHITE", hexCode: "#FFFFFF", sku: "CLS-WHT-M", stock: 80, additionalPrice: 0, isAvailable: true, images: [] }
        ],
        printableZones: {
          front: [{ id: "front-zone-1", x: 50, y: 80, width: 300, height: 400 }],
          back: [{ id: "back-zone-1", x: 50, y: 80, width: 300, height: 400 }],
          leftSleeve: [],
          rightSleeve: []
        }
      }
    ];

    for (const p of productsToCreate) {
      await Product.create(p);
      console.log(`✅ Seeded Product: ${p.name}`);
    }
  }

  console.log("✨ Seeding completed successfully!");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
