export type CatalogItem = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  mockupImageUrl: string;
  displayPrice?: number;
  isActive?: boolean;
  category?: string;
  productId?: {
    _id: string;
    name: string;
    basePrice: number;
    mrp?: number;
    discount?: number;
    variants: Array<{
      _id?: string;
      size?: string;
      color: string;
      hexCode?: string;
      sku?: string;
      stock?: number;
      isAvailable?: boolean;
      images?: string[];
    }>;
  };
  placementTemplateId?: {
    _id: string;
    name: string;
    code: string;
    side: string;
    previewConfig: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
};

export const ALL_CUSTOM_CATALOG_ITEMS: CatalogItem[] = [
  {
    _id: "default-1",
    name: "Customized Polo T-Shirt With Your Company Logo",
    slug: "customized-polo-tshirt-with-company-logo",
    description: "Executive 240 GSM combed cotton polo tee with crisp front chest & back logo print. Matty fabric collar, dual front & back view, size range S-4XL.",
    mockupImageUrl: "/images/custom_polo_blue_mockup.png",
    displayPrice: 1449,
    isActive: true,
    category: "Polo T-Shirts",
    productId: {
      _id: "p1",
      name: "Customized Polo T-Shirt",
      basePrice: 1449,
      mrp: 1999,
      discount: 28,
      variants: [
        { _id: "p1-v1", size: "S", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-S", isAvailable: true, stock: 100 },
        { _id: "p1-v2", size: "M", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-M", isAvailable: true, stock: 100 },
        { _id: "p1-v3", size: "L", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-L", isAvailable: true, stock: 100 },
        { _id: "p1-v4", size: "XL", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-XL", isAvailable: true, stock: 100 },
        { _id: "p1-v5", size: "2XL", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-2XL", isAvailable: true, stock: 100 },
        { _id: "p1-v6", size: "3XL", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-3XL", isAvailable: true, stock: 100 },
        { _id: "p1-v7", size: "4XL", color: "Royal Blue", hexCode: "#2563eb", sku: "POLO-ROY-4XL", isAvailable: true, stock: 100 },
        { _id: "p1-v8", size: "L", color: "Black", hexCode: "#18181b", sku: "POLO-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p1-v9", size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "POLO-NVY-L", isAvailable: true, stock: 100 },
        { _id: "p1-v10", size: "L", color: "Heather Grey", hexCode: "#9ca3af", sku: "POLO-GRY-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl1",
      name: "Front Chest & Back Logo",
      code: "CHEST_BACK_LOGO",
      side: "FRONT",
      previewConfig: { x: 35, y: 35, width: 30, height: 25 },
    },
  },
  {
    _id: "default-2",
    name: "100% Super Combed Cotton Custom Printed T-Shirt",
    slug: "customized-100-pure-cotton-tshirt",
    description: "Soft, breathable 220 GSM round-neck tee. High-definition DTG logo printing for daily casual wear, company swags, or team events.",
    mockupImageUrl: "/images/custom_polo_grey_mockup.png",
    displayPrice: 1199,
    isActive: true,
    category: "100% Cotton",
    productId: {
      _id: "p2",
      name: "100% Cotton Custom Tee",
      basePrice: 1199,
      mrp: 1699,
      discount: 29,
      variants: [
        { _id: "p2-v1", size: "M", color: "Heather Grey", hexCode: "#9ca3af", sku: "COT-GRY-M", isAvailable: true, stock: 100 },
        { _id: "p2-v2", size: "L", color: "Heather Grey", hexCode: "#9ca3af", sku: "COT-GRY-L", isAvailable: true, stock: 100 },
        { _id: "p2-v3", size: "L", color: "Black", hexCode: "#18181b", sku: "COT-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p2-v4", size: "L", color: "White", hexCode: "#ffffff", sku: "COT-WHT-L", isAvailable: true, stock: 100 },
        { _id: "p2-v5", size: "L", color: "Charcoal", hexCode: "#3f3f46", sku: "COT-CHR-L", isAvailable: true, stock: 100 },
        { _id: "p2-v6", size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "COT-NVY-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl2",
      name: "Front & Back Print",
      code: "FRONT_BACK_LOGO",
      side: "FRONT",
      previewConfig: { x: 30, y: 32, width: 40, height: 35 },
    },
  },
  {
    _id: "default-3",
    name: "3-Fabric Combo Set (Matty, 100% Pure Cotton & Micro Poly)",
    slug: "oversized-heavyweight-custom-graphic-tee",
    description: "3 Different Style T-Shirts in Every Set! Matty Fabric, 100% Pure Cotton, and 100% Micro Polyester with front logo print. Available S-4XL.",
    mockupImageUrl: "/images/custom_polo_black_mockup.png",
    displayPrice: 1699,
    isActive: true,
    category: "Polo T-Shirts",
    productId: {
      _id: "p3",
      name: "3-Fabric Custom Combo Polo Set",
      basePrice: 1699,
      mrp: 2399,
      discount: 29,
      variants: [
        { _id: "p3-v1", size: "M", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-M", isAvailable: true, stock: 100 },
        { _id: "p3-v2", size: "L", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p3-v3", size: "XL", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-XL", isAvailable: true, stock: 100 },
        { _id: "p3-v4", size: "2XL", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-2XL", isAvailable: true, stock: 100 },
        { _id: "p3-v5", size: "3XL", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-3XL", isAvailable: true, stock: 100 },
        { _id: "p3-v6", size: "4XL", color: "Jet Black", hexCode: "#18181b", sku: "SET-BLK-4XL", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl3",
      name: "3 Fabric Style Set",
      code: "COMBO_SET",
      side: "FRONT",
      previewConfig: { x: 25, y: 25, width: 50, height: 50 },
    },
  },
  {
    _id: "default-4",
    name: "Dry-Fit Performance Custom Sports & Event T-Shirt",
    slug: "dryfit-performance-custom-sports-tshirt",
    description: "Lightweight moisture-wicking polyester micro-mesh jersey. Ideal for marathons, sports tournaments, college fests, and outdoor activities.",
    mockupImageUrl: "https://images.unsplash.com/photo-1518611012118-696072aa579a?q=80&w=800&auto=format&fit=crop",
    displayPrice: 899,
    isActive: true,
    category: "100% Cotton",
    productId: {
      _id: "p4",
      name: "Dry-Fit Sports Tee",
      basePrice: 899,
      mrp: 1299,
      discount: 30,
      variants: [
        { _id: "p4-v1", size: "M", color: "Royal Blue", hexCode: "#2563eb", sku: "DRY-ROY-M", isAvailable: true, stock: 100 },
        { _id: "p4-v2", size: "L", color: "Royal Blue", hexCode: "#2563eb", sku: "DRY-ROY-L", isAvailable: true, stock: 100 },
        { _id: "p4-v3", size: "L", color: "Red", hexCode: "#dc2626", sku: "DRY-RED-L", isAvailable: true, stock: 100 },
        { _id: "p4-v4", size: "L", color: "Neon Green", hexCode: "#65a30d", sku: "DRY-NEO-L", isAvailable: true, stock: 100 },
        { _id: "p4-v5", size: "L", color: "Black", hexCode: "#18181b", sku: "DRY-BLK-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl4",
      name: "Chest & Sleeve Print",
      code: "SLEEVE_CHEST",
      side: "FRONT",
      previewConfig: { x: 35, y: 35, width: 30, height: 25 },
    },
  },
  {
    _id: "default-5",
    name: "Custom Embroidered Corporate Hoodie & Sweatshirt",
    slug: "custom-embroidered-corporate-hoodie",
    description: "Premium 320 GSM fleece hoodie with front kangaroo pocket and dual hood lining. High-density embroidered company logo.",
    mockupImageUrl: "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?q=80&w=800&auto=format&fit=crop",
    displayPrice: 2299,
    isActive: true,
    category: "Hoodies & Outerwear",
    productId: {
      _id: "p5",
      name: "Corporate Hoodie",
      basePrice: 2299,
      mrp: 3199,
      discount: 28,
      variants: [
        { _id: "p5-v1", size: "M", color: "Black", hexCode: "#18181b", sku: "HD-BLK-M", isAvailable: true, stock: 100 },
        { _id: "p5-v2", size: "L", color: "Black", hexCode: "#18181b", sku: "HD-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p5-v3", size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "HD-NVY-L", isAvailable: true, stock: 100 },
        { _id: "p5-v4", size: "L", color: "Heather Gray", hexCode: "#9ca3af", sku: "HD-GRY-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl5",
      name: "Embroidered Chest Logo",
      code: "EMBROIDERED_CHEST",
      side: "FRONT",
      previewConfig: { x: 35, y: 35, width: 28, height: 22 },
    },
  },
  {
    _id: "default-6",
    name: "Promotional Exhibition Full-Back Branding T-Shirt",
    slug: "promotional-exhibition-fullback-branding-tee",
    description: "High-visibility promotional tee with prominent back advertisement print and front crest logo for marketing campaigns and events.",
    mockupImageUrl: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?q=80&w=800&auto=format&fit=crop",
    displayPrice: 1299,
    isActive: true,
    category: "100% Cotton",
    productId: {
      _id: "p6",
      name: "Promotional Branding Tee",
      basePrice: 1299,
      mrp: 1799,
      discount: 27,
      variants: [
        { _id: "p6-v1", size: "M", color: "White", hexCode: "#ffffff", sku: "PRM-WHT-M", isAvailable: true, stock: 100 },
        { _id: "p6-v2", size: "L", color: "White", hexCode: "#ffffff", sku: "PRM-WHT-L", isAvailable: true, stock: 100 },
        { _id: "p6-v3", size: "L", color: "Black", hexCode: "#18181b", sku: "PRM-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p6-v4", size: "L", color: "Yellow", hexCode: "#eab308", sku: "PRM-YEL-L", isAvailable: true, stock: 100 },
        { _id: "p6-v5", size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "PRM-NVY-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl6",
      name: "Full Back & Front Crest",
      code: "FULL_BACK_CREST",
      side: "BACK",
      previewConfig: { x: 25, y: 25, width: 50, height: 50 },
    },
  },
  {
    _id: "default-7",
    name: "Executive Zipper-Collar Custom Polo T-Shirt",
    slug: "executive-zipper-collar-custom-polo",
    description: "Modern metallic zipper placket polo tee crafted from Mercerized 240 GSM cotton. Premium executive gifting for leadership teams.",
    mockupImageUrl: "/images/custom_print_hero.png",
    displayPrice: 1599,
    isActive: true,
    category: "Polo T-Shirts",
    productId: {
      _id: "p7",
      name: "Executive Zip Polo",
      basePrice: 1599,
      mrp: 2199,
      discount: 27,
      variants: [
        { _id: "p7-v1", size: "M", color: "Navy", hexCode: "#1e3a8a", sku: "ZIP-NVY-M", isAvailable: true, stock: 100 },
        { _id: "p7-v2", size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "ZIP-NVY-L", isAvailable: true, stock: 100 },
        { _id: "p7-v3", size: "L", color: "Charcoal", hexCode: "#3f3f46", sku: "ZIP-CHR-L", isAvailable: true, stock: 100 },
        { _id: "p7-v4", size: "L", color: "Emerald", hexCode: "#047857", sku: "ZIP-EMR-L", isAvailable: true, stock: 100 },
        { _id: "p7-v5", size: "L", color: "Maroon", hexCode: "#881337", sku: "ZIP-MRN-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl7",
      name: "Executive Chest Logo",
      code: "EXEC_CHEST",
      side: "FRONT",
      previewConfig: { x: 35, y: 35, width: 30, height: 25 },
    },
  },
  {
    _id: "default-8",
    name: "Minimalist Pocket Print Custom Logo T-Shirt",
    slug: "minimalist-pocket-print-custom-logo-tshirt",
    description: "Subtle, stylish chest pocket detailing with crisp brand logo print. Clean streetwear & modern casual office aesthetic.",
    mockupImageUrl: "https://images.unsplash.com/photo-1581655353564-df123a1eb820?q=80&w=800&auto=format&fit=crop",
    displayPrice: 1349,
    isActive: true,
    category: "100% Cotton",
    productId: {
      _id: "p8",
      name: "Pocket Print Custom Tee",
      basePrice: 1349,
      mrp: 1899,
      discount: 28,
      variants: [
        { _id: "p8-v1", size: "M", color: "Sand", hexCode: "#d6c0b3", sku: "PCK-SND-M", isAvailable: true, stock: 100 },
        { _id: "p8-v2", size: "L", color: "Sand", hexCode: "#d6c0b3", sku: "PCK-SND-L", isAvailable: true, stock: 100 },
        { _id: "p8-v3", size: "L", color: "Black", hexCode: "#18181b", sku: "PCK-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p8-v4", size: "L", color: "Pure White", hexCode: "#ffffff", sku: "PCK-WHT-L", isAvailable: true, stock: 100 },
        { _id: "p8-v5", size: "L", color: "Sage", hexCode: "#3f6212", sku: "PCK-SGE-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl8",
      name: "Chest Pocket Logo",
      code: "POCKET_LOGO",
      side: "FRONT",
      previewConfig: { x: 35, y: 35, width: 25, height: 25 },
    },
  },
  {
    _id: "default-9",
    name: "Custom Corporate Gift Set (Tee + Pen + Flask + Cardholder)",
    slug: "custom-corporate-gift-box-set",
    description: "4-in-1 Premium Executive Gift Box including customized polo tee, stainless thermal flask, metal pen & leather cardholder.",
    mockupImageUrl: "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?q=80&w=800&auto=format&fit=crop",
    displayPrice: 2999,
    isActive: true,
    category: "Corporate Gifts",
    productId: {
      _id: "p9",
      name: "Corporate Gift Box",
      basePrice: 2999,
      mrp: 4499,
      discount: 33,
      variants: [
        { _id: "p9-v1", size: "L", color: "Premium Black", hexCode: "#18181b", sku: "BOX-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p9-v2", size: "L", color: "Royal Navy", hexCode: "#1e3a8a", sku: "BOX-NVY-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl9",
      name: "Complete Box Set",
      code: "BOX_SET",
      side: "FRONT",
      previewConfig: { x: 30, y: 30, width: 40, height: 40 },
    },
  },
  {
    _id: "default-10",
    name: "Custom Round Neck Bio-Washed Cotton T-Shirt",
    slug: "custom-round-neck-biowashed-cotton-tshirt",
    description: "Ultra-smooth 180 GSM bio-washed cotton T-shirt designed for maximum print clarity. Perfect for giveaways and mass corporate events.",
    mockupImageUrl: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?q=80&w=800&auto=format&fit=crop",
    displayPrice: 999,
    isActive: true,
    category: "100% Cotton",
    productId: {
      _id: "p10",
      name: "Bio-Washed Cotton Tee",
      basePrice: 999,
      mrp: 1499,
      discount: 33,
      variants: [
        { _id: "p10-v1", size: "S", color: "Black", hexCode: "#18181b", sku: "BIO-BLK-S", isAvailable: true, stock: 100 },
        { _id: "p10-v2", size: "M", color: "Black", hexCode: "#18181b", sku: "BIO-BLK-M", isAvailable: true, stock: 100 },
        { _id: "p10-v3", size: "L", color: "Black", hexCode: "#18181b", sku: "BIO-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p10-v4", size: "L", color: "White", hexCode: "#ffffff", sku: "BIO-WHT-L", isAvailable: true, stock: 100 },
        { _id: "p10-v5", size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "BIO-NVY-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl10",
      name: "Front Chest Print",
      code: "FRONT_CHEST",
      side: "FRONT",
      previewConfig: { x: 35, y: 35, width: 30, height: 25 },
    },
  },
  {
    _id: "default-11",
    name: "Premium Customized V-Neck Logo Printed T-Shirt",
    slug: "premium-customized-vneck-logo-printed-tshirt",
    description: "Sleek 200 GSM V-neck tee with tailored fit. Excellent choice for hospitality staff, retail teams, and corporate uniforms.",
    mockupImageUrl: "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?q=80&w=800&auto=format&fit=crop",
    displayPrice: 1249,
    isActive: true,
    category: "100% Cotton",
    productId: {
      _id: "p11",
      name: "Custom V-Neck Tee",
      basePrice: 1249,
      mrp: 1799,
      discount: 30,
      variants: [
        { _id: "p11-v1", size: "M", color: "Black", hexCode: "#18181b", sku: "VNK-BLK-M", isAvailable: true, stock: 100 },
        { _id: "p11-v2", size: "L", color: "Black", hexCode: "#18181b", sku: "VNK-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p11-v3", size: "L", color: "Charcoal", hexCode: "#3f3f46", sku: "VNK-CHR-L", isAvailable: true, stock: 100 },
        { _id: "p11-v4", size: "L", color: "White", hexCode: "#ffffff", sku: "VNK-WHT-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl11",
      name: "V-Neck Chest Print",
      code: "VNECK_CHEST",
      side: "FRONT",
      previewConfig: { x: 35, y: 38, width: 30, height: 22 },
    },
  },
  {
    _id: "default-12",
    name: "Custom Sleeveless Gym & Athletic Tank Top",
    slug: "custom-sleeveless-gym-sports-training-jersey",
    description: "Breathable moisture-wicking dry-fit tank top for fitness clubs, sports teams, marathon runners, and outdoor events.",
    mockupImageUrl: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?q=80&w=800&auto=format&fit=crop",
    displayPrice: 799,
    isActive: true,
    category: "100% Cotton",
    productId: {
      _id: "p12",
      name: "Athletic Tank Top",
      basePrice: 799,
      mrp: 1199,
      discount: 33,
      variants: [
        { _id: "p12-v1", size: "M", color: "Black", hexCode: "#18181b", sku: "TNK-BLK-M", isAvailable: true, stock: 100 },
        { _id: "p12-v2", size: "L", color: "Black", hexCode: "#18181b", sku: "TNK-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p12-v3", size: "L", color: "Red", hexCode: "#dc2626", sku: "TNK-RED-L", isAvailable: true, stock: 100 },
        { _id: "p12-v4", size: "L", color: "Royal Blue", hexCode: "#2563eb", sku: "TNK-ROY-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl12",
      name: "Center Chest Print",
      code: "TANK_CHEST",
      side: "FRONT",
      previewConfig: { x: 32, y: 32, width: 36, height: 36 },
    },
  },
  {
    _id: "default-13",
    name: "Custom Varsity Bomber Jacket with Company Embroidery",
    slug: "custom-varsity-bomber-jacket-company-embroidery",
    description: "Heavyweight winter corporate jacket with ribbed collar, brass zipper, and high-density logo embroidery on front chest and back.",
    mockupImageUrl: "https://images.unsplash.com/photo-1548883354-7622d03aca27?q=80&w=800&auto=format&fit=crop",
    displayPrice: 3499,
    isActive: true,
    category: "Hoodies & Outerwear",
    productId: {
      _id: "p13",
      name: "Varsity Bomber Jacket",
      basePrice: 3499,
      mrp: 4999,
      discount: 30,
      variants: [
        { _id: "p13-v1", size: "M", color: "Black", hexCode: "#18181b", sku: "JKT-BLK-M", isAvailable: true, stock: 100 },
        { _id: "p13-v2", size: "L", color: "Black", hexCode: "#18181b", sku: "JKT-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p13-v3", size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "JKT-NVY-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl13",
      name: "Embroidered Chest & Back",
      code: "JACKET_EMB",
      side: "FRONT",
      previewConfig: { x: 35, y: 35, width: 28, height: 25 },
    },
  },
  {
    _id: "default-14",
    name: "Custom Printed Full-Sleeve Unisex Cotton T-Shirt",
    slug: "custom-printed-full-sleeve-unisex-cotton-tshirt",
    description: "Comfortable 220 GSM full-sleeve crewneck tee with rib cuffs. Supports front logo print and dual sleeve branding.",
    mockupImageUrl: "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?q=80&w=800&auto=format&fit=crop",
    displayPrice: 1499,
    isActive: true,
    category: "100% Cotton",
    productId: {
      _id: "p14",
      name: "Full-Sleeve Custom Tee",
      basePrice: 1499,
      mrp: 2099,
      discount: 28,
      variants: [
        { _id: "p14-v1", size: "M", color: "Black", hexCode: "#18181b", sku: "FSL-BLK-M", isAvailable: true, stock: 100 },
        { _id: "p14-v2", size: "L", color: "Black", hexCode: "#18181b", sku: "FSL-BLK-L", isAvailable: true, stock: 100 },
        { _id: "p14-v3", size: "L", color: "White", hexCode: "#ffffff", sku: "FSL-WHT-L", isAvailable: true, stock: 100 },
        { _id: "p14-v4", size: "L", color: "Navy", hexCode: "#1e3a8a", sku: "FSL-NVY-L", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl14",
      name: "Chest & Sleeve Print",
      code: "FULL_SLEEVE_CHEST",
      side: "FRONT",
      previewConfig: { x: 35, y: 35, width: 30, height: 25 },
    },
  },
  {
    _id: "default-15",
    name: "Customized Canvas Tote Bag for Event Branding",
    slug: "customized-canvas-tote-bag-event-branding",
    description: "Heavy-duty 300 GSM natural cotton canvas tote bag. Eco-friendly promotional item for corporate events, tradeshows, and fests.",
    mockupImageUrl: "https://images.unsplash.com/photo-1544816155-12df9643f363?q=80&w=800&auto=format&fit=crop",
    displayPrice: 599,
    isActive: true,
    category: "Accessories & Bags",
    productId: {
      _id: "p15",
      name: "Custom Canvas Tote Bag",
      basePrice: 599,
      mrp: 899,
      discount: 33,
      variants: [
        { _id: "p15-v1", size: "Standard", color: "Natural Beige", hexCode: "#d6c0b3", sku: "TOT-BEI-STD", isAvailable: true, stock: 100 },
        { _id: "p15-v2", size: "Standard", color: "Jet Black", hexCode: "#18181b", sku: "TOT-BLK-STD", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl15",
      name: "Tote Bag Center Logo",
      code: "TOTE_CENTER",
      side: "FRONT",
      previewConfig: { x: 30, y: 30, width: 40, height: 40 },
    },
  },
  {
    _id: "default-16",
    name: "Custom Logo Embroidered Baseball Cap & Trucker Hat",
    slug: "custom-logo-printed-baseball-cap-trucker-hat",
    description: "Premium 6-panel cotton twill cap with metal buckle closure. High-density embroidered logo on front panel.",
    mockupImageUrl: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?q=80&w=800&auto=format&fit=crop",
    displayPrice: 699,
    isActive: true,
    category: "Accessories & Bags",
    productId: {
      _id: "p16",
      name: "Custom Embroidered Cap",
      basePrice: 699,
      mrp: 999,
      discount: 30,
      variants: [
        { _id: "p16-v1", size: "Free Size", color: "Black", hexCode: "#18181b", sku: "CAP-BLK-FS", isAvailable: true, stock: 100 },
        { _id: "p16-v2", size: "Free Size", color: "Navy", hexCode: "#1e3a8a", sku: "CAP-NVY-FS", isAvailable: true, stock: 100 },
        { _id: "p16-v3", size: "Free Size", color: "White", hexCode: "#ffffff", sku: "CAP-WHT-FS", isAvailable: true, stock: 100 },
      ],
    },
    placementTemplateId: {
      _id: "tpl16",
      name: "Cap Front Panel Logo",
      code: "CAP_FRONT",
      side: "FRONT",
      previewConfig: { x: 35, y: 35, width: 30, height: 20 },
    },
  },
];
