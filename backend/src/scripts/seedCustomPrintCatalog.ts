import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { Category, CategoryStatus } from "../models/Category";
import { Product, ProductStatus } from "../models/Product";
import { PrintPlacementTemplate } from "../models/PrintPlacementTemplate";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const itemsToSeed = [
  {
    name: "Customized Polo T-Shirt With Your Company Logo",
    slug: "customized-polo-tshirt-with-company-logo",
    description: "Executive 240 GSM combed cotton polo tee with crisp front chest & back logo print. Matty fabric collar, dual front & back view, size range S-4XL.",
    mockupImageUrl: "/images/custom_polo_blue_mockup.png",
    displayPrice: 144900,
    categoryName: "Polo T-Shirts",
    product: {
      name: "Customized Polo T-Shirt",
      basePrice: 144900,
      mrp: 199900,
      discount: 28,
      variants: [
        { size: "S", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-S", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "M", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "XL", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-XL", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "2XL", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-2XL", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "3XL", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-3XL", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "4XL", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-4XL", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Black", hexCode: "#18181b", sku: "POLO-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "POLO-NVY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Heather Grey", hexCode: "#9ca3af", sku: "POLO-GRY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Front Chest & Back Logo",
      code: "CHEST_BACK_LOGO",
      side: "FRONT",
      imageUrl: "/images/custom_polo_blue_mockup.png",
      previewConfig: { x: 35, y: 35, width: 30, height: 25 },
    },
  },
  {
    name: "100% Super Combed Cotton Custom Printed T-Shirt",
    slug: "customized-100-pure-cotton-tshirt",
    description: "Soft, breathable 220 GSM round-neck tee. High-definition DTG logo printing for daily casual wear, company swags, or team events.",
    mockupImageUrl: "/images/custom_polo_grey_mockup.png",
    displayPrice: 119900,
    categoryName: "100% Cotton",
    product: {
      name: "100% Cotton Custom Tee",
      basePrice: 119900,
      mrp: 169900,
      discount: 29,
      variants: [
        { size: "M", color: "Heather Grey", hexCode: "#9ca3af", sku: "COT-GRY-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Heather Grey", hexCode: "#9ca3af", sku: "COT-GRY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Black", hexCode: "#18181b", sku: "COT-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "White", hexCode: "#ffffff", sku: "COT-WHT-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Charcoal", hexCode: "#3f3f46", sku: "COT-CHR-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "COT-NVY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Front & Back Print",
      code: "FRONT_BACK_LOGO",
      side: "FRONT",
      imageUrl: "/images/custom_polo_grey_mockup.png",
      previewConfig: { x: 30, y: 32, width: 40, height: 35 },
    },
  },
  {
    name: "3-Fabric Combo Set (Matty, 100% Pure Cotton & Micro Poly)",
    slug: "oversized-heavyweight-custom-graphic-tee",
    description: "3 Different Style T-Shirts in Every Set! Matty Fabric, 100% Pure Cotton, and 100% Micro Polyester with front logo print. Available S-4XL.",
    mockupImageUrl: "/images/custom_polo_black_mockup.png",
    displayPrice: 169900,
    categoryName: "Polo T-Shirts",
    product: {
      name: "3-Fabric Custom Combo Polo Set",
      basePrice: 169900,
      mrp: 239900,
      discount: 29,
      variants: [
        { size: "M", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "XL", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-XL", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "2XL", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-2XL", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "3XL", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-3XL", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "4XL", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-4XL", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "3 Fabric Style Set",
      code: "COMBO_SET",
      side: "FRONT",
      imageUrl: "/images/custom_polo_black_mockup.png",
      previewConfig: { x: 25, y: 25, width: 50, height: 50 },
    },
  },
  {
    name: "Dry-Fit Performance Custom Sports & Event T-Shirt",
    slug: "dryfit-performance-custom-sports-tshirt",
    description: "Lightweight moisture-wicking polyester micro-mesh jersey. Ideal for marathons, sports tournaments, college fests, and outdoor activities.",
    mockupImageUrl: "https://images.unsplash.com/photo-1518611012118-696072aa579a?q=80&w=800&auto=format&fit=crop",
    displayPrice: 89900,
    categoryName: "100% Cotton",
    product: {
      name: "Dry-Fit Sports Tee",
      basePrice: 89900,
      mrp: 129900,
      discount: 30,
      variants: [
        { size: "M", color: "Royal Blue", hexCode: "#2563eb", sku: "DRY-ROY-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Royal Blue", hexCode: "#2563eb", sku: "DRY-ROY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Red", hexCode: "#dc2626", sku: "DRY-RED-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Neon Green", hexCode: "#65a30d", sku: "DRY-NEO-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Black", hexCode: "#18181b", sku: "DRY-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Chest & Sleeve Print",
      code: "SLEEVE_CHEST",
      side: "FRONT",
      imageUrl: "https://images.unsplash.com/photo-1518611012118-696072aa579a?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 35, y: 35, width: 30, height: 25 },
    },
  },
  {
    name: "Custom Embroidered Corporate Hoodie & Sweatshirt",
    slug: "custom-embroidered-corporate-hoodie",
    description: "Premium 320 GSM fleece hoodie with front kangaroo pocket and dual hood lining. High-density embroidered company logo.",
    mockupImageUrl: "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?q=80&w=800&auto=format&fit=crop",
    displayPrice: 229900,
    categoryName: "Hoodies & Outerwear",
    product: {
      name: "Corporate Hoodie",
      basePrice: 229900,
      mrp: 319900,
      discount: 28,
      variants: [
        { size: "M", color: "Black", hexCode: "#18181b", sku: "HD-BLK-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Black", hexCode: "#18181b", sku: "HD-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "HD-NVY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Heather Gray", hexCode: "#9ca3af", sku: "HD-GRY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Embroidered Chest Logo",
      code: "EMBROIDERED_CHEST",
      side: "FRONT",
      imageUrl: "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 35, y: 35, width: 28, height: 22 },
    },
  },
  {
    name: "Promotional Exhibition Full-Back Branding T-Shirt",
    slug: "promotional-exhibition-fullback-branding-tee",
    description: "High-visibility promotional tee with prominent back advertisement print and front crest logo for marketing campaigns and events.",
    mockupImageUrl: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?q=80&w=800&auto=format&fit=crop",
    displayPrice: 129900,
    categoryName: "100% Cotton",
    product: {
      name: "Promotional Branding Tee",
      basePrice: 129900,
      mrp: 179900,
      discount: 27,
      variants: [
        { size: "M", color: "White", hexCode: "#ffffff", sku: "PRM-WHT-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "White", hexCode: "#ffffff", sku: "PRM-WHT-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Black", hexCode: "#18181b", sku: "PRM-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Yellow", hexCode: "#eab308", sku: "PRM-YEL-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "PRM-NVY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Full Back & Front Crest",
      code: "FULL_BACK_CREST",
      side: "BACK",
      imageUrl: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 25, y: 25, width: 50, height: 50 },
    },
  },
  {
    name: "Executive Zipper-Collar Custom Polo T-Shirt",
    slug: "executive-zipper-collar-custom-polo",
    description: "Modern metallic zipper placket polo tee crafted from Mercerized 240 GSM cotton. Premium executive gifting for leadership teams.",
    mockupImageUrl: "/images/custom_print_hero.png",
    displayPrice: 159900,
    categoryName: "Polo T-Shirts",
    product: {
      name: "Executive Zip Polo",
      basePrice: 159900,
      mrp: 219900,
      discount: 27,
      variants: [
        { size: "M", color: "Navy", hexCode: "#1e3a8a", sku: "ZIP-NVY-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "ZIP-NVY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Charcoal", hexCode: "#3f3f46", sku: "ZIP-CHR-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Emerald", hexCode: "#047857", sku: "ZIP-EMR-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Maroon", hexCode: "#881337", sku: "ZIP-MRN-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Executive Chest Logo",
      code: "EXEC_CHEST",
      side: "FRONT",
      imageUrl: "/images/custom_print_hero.png",
      previewConfig: { x: 35, y: 35, width: 30, height: 25 },
    },
  },
  {
    name: "Minimalist Pocket Print Custom Logo T-Shirt",
    slug: "minimalist-pocket-print-custom-logo-tshirt",
    description: "Subtle, stylish chest pocket detailing with crisp brand logo print. Clean streetwear & modern casual office aesthetic.",
    mockupImageUrl: "https://images.unsplash.com/photo-1581655353564-df123a1eb820?q=80&w=800&auto=format&fit=crop",
    displayPrice: 134900,
    categoryName: "100% Cotton",
    product: {
      name: "Pocket Print Custom Tee",
      basePrice: 134900,
      mrp: 189900,
      discount: 28,
      variants: [
        { size: "M", color: "Sand", hexCode: "#d6c0b3", sku: "PCK-SND-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Sand", hexCode: "#d6c0b3", sku: "PCK-SND-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Black", hexCode: "#18181b", sku: "PCK-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Pure White", hexCode: "#ffffff", sku: "PCK-WHT-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Sage", hexCode: "#3f6212", sku: "PCK-SGE-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Chest Pocket Logo",
      code: "POCKET_LOGO",
      side: "FRONT",
      imageUrl: "https://images.unsplash.com/photo-1581655353564-df123a1eb820?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 35, y: 35, width: 25, height: 25 },
    },
  },
  {
    name: "Custom Corporate Gift Set (Tee + Pen + Flask + Cardholder)",
    slug: "custom-corporate-gift-box-set",
    description: "4-in-1 Premium Executive Gift Box including customized polo tee, stainless thermal flask, metal pen & leather cardholder.",
    mockupImageUrl: "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?q=80&w=800&auto=format&fit=crop",
    displayPrice: 299900,
    categoryName: "Corporate Gifts",
    product: {
      name: "Corporate Gift Box",
      basePrice: 299900,
      mrp: 449900,
      discount: 33,
      variants: [
        { size: "L", color: "Premium Black", hexCode: "#18181b", sku: "BOX-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Royal Navy", hexCode: "#1e3a8a", sku: "BOX-NVY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Complete Box Set",
      code: "BOX_SET",
      side: "FRONT",
      imageUrl: "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 30, y: 30, width: 40, height: 40 },
    },
  },
  {
    name: "Custom Round Neck Bio-Washed Cotton T-Shirt",
    slug: "custom-round-neck-biowashed-cotton-tshirt",
    description: "Ultra-smooth 180 GSM bio-washed cotton T-shirt designed for maximum print clarity. Perfect for giveaways and mass corporate events.",
    mockupImageUrl: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?q=80&w=800&auto=format&fit=crop",
    displayPrice: 99900,
    categoryName: "100% Cotton",
    product: {
      name: "Bio-Washed Cotton Tee",
      basePrice: 99900,
      mrp: 149900,
      discount: 33,
      variants: [
        { size: "S", color: "Black", hexCode: "#18181b", sku: "BIO-BLK-S", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "M", color: "Black", hexCode: "#18181b", sku: "BIO-BLK-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Black", hexCode: "#18181b", sku: "BIO-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "White", hexCode: "#ffffff", sku: "BIO-WHT-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "BIO-NVY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Front Chest Print",
      code: "FRONT_CHEST",
      side: "FRONT",
      imageUrl: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 35, y: 35, width: 30, height: 25 },
    },
  },
  {
    name: "Premium Customized V-Neck Logo Printed T-Shirt",
    slug: "premium-customized-vneck-logo-printed-tshirt",
    description: "Sleek 200 GSM V-neck tee with tailored fit. Excellent choice for hospitality staff, retail teams, and corporate uniforms.",
    mockupImageUrl: "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?q=80&w=800&auto=format&fit=crop",
    displayPrice: 124900,
    categoryName: "100% Cotton",
    product: {
      name: "Custom V-Neck Tee",
      basePrice: 124900,
      mrp: 179900,
      discount: 30,
      variants: [
        { size: "M", color: "Black", hexCode: "#18181b", sku: "VNK-BLK-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Black", hexCode: "#18181b", sku: "VNK-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Charcoal", hexCode: "#3f3f46", sku: "VNK-CHR-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "White", hexCode: "#ffffff", sku: "VNK-WHT-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "V-Neck Chest Print",
      code: "VNECK_CHEST",
      side: "FRONT",
      imageUrl: "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 35, y: 38, width: 30, height: 22 },
    },
  },
  {
    name: "Custom Sleeveless Gym & Athletic Tank Top",
    slug: "custom-sleeveless-gym-sports-training-jersey",
    description: "Breathable moisture-wicking dry-fit tank top for fitness clubs, sports teams, marathon runners, and outdoor events.",
    mockupImageUrl: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?q=80&w=800&auto=format&fit=crop",
    displayPrice: 79900,
    categoryName: "100% Cotton",
    product: {
      name: "Athletic Tank Top",
      basePrice: 79900,
      mrp: 119900,
      discount: 33,
      variants: [
        { size: "M", color: "Black", hexCode: "#18181b", sku: "TNK-BLK-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Black", hexCode: "#18181b", sku: "TNK-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Red", hexCode: "#dc2626", sku: "TNK-RED-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Royal Blue", hexCode: "#2563eb", sku: "TNK-ROY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Center Chest Print",
      code: "TANK_CHEST",
      side: "FRONT",
      imageUrl: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 32, y: 32, width: 36, height: 36 },
    },
  },
  {
    name: "Custom Varsity Bomber Jacket with Company Embroidery",
    slug: "custom-varsity-bomber-jacket-company-embroidery",
    description: "Heavyweight winter corporate jacket with ribbed collar, brass zipper, and high-density logo embroidery on front chest and back.",
    mockupImageUrl: "https://images.unsplash.com/photo-1548883354-7622d03aca27?q=80&w=800&auto=format&fit=crop",
    displayPrice: 349900,
    categoryName: "Hoodies & Outerwear",
    product: {
      name: "Varsity Bomber Jacket",
      basePrice: 349900,
      mrp: 499900,
      discount: 30,
      variants: [
        { size: "M", color: "Black", hexCode: "#18181b", sku: "JKT-BLK-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Black", hexCode: "#18181b", sku: "JKT-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "JKT-NVY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Embroidered Chest & Back",
      code: "JACKET_EMB",
      side: "FRONT",
      imageUrl: "https://images.unsplash.com/photo-1548883354-7622d03aca27?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 35, y: 35, width: 28, height: 25 },
    },
  },
  {
    name: "Custom Printed Full-Sleeve Unisex Cotton T-Shirt",
    slug: "custom-printed-full-sleeve-unisex-cotton-tshirt",
    description: "Comfortable 220 GSM full-sleeve crewneck tee with rib cuffs. Supports front logo print and dual sleeve branding.",
    mockupImageUrl: "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?q=80&w=800&auto=format&fit=crop",
    displayPrice: 149900,
    categoryName: "100% Cotton",
    product: {
      name: "Full-Sleeve Custom Tee",
      basePrice: 149900,
      mrp: 209900,
      discount: 28,
      variants: [
        { size: "M", color: "Black", hexCode: "#18181b", sku: "FSL-BLK-M", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Black", hexCode: "#18181b", sku: "FSL-BLK-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "White", hexCode: "#ffffff", sku: "FSL-WHT-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "FSL-NVY-L", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Chest & Sleeve Print",
      code: "FULL_SLEEVE_CHEST",
      side: "FRONT",
      imageUrl: "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 35, y: 35, width: 30, height: 25 },
    },
  },
  {
    name: "Customized Canvas Tote Bag for Event Branding",
    slug: "customized-canvas-tote-bag-event-branding",
    description: "Heavy-duty 300 GSM natural cotton canvas tote bag. Eco-friendly promotional item for corporate events, tradeshows, and fests.",
    mockupImageUrl: "https://images.unsplash.com/photo-1544816155-12df9643f363?q=80&w=800&auto=format&fit=crop",
    displayPrice: 59900,
    categoryName: "Accessories & Bags",
    product: {
      name: "Custom Canvas Tote Bag",
      basePrice: 59900,
      mrp: 89900,
      discount: 33,
      variants: [
        { size: "Standard", color: "Natural Beige", hexCode: "#d6c0b3", sku: "TOT-BEI-STD", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "Standard", color: "Jet Black", hexCode: "#18181b", sku: "TOT-BLK-STD", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Tote Bag Center Logo",
      code: "TOTE_CENTER",
      side: "FRONT",
      imageUrl: "https://images.unsplash.com/photo-1544816155-12df9643f363?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 30, y: 30, width: 40, height: 40 },
    },
  },
  {
    name: "Custom Logo Embroidered Baseball Cap & Trucker Hat",
    slug: "custom-logo-printed-baseball-cap-trucker-hat",
    description: "Premium 6-panel cotton twill cap with metal buckle closure. High-density embroidered logo on front panel.",
    mockupImageUrl: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?q=80&w=800&auto=format&fit=crop",
    displayPrice: 69900,
    categoryName: "Accessories & Bags",
    product: {
      name: "Custom Embroidered Cap",
      basePrice: 69900,
      mrp: 99900,
      discount: 30,
      variants: [
        { size: "Free Size", color: "Black", hexCode: "#18181b", sku: "CAP-BLK-FS", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "Free Size", color: "Navy", hexCode: "#1e3a8a", sku: "CAP-NVY-FS", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
        { size: "Free Size", color: "White", hexCode: "#ffffff", sku: "CAP-WHT-FS", isAvailable: true, stock: 100, additionalPrice: 0, images: [] },
      ],
    },
    template: {
      name: "Cap Front Panel Logo",
      code: "CAP_FRONT",
      side: "FRONT",
      imageUrl: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?q=80&w=800&auto=format&fit=crop",
      previewConfig: { x: 35, y: 35, width: 30, height: 20 },
    },
  },
];

async function seedCustomPrintCatalog() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGODB_URI is not defined");

    console.log("[SEED] Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("[SEED] MongoDB Connected.");

    // Ensure default Category
    let category = await Category.findOne({ slug: "custom-printing" });
    if (!category) {
      category = await Category.create({
        name: "Custom Printing",
        slug: "custom-printing",
        description: "Custom printed apparel and merchandise",
        displayOrder: 1,
        status: CategoryStatus.ACTIVE,
      });
      console.log("[SEED] Created Category: Custom Printing");
    }

    let sortIndex = 1;
    for (const itemData of itemsToSeed) {
      // 1. Upsert Placement Template
      const template = await PrintPlacementTemplate.findOneAndUpdate(
        { code: itemData.template.code },
        {
          $set: {
            name: itemData.template.name,
            side: itemData.template.side,
            imageUrl: itemData.template.imageUrl,
            previewConfig: itemData.template.previewConfig,
            isActive: true,
          },
        },
        { upsert: true, new: true }
      );

      // 2. Upsert Product
      const productSlug = itemData.slug + "-prod";
      const product = await Product.findOneAndUpdate(
        { slug: productSlug },
        {
          $set: {
            name: itemData.product.name,
            description: itemData.description,
            categoryId: category._id,
            basePrice: itemData.product.basePrice,
            mrp: itemData.product.mrp,
            discount: itemData.product.discount,
            variants: itemData.product.variants,
            images: [itemData.mockupImageUrl],
            isCustomizable: true,
            status: ProductStatus.ACTIVE,
          },
        },
        { upsert: true, new: true }
      );

      // 3. Upsert CustomPrintCatalogItem
      await CustomPrintCatalogItem.findOneAndUpdate(
        { slug: itemData.slug },
        {
          $set: {
            name: itemData.name,
            description: itemData.description,
            productId: product._id,
            placementTemplateId: template._id,
            mockupImageUrl: itemData.mockupImageUrl,
            displayPrice: itemData.displayPrice,
            isActive: true,
            sortOrder: sortIndex++,
          },
        },
        { upsert: true, new: true }
      );

      console.log(`[SEED] Upserted CustomPrintCatalogItem: ${itemData.slug}`);
    }

    console.log("[SEED] All 16 custom print catalog items successfully seeded into MongoDB!");
    process.exit(0);
  } catch (error) {
    console.error("[SEED ERROR]", error);
    process.exit(1);
  }
}

seedCustomPrintCatalog();
