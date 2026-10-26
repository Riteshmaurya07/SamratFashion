import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { Category, CategoryStatus } from "../models/Category";
import { Product } from "../models/Product";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { extractDatabaseName } from "../config/testDbGuard";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

export interface MigrationSummary {
  categoriesCreated: string[];
  categoriesUpdated: string[];
  categoriesPreserved: string[];
  customItemsReassigned: Array<{ slug: string; targetCategory: string }>;
  customItemsPreserved: string[];
  dryRun: boolean;
}

export interface TaxonomyMigrationOptions {
  dryRun?: boolean;
  connectionUri?: string;
  mongoUri?: string;
}
export interface MigrationClientInterface {
  readyState: number;
  disconnect: () => Promise<void>;
  connect: (uri: string) => Promise<unknown>;
}

export async function ensureMigrationConnection(
  options?: TaxonomyMigrationOptions,
  client: MigrationClientInterface = {
    get readyState() {
      return mongoose.connection.readyState;
    },
    disconnect: () => mongoose.disconnect(),
    connect: (uri: string) => mongoose.connect(uri),
  }
): Promise<{ connectedUri: string | null; reusedExisting: boolean }> {
  const explicitUri = options?.connectionUri || options?.mongoUri;

  try {
    if (explicitUri) {
      // Always disconnect any existing connection to guarantee connection to the exact requested URI
      if (client.readyState !== 0) {
        await client.disconnect();
      }
      await client.connect(explicitUri);
      return { connectedUri: explicitUri, reusedExisting: false };
    }

    // Default CLI/seeder behavior: reuse existing active connection if present
    if (client.readyState === 1) {
      return { connectedUri: null, reusedExisting: true };
    }

    const defaultUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion";
    await client.connect(defaultUri);
    return { connectedUri: defaultUri, reusedExisting: false };
  } catch (error) {
    if (client.readyState !== 0) {
      try {
        await client.disconnect();
      } catch {
        // Suppress secondary disconnect failure during error recovery
      }
    }
    throw error;
  }
}

