import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { Product } from "../models/Product";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

async function fixCustomPrintCatalogPrices() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGODB_URI is not defined in environment");

    console.log("[PRICE FIX MIGRATION] Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("[PRICE FIX MIGRATION] Connected.");

    // 1. Fix Product basePrice and mrp
    const productsToFix = await Product.find({
      $or: [{ basePrice: { $gt: 10000 } }, { mrp: { $gt: 10000 } }],
    });

    console.log(`[PRICE FIX MIGRATION] Found ${productsToFix.length} products with prices > 10000 paise.`);

    let fixedProductsCount = 0;
    for (const product of productsToFix) {
      if (product.basePrice > 10000) {
        product.basePrice = Math.round(product.basePrice / 100);
      }
      if (product.mrp && product.mrp > 10000) {
        product.mrp = Math.round(product.mrp / 100);
      }
      if (product.variants && product.variants.length > 0) {
        for (const variant of product.variants) {
          if (variant.additionalPrice && variant.additionalPrice > 10000) {
            variant.additionalPrice = Math.round(variant.additionalPrice / 100);
          }
        }
      }
      await product.save();
      fixedProductsCount++;
      console.log(`[PRICE FIX MIGRATION] Fixed Product: ${product.name} (${product._id}) -> basePrice: ₹${product.basePrice}`);
    }

    // 2. Fix CustomPrintCatalogItem displayPrice
    const catalogItemsToFix = await CustomPrintCatalogItem.find({ displayPrice: { $gt: 10000 } });
    console.log(`[PRICE FIX MIGRATION] Found ${catalogItemsToFix.length} catalog items with displayPrice > 10000 paise.`);

    let fixedCatalogCount = 0;
    for (const item of catalogItemsToFix) {
      if (item.displayPrice && item.displayPrice > 10000) {
        item.displayPrice = Math.round(item.displayPrice / 100);
        await item.save();
        fixedCatalogCount++;
        console.log(`[PRICE FIX MIGRATION] Fixed CustomPrintCatalogItem: ${item.name} (${item._id}) -> displayPrice: ₹${item.displayPrice}`);
      }
    }

    console.log(`[PRICE FIX MIGRATION] Migration complete! Fixed ${fixedProductsCount} products and ${fixedCatalogCount} catalog items.`);
    process.exit(0);
  } catch (err) {
    console.error("[PRICE FIX MIGRATION ERROR]", err);
    process.exit(1);
  }
}

fixCustomPrintCatalogPrices();
