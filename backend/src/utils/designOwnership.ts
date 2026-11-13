import mongoose from "mongoose";
import { CustomDesign, ICustomDesign } from "../models/CustomDesign";
import { AppError } from "./AppError";

/**
 * Uniform rejection for every design that is not owned by the authenticated
 * user. A 403 (never 404) is intentional here: callers must not be able to
 * distinguish "belongs to another customer" from "does not exist", which would
 * turn this endpoint into a design-ID existence oracle.
 */
function forbiddenDesign(): AppError {
  return new AppError("Design not found or does not belong to you", 403, "FORBIDDEN");
}

export function isValidDesignId(value: unknown): value is string {
  return typeof value === "string" && mongoose.Types.ObjectId.isValid(value);
}

/**
 * Extracts every design reference from a cart item's custom configurations.
 * Legacy `customDesignId` references are included so the V1 checkout path is
 * covered by the same ownership boundary.
 */
export function extractDesignIds(item: {
  customConfigurations?: Array<{ designId?: unknown }> | null;
  customDesignId?: unknown;
}): string[] {
  const ids: string[] = [];

  if (Array.isArray(item.customConfigurations)) {
    for (const config of item.customConfigurations) {
      if (config?.designId !== undefined && config?.designId !== null && config?.designId !== "") {
        ids.push(String(config.designId));
      }
    }
  }

  if (item.customDesignId !== undefined && item.customDesignId !== null && item.customDesignId !== "") {
    ids.push(String(item.customDesignId));
  }

  return ids;
}

/**
 * Loads all referenced designs scoped by `userId`. Any malformed or foreign
 * design ID rejects the whole operation before pricing, artwork resolution or
 * any write occurs.
 */
export async function loadOwnedDesignsOrThrow(
  designIds: Iterable<unknown>,
  userId: string | undefined
): Promise<Map<string, ICustomDesign>> {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const uniqueIds = new Set<string>();
  for (const rawId of designIds) {
    if (rawId === undefined || rawId === null || rawId === "") continue;
    if (!isValidDesignId(rawId)) {
      throw forbiddenDesign();
    }
    uniqueIds.add(rawId);
  }

  if (uniqueIds.size === 0) {
    return new Map();
  }

  const ids = Array.from(uniqueIds);
  const designs = await CustomDesign.find({
    _id: { $in: ids },
    userId,
  });

  if (designs.length !== ids.length) {
    throw forbiddenDesign();
  }

  return new Map(designs.map((design) => [design._id.toString(), design]));
}
