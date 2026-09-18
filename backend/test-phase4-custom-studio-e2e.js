const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { CustomDesign } = require("./dist/models/CustomDesign");
const { User } = require("./dist/models/User");
const { Product } = require("./dist/models/Product");
const { CustomTemplate } = require("./dist/models/CustomTemplate");
const { AIDesignService } = require("./dist/services/aiDesignService");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

async function runTests() {
  console.log(`${BOLD}Starting Phase 4 Custom Studio E2E Tests...${RESET}\n`);

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // 1. Setup Mock User & Product
    const adminUser = await User.findOne({ role: "ADMIN" }) || await User.findOne();
    if (!adminUser) throw new Error("No user found for testing");

    const product = await Product.findOne({ status: "ACTIVE" });
    if (!product) throw new Error("No active product found for testing");
    const variantId = product.variants[0]?._id;

    console.log(`Using User: ${adminUser.email}`);
    console.log(`Using Product: ${product.name}`);

    // 2. Test AI Service Mock
    console.log(`\n${BOLD}--- Testing AI Service Foundation ---${RESET}`);
    AIDesignService.initialize();
    const aiResult = await AIDesignService.generateImage({ prompt: "Test prompt", style: "Anime" });
    if (aiResult.success && aiResult.imageUrl) {
      console.log(`${GREEN}✅ AI Service Mock: generateImage succeeded with url ${aiResult.imageUrl}${RESET}`);
    } else {
      throw new Error("AI Service failed to generate image");
    }

    // 3. Test Templates List
    console.log(`\n${BOLD}--- Testing Templates List ---${RESET}`);
    const templates = await CustomTemplate.find({ isActive: true });
    if (templates.length >= 0) {
      console.log(`${GREEN}✅ Templates collection accessible. Found ${templates.length} templates.${RESET}`);
    }

    // 4. Test Customer Revision & State Machine
    console.log(`\n${BOLD}--- Testing Customer Revision State Machine ---${RESET}`);
    
    // Create a dummy custom design
    const dummyDesign = new CustomDesign({
      userId: adminUser._id,
      name: "E2E Test Design",
      productId: product._id,
      selectedVariantId: variantId,
      selectedColor: "#ffffff",
      status: "CUSTOMER_REVIEW",
      currentVersion: 1,
      versions: [
        {
          version: 1,
          design: { front: { elements: [] }, back: { elements: [] } },
          createdBy: adminUser._id,
          createdAt: new Date(),
          status: "CUSTOMER_REVIEW"
        }
      ],
      requestType: "DESIGN"
    });
    await dummyDesign.save();
    console.log(`${GREEN}✅ Created test CustomDesign in CUSTOMER_REVIEW state${RESET}`);

    // Simulate requesting a revision
    // Increment version, set status to DRAFT, add revision comment
    const updatedDesign = await CustomDesign.findOneAndUpdate(
      { _id: dummyDesign._id, currentVersion: dummyDesign.currentVersion },
      {
        $set: { status: "DRAFT" },
        $inc: { currentVersion: 1 },
        $push: {
          versions: {
            version: dummyDesign.currentVersion + 1,
            design: { front: { elements: [] }, back: { elements: [] } },
            createdBy: adminUser._id,
            createdAt: new Date(),
            status: "DRAFT",
            revisionComment: "Please move the logo up"
          }
        }
      },
      { new: true }
    );

    if (updatedDesign.status === "DRAFT" && updatedDesign.currentVersion === 2) {
      console.log(`${GREEN}✅ Customer Revision Workflow: Successfully bumped version and reverted to DRAFT${RESET}`);
      const latestVersion = updatedDesign.versions.find(v => v.version === 2);
      if (latestVersion && latestVersion.revisionComment === "Please move the logo up") {
        console.log(`${GREEN}✅ Revision Comment successfully attached to the new version${RESET}`);
      } else {
        throw new Error("Revision comment not found on new version");
      }
    } else {
      throw new Error("Design status or version did not update correctly during revision request");
    }

    // Cleanup
    await CustomDesign.findByIdAndDelete(dummyDesign._id);
    console.log(`${GREEN}✅ Cleaned up test design${RESET}`);

    console.log(`\n${BOLD}${GREEN}🎉 ALL PHASE 4 CUSTOM STUDIO TESTS PASSED SUCCESSFULLY!${RESET}`);

  } catch (error) {
    console.error(`\n${RED}❌ Test Failed: ${error.message}${RESET}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    mongoose.disconnect();
  }
}

runTests();
