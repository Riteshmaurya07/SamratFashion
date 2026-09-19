import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { CustomTemplate } from "../models/CustomTemplate";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const seedTemplates = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error("MONGODB_URI is not defined in environment variables");
    }

    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("Connected successfully.");

    const seedData = [
      {
        name: "Corporate Standard",
        category: "Corporate",
        tags: ["Logo", "Clean", "Business"],
        thumbnailUrl: "https://via.placeholder.com/300x400?text=Corporate+Standard",
        isActive: true,
        design: {
          front: {
            elements: [
              {
                id: "t1-el1",
                type: "TEXT",
                x: 150,
                y: 150,
                width: 200,
                height: 50,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                opacity: 1,
                locked: false,
                zIndex: 1,
                properties: {
                  text: "COMPANY NAME",
                  fontFamily: "Arial",
                  fontSize: 24,
                  fill: "#333333",
                  fontWeight: "bold"
                }
              }
            ]
          },
          back: { elements: [] },
          leftSleeve: { elements: [] },
          rightSleeve: { elements: [] }
        }
      },
      {
        name: "Team Jersey",
        category: "Team",
        tags: ["Sports", "Number", "Name"],
        thumbnailUrl: "https://via.placeholder.com/300x400?text=Team+Jersey",
        isActive: true,
        design: {
          front: { elements: [] },
          back: {
            elements: [
              {
                id: "t2-el1",
                type: "TEXT",
                x: 100,
                y: 100,
                width: 300,
                height: 80,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                opacity: 1,
                locked: false,
                zIndex: 1,
                properties: {
                  text: "PLAYER",
                  fontFamily: "Impact",
                  fontSize: 48,
                  fill: "#000000"
                }
              },
              {
                id: "t2-el2",
                type: "TEXT",
                x: 150,
                y: 200,
                width: 200,
                height: 150,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                opacity: 1,
                locked: false,
                zIndex: 2,
                properties: {
                  text: "10",
                  fontFamily: "Impact",
                  fontSize: 120,
                  fill: "#000000"
                }
              }
            ]
          },
          leftSleeve: { elements: [] },
          rightSleeve: { elements: [] }
        }
      }
    ];

    console.log("Seeding templates...");
    
    for (const data of seedData) {
      // Upsert to make it idempotent and avoid duplicates
      await CustomTemplate.findOneAndUpdate(
        { name: data.name, category: data.category },
        { $set: data },
        { upsert: true, returnDocument: 'after' }
      );
      console.log(`- Upserted template: ${data.name}`);
    }

    console.log("Template seeding completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Error seeding templates:", error);
    process.exit(1);
  }
};

seedTemplates();
