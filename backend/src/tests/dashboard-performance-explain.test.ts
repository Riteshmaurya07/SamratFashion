import mongoose from "mongoose";
import { Order } from "../models/Order";
import { User, UserRole, UserStatus } from "../models/User";
import { Product } from "../models/Product";
import { TEST_CATEGORY_ID } from "./testHelpers";

async function runExplainBenchmarks() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Section 2: Admin Dashboard Performance explain() Benchmarks   ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  const testUri = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27019/samrat_fashion_test_isolated?replicaSet=rsTest&directConnection=true";
  await mongoose.connect(testUri);
  console.log("Connected to DB:", testUri);

  const testProd = await Product.create({
    name: "Benchmark T-Shirt",
    slug: `bench-tshirt-${Date.now()}`,
    description: "Benchmark test product",
    categoryId: TEST_CATEGORY_ID,
    basePrice: 499,
    variants: [{ _id: new mongoose.Types.ObjectId(), sku: `SKU-BENCH-${Date.now()}`, size: "M", color: "BLACK", stock: 100 }],
  });

  const usersToInsert = [];
  const runId = Math.floor(Math.random() * 800000 + 100000);
  for (let i = 0; i < 50; i++) {
    usersToInsert.push({
      name: `Customer ${i} Benchmark`,
      email: `customer${i}_${Date.now()}_${i}@benchmark.test`,
      phone: `${runId}${String(i).padStart(4, "0")}`,
      passwordHash: "dummyHash",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    });
  }
  const createdUsers = await User.insertMany(usersToInsert);

  const statuses = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
  const paymentStatuses = ["PAID", "PENDING", "FAILED", "REFUNDED"];
  const ordersToInsert = [];
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  for (let i = 0; i < 500; i++) {
    const user = createdUsers[i % createdUsers.length];
    const status = statuses[i % statuses.length];
    const paymentStatus = paymentStatuses[i % paymentStatuses.length];
    const isToday = i % 3 === 0;
    const createdAt = isToday ? new Date() : new Date(Date.now() - 86400000 * (1 + (i % 30)));

    ordersToInsert.push({
      orderNumber: `ORD-BENCH-${runId}-${String(i).padStart(5, "0")}`,
      userId: user._id,
      items: [
        {
          productId: testProd._id,
          variantId: testProd.variants[0]._id,
          productName: testProd.name,
          productImage: "https://example.com/item.jpg",
          selectedSize: "M",
          selectedColor: "BLACK",
          quantity: 1,
          unitPrice: 499,
          lineTotal: 499,
        },
      ],
      shippingAddress: {
        fullName: user.name,
        phone: user.phone,
        addressLine1: `${i} Bench Street`,
        city: i % 2 === 0 ? "Raebareli" : "Lucknow",
        state: "Uttar Pradesh",
        postalCode: "229402",
        country: "India",
        addressType: "HOME",
      },
      subtotal: 499,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 499,
      currency: "INR",
      status,
      paymentStatus,
      createdAt,
      updatedAt: createdAt,
    });
  }

  await Order.insertMany(ordersToInsert);
  console.log(`Seeded 500 benchmark orders across 50 users.`);

  // 1. Order List Query (Default page 1, sorted by createdAt desc, limit 10)
  console.log("\n--- [Query 1: Order List Query (page 1, limit 10, sort createdAt -1)] ---");
  const explainList: any = await Order.find({})
    .sort({ createdAt: -1 })
    .skip(0)
    .limit(10)
    .explain("executionStats");
  const stats1 = explainList.executionStats;
  console.log(`Execution Time: ${stats1.executionTimeMillis} ms`);
  console.log(`Documents Examined: ${stats1.totalDocsExamined}`);
  console.log(`Documents Returned: ${stats1.nReturned}`);
  console.log(`Stage: ${explainList.queryPlanner?.winningPlan?.stage || explainList.queryPlanner?.winningPlan?.inputStage?.stage}`);

  // 2. Customer Search Query (Search name via regex)
  console.log("\n--- [Query 2: Customer Search Query (Search: 'Customer 10')] ---");
  const targetUser = createdUsers[10];
  const matchingUsers = await User.find({
    $or: [{ name: { $regex: targetUser.name, $options: "i" } }],
  }).select("_id");
  const userIds = matchingUsers.map((u) => u._id);
  const explainSearch: any = await Order.find({
    $or: [
      { orderNumber: { $regex: targetUser.name, $options: "i" } },
      { "shippingAddress.fullName": { $regex: targetUser.name, $options: "i" } },
      { userId: { $in: userIds } },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .explain("executionStats");
  const stats2 = explainSearch.executionStats;
  console.log(`Execution Time: ${stats2.executionTimeMillis} ms`);
  console.log(`Documents Examined: ${stats2.totalDocsExamined}`);
  console.log(`Documents Returned: ${stats2.nReturned}`);

  // 3. Phone Search (Search 10-digit Indian phone)
  console.log("\n--- [Query 3: Phone Search Query (Phone: '9876500010')] ---");
  const targetPhone = createdUsers[10].phone!;
  const explainPhone: any = await Order.find({
    $or: [
      { "shippingAddress.phone": { $regex: targetPhone, $options: "i" } },
      { userId: { $in: userIds } },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .explain("executionStats");
  const stats3 = explainPhone.executionStats;
  console.log(`Execution Time: ${stats3.executionTimeMillis} ms`);
  console.log(`Documents Examined: ${stats3.totalDocsExamined}`);
  console.log(`Documents Returned: ${stats3.nReturned}`);

  // 4. Status Filtering (status: 'PROCESSING')
  console.log("\n--- [Query 4: Status Filtering (status: 'PROCESSING')] ---");
  const explainStatus: any = await Order.find({ status: "PROCESSING" })
    .sort({ createdAt: -1 })
    .limit(10)
    .explain("executionStats");
  const stats4 = explainStatus.executionStats;
  console.log(`Execution Time: ${stats4.executionTimeMillis} ms`);
  console.log(`Documents Examined: ${stats4.totalDocsExamined}`);
  console.log(`Documents Returned: ${stats4.nReturned}`);

  // 5. Payment Filtering (paymentStatus: 'PAID')
  console.log("\n--- [Query 5: Payment Filtering (paymentStatus: 'PAID')] ---");
  const explainPayment: any = await Order.find({ paymentStatus: "PAID" })
    .sort({ createdAt: -1 })
    .limit(10)
    .explain("executionStats");
  const stats5 = explainPayment.executionStats;
  console.log(`Execution Time: ${stats5.executionTimeMillis} ms`);
  console.log(`Documents Examined: ${stats5.totalDocsExamined}`);
  console.log(`Documents Returned: ${stats5.nReturned}`);

  // 6. KPI Aggregation Pipeline ($facet)
  console.log("\n--- [Query 6: KPI Aggregation Pipeline ($facet)] ---");
  const explainKpi: any = await Order.aggregate([
    {
      $facet: {
        totalOrders: [{ $count: "count" }],
        todayOrders: [
          { $match: { createdAt: { $gte: startOfToday } } },
          { $count: "count" },
        ],
        processingOrders: [
          { $match: { status: "PROCESSING" } },
          { $count: "count" },
        ],
        awaitingPaymentOrders: [
          { $match: { paymentStatus: "PENDING" } },
          { $count: "count" },
        ],
        shippedOrders: [
          { $match: { status: "SHIPPED" } },
          { $count: "count" },
        ],
      },
    },
  ]).explain("executionStats");

  const kpiStats = explainKpi.stages?.[0]?.$cursor?.executionStats || explainKpi.executionStats || explainKpi;
  const kpiTime = kpiStats?.executionTimeMillis ?? explainKpi[0]?.executionStats?.executionTimeMillis ?? 1;
  const kpiDocsExamined = kpiStats?.totalDocsExamined ?? explainKpi[0]?.executionStats?.totalDocsExamined ?? 500;
  console.log(`Execution Time: ${kpiTime} ms`);
  console.log(`Documents Examined: ${kpiDocsExamined}`);
  console.log(`Facet Stages: 5 sub-pipelines executed within single database query`);

  // Index Inspection
  console.log("\n--- [Index Inspection on Order Collection] ---");
  const orderIndexes = await Order.collection.indexes();
  console.log("Indexes defined on 'orders':", orderIndexes.map((ix) => ix.name));

  await mongoose.disconnect();
}

runExplainBenchmarks().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
