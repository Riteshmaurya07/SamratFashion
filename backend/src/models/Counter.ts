import mongoose, { Document, Schema } from "mongoose";

export interface ICounter extends Document {
  name: string;
  value: number;
}

const counterSchema = new Schema<ICounter>({
  name: { type: String, required: true, unique: true },
  value: { type: Number, default: 0 },
});

export const Counter = mongoose.model<ICounter>("Counter", counterSchema);

/**
 * Atomically fetch-and-increment a named sequence. `seed` is applied on first
 * insert so new sequences never collide with numbers handed out by the legacy
 * count-based scheme.
 */
export const incrementCounter = async (name: string, seed: number): Promise<number> => {
  const doc = await Counter.findOneAndUpdate(
    { name },
    { $inc: { value: 1 }, $setOnInsert: { value: seed } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );
  return doc!.value;
};