export async function runTaxonomyMigration(
  options?: TaxonomyMigrationOptions,
  client?: MigrationClientInterface
): Promise<MigrationSummary> {
  const isDryRun = options?.dryRun ?? (process.argv.includes("--dry-run") || !process.argv.includes("--apply"));

  const explicitUri = options?.connectionUri || options?.mongoUri;

  await ensureMigrationConnection(options, client);

  const activeDbName = mongoose.connection.name || (explicitUri ? extractDatabaseName(explicitUri) : "default");
  console.log(`[TAXONOMY MIGRATION] Mode: ${isDryRun ? "DRY-RUN (No writes)" : "APPLY (Live DB writes)"}`);
  console.log(`[TAXONOMY MIGRATION] Database target: ${activeDbName}`);
  const summary: MigrationSummary = {
    categoriesCreated: [],
    categoriesUpdated: [],
    categoriesPreserved: [],
    customItemsReassigned: [],
    customItemsPreserved: [],
    dryRun: isDryRun,
  };

  try {
    // ─── 1. ROOT CATEGORIES: Coti, T-Shirt, Custom Print ─────────────────────

    // A. Coti (Root Category)
    let coti = await Category.findOne({
      $or: [{ slug: "coti" }, { name: { $regex: /^coti$/i } }],
    });
    if (!coti) {
      summary.categoriesCreated.push("Coti (slug: coti, root)");
      if (!isDryRun) {
        coti = await Category.create({
          name: "Coti",
          slug: "coti",
          description: "Traditional and modern Indian coti vests, waistcoats, and formal ethnic jackets.",
          parentCategory: undefined,
          displayOrder: 1,
          status: CategoryStatus.ACTIVE,
        });
      }
    } else {
      if (coti.name !== "Coti" || coti.parentCategory) {
        summary.categoriesUpdated.push(`Coti (${coti._id}): normalized name/root`);
        if (!isDryRun) {
          coti.name = "Coti";
          coti.parentCategory = undefined;
          await coti.save();
        }
      } else {
        summary.categoriesPreserved.push(`Coti (${coti._id}, slug: ${coti.slug})`);
      }
    }

    // B. T-Shirt (Root Category)
    let tshirt = await Category.findOne({
      $or: [
        { slug: "t-shirts" },
        { slug: "t-shirt" },
        { name: { $regex: /^t-shirts?$/i } },
      ],
      parentCategory: null,
    });
    if (!tshirt) {
      summary.categoriesCreated.push("T-Shirt (slug: t-shirts, root)");
      if (!isDryRun) {
        tshirt = await Category.create({
          name: "T-Shirt",
          slug: "t-shirts",
          description: "Heavyweight drop-shoulder streetwear tees, blanks, and boxy essentials.",
          parentCategory: undefined,
          displayOrder: 2,
          status: CategoryStatus.ACTIVE,
        });
      }
    } else {
      if (tshirt.name !== "T-Shirt") {
        summary.categoriesUpdated.push(`T-Shirt (${tshirt._id}): normalized name from "${tshirt.name}"`);
        if (!isDryRun) {
          tshirt.name = "T-Shirt";
          await tshirt.save();
        }
      } else {
        summary.categoriesPreserved.push(`T-Shirt (${tshirt._id}, slug: ${tshirt.slug})`);
      }
    }

    // C. Custom Print (Root Category)
    let customPrint = await Category.findOne({
      $or: [
        { slug: "custom-print" },
        { slug: "custom-printing" },
        { name: { $regex: /^custom print(ing)?$/i } },
      ],
      parentCategory: null,
    });
    if (!customPrint) {
      summary.categoriesCreated.push("Custom Print (slug: custom-print, root)");
      if (!isDryRun) {
        customPrint = await Category.create({
          name: "Custom Print",
          slug: "custom-print",
          description: "On-demand custom printed apparel, team jerseys, and corporate apparel.",
          parentCategory: undefined,
          displayOrder: 3,
          status: CategoryStatus.ACTIVE,
        });
      }
    } else {
      if (customPrint.name !== "Custom Print") {
        summary.categoriesUpdated.push(`Custom Print (${customPrint._id}): normalized name from "${customPrint.name}"`);
        if (!isDryRun) {
          customPrint.name = "Custom Print";
          await customPrint.save();
        }
      } else {
        summary.categoriesPreserved.push(`Custom Print (${customPrint._id}, slug: ${customPrint.slug})`);
      }
    }

    // ─── 2. SUB-CATEGORIES UNDER CUSTOM PRINT: Jersey & Corporate Jersey ─────
    const customPrintId = customPrint ? customPrint._id : new mongoose.Types.ObjectId();

    // A. Jersey (child of Custom Print)
    let jersey = await Category.findOne({
      $or: [{ slug: "jersey" }, { name: { $regex: /^jersey$/i } }],
      parentCategory: customPrintId,
    });
    if (!jersey) {
      summary.categoriesCreated.push("Jersey (child of Custom Print)");
      if (!isDryRun) {
        jersey = await Category.create({
          name: "Jersey",
          slug: "jersey",
          description: "Custom printed athletic, gym, esports, and sports tournament jerseys.",
          parentCategory: customPrintId,
          displayOrder: 1,
          status: CategoryStatus.ACTIVE,
        });
      }
    } else {
      summary.categoriesPreserved.push(`Jersey (${jersey._id}, parent: Custom Print)`);
    }

    // B. Corporate Jersey (child of Custom Print)
    let corporateJersey = await Category.findOne({
      $or: [{ slug: "corporate-jersey" }, { name: { $regex: /^corporate jersey$/i } }],
      parentCategory: customPrintId,
    });
    if (!corporateJersey) {
      summary.categoriesCreated.push("Corporate Jersey (child of Custom Print)");
      if (!isDryRun) {
        corporateJersey = await Category.create({
          name: "Corporate Jersey",
          slug: "corporate-jersey",
          description: "Branded corporate jerseys, team offsite polos, and company event jerseys.",
          parentCategory: customPrintId,
          displayOrder: 2,
          status: CategoryStatus.ACTIVE,
        });
      }
    } else {
      summary.categoriesPreserved.push(`Corporate Jersey (${corporateJersey._id}, parent: Custom Print)`);
    }

    // ─── 3. RECONCILE CUSTOM PRINT CATALOG ITEMS (Safe Category Linking) ──────
    const allCustomItems = await CustomPrintCatalogItem.find().populate("productId", "name categoryId");

    for (const item of allCustomItems) {
      // If item already has a valid category assigned, preserve it
      if (item.categoryId) {
        summary.customItemsPreserved.push(`${item.slug} (already assigned to ${item.categoryId})`);
        continue;
      }

      const nameAndSlug = (item.name + " " + item.slug).toLowerCase();
      let targetCategory: mongoose.Types.ObjectId | null = null;
      let targetName = "";

      if (
        nameAndSlug.includes("jersey") ||
        nameAndSlug.includes("sports") ||
        nameAndSlug.includes("athletic") ||
        nameAndSlug.includes("training") ||
        nameAndSlug.includes("gym") ||
        nameAndSlug.includes("dryfit")
      ) {
        targetCategory = jersey ? (jersey._id as mongoose.Types.ObjectId) : new mongoose.Types.ObjectId();
        targetName = "Jersey";
      } else if (
        nameAndSlug.includes("corporate") ||
        nameAndSlug.includes("company") ||
        nameAndSlug.includes("polo") ||
        nameAndSlug.includes("executive") ||
        nameAndSlug.includes("promotional") ||
        nameAndSlug.includes("branding") ||
        nameAndSlug.includes("uniform")
      ) {
        targetCategory = corporateJersey ? (corporateJersey._id as mongoose.Types.ObjectId) : new mongoose.Types.ObjectId();
        targetName = "Corporate Jersey";
      } else {
        targetCategory = customPrint ? (customPrint._id as mongoose.Types.ObjectId) : new mongoose.Types.ObjectId();
        targetName = "Custom Print";
      }

      summary.customItemsReassigned.push({ slug: item.slug, targetCategory: targetName });
      if (!isDryRun) {
        item.categoryId = targetCategory;
        await item.save();

        // Sync product record category if unassigned or generic
        const product = item.productId as any;
        if (product && !product.categoryId) {
          await Product.updateOne({ _id: product._id }, { $set: { categoryId: targetCategory } });
        }
      }
    }

    // Print Report
    console.log("\n=======================================================");
    console.log(`[TAXONOMY MIGRATION REPORT] (${isDryRun ? "DRY-RUN SUMMARY" : "APPLIED SUCCESSFULLY"})`);
    console.log("=======================================================");
    console.log(`Categories Created (${summary.categoriesCreated.length}):`, summary.categoriesCreated);
    console.log(`Categories Updated (${summary.categoriesUpdated.length}):`, summary.categoriesUpdated);
    console.log(`Categories Preserved (${summary.categoriesPreserved.length}):`, summary.categoriesPreserved);
    console.log(`Custom Items Linked (${summary.customItemsReassigned.length}):`);
    summary.customItemsReassigned.forEach((r) => console.log(`  - ${r.slug} -> ${r.targetCategory}`));
    console.log(`Custom Items Preserved (${summary.customItemsPreserved.length})`);
    console.log("=======================================================\n");

    return summary;
  } finally {
    if (process.argv[1]?.includes("migrateTaxonomy")) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  runTaxonomyMigration().catch((err) => {
    console.error("[TAXONOMY MIGRATION ERROR]", err);
    process.exit(1);
  });
}
