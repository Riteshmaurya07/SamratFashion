import mongoose from "mongoose";
import { Product } from "../models/Product";

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI || process.env.Mongodb_URI;

  if (!uri) {
    console.error("CRITICAL ERROR: MONGODB_URI is not defined in environment variables.");
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(uri);
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    mongoose.connection.on("error", (err) => {
      console.error(`MongoDB connection error: ${err}`);
    });

    mongoose.connection.on("disconnected", () => {
      console.log("MongoDB disconnected");
    });

    // Build the catalog integrity indexes (notably the catalog-wide unique SKU
    // index) and make a failure loud: an existing duplicate SKU means the
    // guarantee is NOT active until the data is cleaned up.
    Product.init().catch((error: Error) => {
      console.error(
        "CRITICAL: could not enforce unique product SKUs. " +
        "Remove duplicate values in `products.variants.sku` and restart. " +
        error.message
      );
    });

    const isStrict = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";
    if (isStrict) {
      const txSupport = await verifyDatabaseTransactionSupport(conn.connection);
      if (!txSupport.supported) {
        console.error(
          `FATAL DATABASE ERROR: Configured MongoDB deployment does not support transactions (${txSupport.error}). Payment, refund, and stock restoration require a MongoDB Replica Set or MongoDB Atlas cluster.`
        );
        process.exit(1);
      }
      console.log(`MongoDB Transaction Support Verified: [${txSupport.topology}] (setName: ${txSupport.setName || "N/A"})`);
    }

  } catch (error) {
    console.error(`Error connecting to MongoDB: ${(error as Error).message}`);
    process.exit(1);
  }
};

export const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log("MongoDB connection closed.");
  } catch (error) {
    console.error(`Error disconnecting from MongoDB: ${(error as Error).message}`);
  }
};

export interface TransactionSupportResult {
  supported: boolean;
  topology: "replica_set" | "mongos" | "standalone" | "unknown";
  setName?: string;
  error?: string;
}

export const verifyDatabaseTransactionSupport = async (
  conn: mongoose.Connection = mongoose.connection
): Promise<TransactionSupportResult> => {
  if (conn.readyState !== 1 || !conn.db) {
    return {
      supported: false,
      topology: "unknown",
      error: "Database is not connected",
    };
  }

  try {
    const hello = await conn.db
      .command({ hello: 1 })
      .catch(() => conn.db!.admin().command({ hello: 1 }))
      .catch(() => conn.db!.command({ isMaster: 1 }));
    const setName = typeof hello.setName === "string" ? hello.setName : undefined;
    const isMongos = hello.msg === "isdbgrid";
    const topology: TransactionSupportResult["topology"] = setName
      ? "replica_set"
      : isMongos
      ? "mongos"
      : "standalone";

    if (!setName && !isMongos) {
      return {
        supported: false,
        topology: "standalone",
        error: "MongoDB deployment is standalone. Multi-document transactions require a Replica Set or sharded cluster.",
      };
    }

    // Perform empirical non-destructive transaction check executing a real operation
    const session = await conn.startSession();
    try {
      session.startTransaction();
      const probeColl = conn.db.collection("__tx_preflight_probe__");
      // Real database command executed within the session to verify active transaction capability
      await probeColl.findOne({}, { session });
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }
    return {
      supported: true,
      topology,
      setName,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      supported: false,
      topology: "standalone",
      error: errorMsg,
    };
  }
};
