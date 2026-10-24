import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { Category, CategoryStatus } from "../models/Category";
import { Product, ProductStatus, ProductFit, ProductGender } from "../models/Product";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function seedTshirtProducts() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("Connected to MongoDB successfully.\n");

  try {
    // 1. Ensure T-Shirts parent category exists
    let tshirtCategory = await Category.findOne({ slug: "t-shirts" });
    if (!tshirtCategory) {
      tshirtCategory = await Category.create({
        name: "T-Shirts",
        slug: "t-shirts",
        description: "Premium architectural streetwear tees and dropped-shoulder blanks.",
        displayOrder: 1,
        status: CategoryStatus.ACTIVE,
      });
      console.log(`Created T-Shirts parent category: ${tshirtCategory._id}`);
    } else {
      tshirtCategory.status = CategoryStatus.ACTIVE;
      await tshirtCategory.save();
      console.log(`Found T-Shirts parent category: ${tshirtCategory._id}`);
    }

    // 2. Ensure child subcategories exist and are linked to T-Shirts
    const subcategoryConfigs = [
      {
        slug: "oversized",
        name: "Oversized Tees",
        description: "Heavyweight drop-shoulder relaxed streetwear tees.",
        displayOrder: 1,
      },
      {
        slug: "graphic",
        name: "Graphic Tees",
        description: "Cyber aesthetic, mecha, and high-density screen printed tees.",
        displayOrder: 2,
      },
      {
        slug: "minimal",
        name: "Minimal Essentials",
        description: "Clean, unbranded boxy cut essentials in 240+ GSM combed cotton.",
        displayOrder: 3,
      },
      {
        slug: "anime",
        name: "Anime & Cyberpunk",
        description: "Futuristic manga typography and Tokyo underground streetwear.",
        displayOrder: 4,
      },
    ];

    const subcategoryMap: Record<string, mongoose.Types.ObjectId> = {};
    for (const sub of subcategoryConfigs) {
      let cat = await Category.findOne({ slug: sub.slug });
      if (!cat) {
        cat = await Category.create({
          name: sub.name,
          slug: sub.slug,
          description: sub.description,
          displayOrder: sub.displayOrder,
          status: CategoryStatus.ACTIVE,
          parentCategory: tshirtCategory._id,
        });
      } else {
        cat.parentCategory = tshirtCategory._id as mongoose.Types.ObjectId;
        cat.status = CategoryStatus.ACTIVE;
        await cat.save();
      }
      subcategoryMap[sub.slug] = cat._id as mongoose.Types.ObjectId;
      console.log(`Linked subcategory: ${cat.name} (${cat.slug}) -> Parent T-Shirts`);
    }

    // 3. Products Data (Price <= 5 Rupees for real payment testing)
    const tshirts = [
      {
        name: "Heavyweight Oversized Streetwear T-Shirt",
        slug: "heavyweight-oversized-streetwear-tshirt",
        description: "240 GSM heavy combed cotton drop-shoulder streetwear tee with pre-shrunk, bio-washed fabric. Relaxed silhouette engineered for architectural boxy drape.",
        basePrice: 2, // ₹2
        mrp: 1499,
        discount: 99,
        categoryId: subcategoryMap["oversized"] || tshirtCategory._id,
        fit: ProductFit.OVERSIZED,
        gender: ProductGender.UNISEX,
        isFeatured: true,
        isNewArrival: true,
        images: [
          "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=800&auto=format&fit=crop",
          "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop",
        ],
        tags: ["t-shirt", "oversized", "streetwear", "heavyweight", "test-payment"],
        colors: [
          { name: "Pitch Black", hex: "#18181B", img: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=800&auto=format&fit=crop" },
          { name: "Off-White", hex: "#F4F4F5", img: "https://images.unsplash.com/photo-1581655353564-df123a1eb820?q=80&w=800&auto=format&fit=crop" },
          { name: "Sage Olive", hex: "#4D5D53", img: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop" },
          { name: "Washed Charcoal", hex: "#3F3F46", img: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?q=80&w=800&auto=format&fit=crop" },
        ],
        sizes: ["S", "M", "L", "XL"],
        stockPerVariant: 50,
      },
      {
        name: "Cyberpunk Mecha Graphic T-Shirt",
        slug: "cyberpunk-mecha-graphic-tshirt",
        description: "High-density Japanese mecha artwork and cyber aesthetic graphic print on 220 GSM breathable combed cotton.",
        basePrice: 3, // ₹3
        mrp: 1699,
        discount: 99,
        categoryId: subcategoryMap["graphic"] || tshirtCategory._id,
        fit: ProductFit.REGULAR,
        gender: ProductGender.UNISEX,
        isFeatured: true,
        isNewArrival: true,
        images: [
          "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop",
          "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?q=80&w=800&auto=format&fit=crop",
        ],
        tags: ["t-shirt", "graphic", "cyberpunk", "mecha", "test-payment"],
        colors: [
          { name: "Midnight Black", hex: "#09090B", img: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop" },
          { name: "Neon Purple", hex: "#7C3AED", img: "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?q=80&w=800&auto=format&fit=crop" },
          { name: "Cyber Blue", hex: "#2563EB", img: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=800&auto=format&fit=crop" },
        ],
        sizes: ["M", "L", "XL"],
        stockPerVariant: 40,
      },
      {
        name: "Minimalist Boxy Essential T-Shirt",
        slug: "minimalist-boxy-essential-tshirt",
        description: "Clean, unbranded minimalist boxy cut tee with double-needle ribbed collar, reinforced shoulder taping, and ultra-soft 240 GSM combed cotton.",
        basePrice: 1, // ₹1
        mrp: 999,
        discount: 99,
        categoryId: subcategoryMap["minimal"] || tshirtCategory._id,
        fit: ProductFit.BOXER,
        gender: ProductGender.UNISEX,
        isFeatured: true,
        isNewArrival: false,
        images: [
          "https://images.unsplash.com/photo-1581655353564-df123a1eb820?q=80&w=800&auto=format&fit=crop",
          "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=800&auto=format&fit=crop",
        ],
        tags: ["t-shirt", "minimal", "essential", "boxy", "test-payment"],
        colors: [
          { name: "Pure White", hex: "#FFFFFF", img: "https://images.unsplash.com/photo-1581655353564-df123a1eb820?q=80&w=800&auto=format&fit=crop" },
          { name: "Heather Grey", hex: "#9CA3AF", img: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?q=80&w=800&auto=format&fit=crop" },
          { name: "Navy Blue", hex: "#1E3A8A", img: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=800&auto=format&fit=crop" },
          { name: "Pitch Black", hex: "#18181B", img: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop" },
        ],
        sizes: ["S", "M", "L", "XL"],
        stockPerVariant: 60,
      },
      {
        name: "Tokyo Underground Anime T-Shirt",
        slug: "tokyo-underground-anime-tshirt",
        description: "Vintage mineral wash streetwear tee featuring Tokyo underground typography and manga line art.",
        basePrice: 4, // ₹4
        mrp: 1899,
        discount: 99,
        categoryId: subcategoryMap["anime"] || tshirtCategory._id,
        fit: ProductFit.OVERSIZED,
        gender: ProductGender.UNISEX,
        isFeatured: true,
        isNewArrival: true,
        images: [
          "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?q=80&w=800&auto=format&fit=crop",
          "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop",
        ],
        tags: ["t-shirt", "anime", "tokyo", "acid-wash", "test-payment"],
        colors: [
          { name: "Mineral Black", hex: "#27272A", img: "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?q=80&w=800&auto=format&fit=crop" },
          { name: "Crimson Red", hex: "#DC2626", img: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop" },
          { name: "Military Olive", hex: "#3F6212", img: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?q=80&w=800&auto=format&fit=crop" },
        ],
        sizes: ["M", "L", "XL", "2XL"],
        stockPerVariant: 45,
      },
    ];

    for (const t of tshirts) {
      // Build variants with unique SKUs and colors
      const variants = [];
      let totalStock = 0;

      for (const color of t.colors) {
        for (const size of t.sizes) {
          const colorCode = color.name.replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase();
          const sku = `${t.slug.substring(0, 8).toUpperCase()}-${colorCode}-${size}`;
          variants.push({
            sku,
            size,
            color: color.name,
            hexCode: color.hex,
            stock: t.stockPerVariant,
            isAvailable: true,
            additionalPrice: 0,
            images: [color.img],
          });
          totalStock += t.stockPerVariant;
        }
      }

      const prod = await Product.findOneAndUpdate(
        { slug: t.slug },
        {
          $set: {
            categoryId: t.categoryId,
            variants,
            images: t.images,
            fit: t.fit,
            gender: t.gender,
            tags: t.tags,
          },
          $setOnInsert: {
            name: t.name,
            slug: t.slug,
            description: t.description,
            basePrice: t.basePrice,
            mrp: t.mrp,
            discount: t.discount,
            status: ProductStatus.ACTIVE,
            isCustomizable: false,
            isFeatured: t.isFeatured,
            isNewArrival: t.isNewArrival,
            careInstructions: [
              "Machine wash cold inside out with like colors",
              "Do not bleach or dry clean",
              "Tumble dry low or line dry in shade",
              "Iron inside out on low heat",
            ],
          },
        },
        { upsert: true, returnDocument: "after" }
      );

      console.log(`\nCreated/Updated Product: "${prod.name}"`);
      console.log(`- Slug: ${prod.slug}`);
      console.log(`- Price: ₹${prod.basePrice}`);
      console.log(`- Category: ${prod.categoryId}`);
      console.log(`- Colors: ${t.colors.map(c => c.name).join(", ")}`);
      console.log(`- Total Variants: ${variants.length} (${totalStock} units total stock)`);
    }

    console.log("\n========================================================");
    console.log("Successfully seeded T-Shirt products priced ₹1 to ₹4!");
    console.log("All products belong to T-Shirts category & subcategories.");
    console.log("Direct links:");
    console.log("1. /shop/heavyweight-oversized-streetwear-tshirt (₹2, 4 Colors)");
    console.log("2. /shop/cyberpunk-mecha-graphic-tshirt (₹3, 3 Colors)");
    console.log("3. /shop/minimalist-boxy-essential-tshirt (₹1, 4 Colors)");
    console.log("4. /shop/tokyo-underground-anime-tshirt (₹4, 3 Colors)");
    console.log("Section URL: /shop?category=t-shirts");
    console.log("========================================================\n");
  } catch (error) {
    console.error("Error seeding T-shirt products:", error);
  } finally {
    await mongoose.disconnect();
    console.log("MongoDB disconnected.");
  }
}

seedTshirtProducts();
