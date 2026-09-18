/**
 * Production Asset Service
 *
 * Orchestrates production asset generation using the ProductionRenderer abstraction.
 * The active renderer is selected via the PRODUCTION_RENDERER environment variable:
 *
 *   PRODUCTION_RENDERER=canvas   → CanvasProductionRenderer (real, fabric + node-canvas)
 *   PRODUCTION_RENDERER=mock     → MockProductionRenderer (returns 501 UNAVAILABLE)
 *   (default)                    → MockProductionRenderer
 *
 * After successful rendering, assets are stored via AssetService.registerProductionAsset()
 * which enforces immutability at both application and database levels.
 */

import { ICustomDesign } from "../models/CustomDesign";
import { AppError } from "../utils/AppError";
import { AssetService } from "./assetService";

export interface IProductionAssetResult {
  side: "FRONT" | "BACK" | "LEFT_SLEEVE" | "RIGHT_SLEEVE";
  url: string;
  width: number;
  height: number;
  mimeType: string;
  fileSize: number;
}

export interface ProductionRenderer {
  renderFront(design: ICustomDesign, version: number): Promise<IProductionAssetResult>;
  renderBack(design: ICustomDesign, version: number): Promise<IProductionAssetResult>;
  renderLeftSleeve(design: ICustomDesign, version: number): Promise<IProductionAssetResult>;
  renderRightSleeve(design: ICustomDesign, version: number): Promise<IProductionAssetResult>;
}

export class MockProductionRenderer implements ProductionRenderer {
  async renderFront(_design: ICustomDesign, _version: number): Promise<IProductionAssetResult> {
    throw new AppError("PRODUCTION_ASSET_GENERATION_UNAVAILABLE", 501);
  }

  async renderBack(_design: ICustomDesign, _version: number): Promise<IProductionAssetResult> {
    throw new AppError("PRODUCTION_ASSET_GENERATION_UNAVAILABLE", 501);
  }

  async renderLeftSleeve(_design: ICustomDesign, _version: number): Promise<IProductionAssetResult> {
    throw new AppError("PRODUCTION_ASSET_GENERATION_UNAVAILABLE", 501);
  }

  async renderRightSleeve(_design: ICustomDesign, _version: number): Promise<IProductionAssetResult> {
    throw new AppError("PRODUCTION_ASSET_GENERATION_UNAVAILABLE", 501);
  }
}

/**
 * Lazily loads the CanvasProductionRenderer only when PRODUCTION_RENDERER=canvas.
 * This avoids importing fabric/canvas unless actually needed.
 */
function createRenderer(): ProductionRenderer {
  const rendererType = process.env.PRODUCTION_RENDERER || "mock";
  if (rendererType === "canvas") {
    // Lazy import: only load when configured
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CanvasProductionRenderer } = require("./rendering/CanvasProductionRenderer");
    return new CanvasProductionRenderer();
  }
  return new MockProductionRenderer();
}

export class ProductionAssetService {
  private renderer: ProductionRenderer;

  constructor(renderer?: ProductionRenderer) {
    this.renderer = renderer || createRenderer();
  }

  /**
   * Validate that the design is ready for production.
   * Throws descriptive errors for each failed condition.
   */
  public validateForProduction(design: ICustomDesign, targetVersion: number) {
    const versionData = design.versions.find(v => v.version === targetVersion);
    if (!versionData) {
      throw new AppError(`Design version ${targetVersion} not found.`, 404);
    }

    if (design.approvedVersion !== targetVersion) {
      throw new AppError(
        `Cannot generate production assets for unapproved version ${targetVersion}. ` +
        `Approved version is ${design.approvedVersion}.`,
        400
      );
    }

    const layout = versionData.design;
    if (!layout) {
      throw new AppError("Design version has no layout data.", 400);
    }

    // Validate elements within each side
    const sides = [
      { key: "front", data: layout.front },
      { key: "back", data: layout.back },
      { key: "leftSleeve", data: layout.leftSleeve },
      { key: "rightSleeve", data: layout.rightSleeve },
    ];

    for (const { key, data } of sides) {
      if (!data?.elements) continue;
      for (const el of data.elements) {
        // Check for wildly out-of-bounds elements
        if (el.x < -1000 || el.y < -1000 || el.x > 5000 || el.y > 5000) {
          throw new AppError(`Element on ${key} is out of printable bounds.`, 400);
        }
        // Image elements must have a source URL
        if (el.type === "IMAGE" && (!el.properties || !el.properties.imageUrl)) {
          throw new AppError(`Missing asset URL in image element on ${key}.`, 400);
        }
      }
    }
  }

  /**
   * Generates production assets using the renderer, then stores them via AssetService.
   * Only generates sides that have printable elements.
   */
  public async generateProductionAssets(
    design: ICustomDesign,
    targetVersion: number
  ): Promise<IProductionAssetResult[]> {
    this.validateForProduction(design, targetVersion);

    const results: IProductionAssetResult[] = [];
    const designId = design._id.toString();

    // We derive which sides have elements from the design layout (authoritative)
    const versionData = design.versions.find(v => v.version === targetVersion);
    const layout = versionData!.design;

    const sideChecks: Array<{
      side: "FRONT" | "BACK" | "LEFT_SLEEVE" | "RIGHT_SLEEVE";
      layoutKey: keyof typeof layout;
      renderFn: () => Promise<IProductionAssetResult>;
    }> = [
      {
        side: "FRONT",
        layoutKey: "front",
        renderFn: () => this.renderer.renderFront(design, targetVersion),
      },
      {
        side: "BACK",
        layoutKey: "back",
        renderFn: () => this.renderer.renderBack(design, targetVersion),
      },
      {
        side: "LEFT_SLEEVE",
        layoutKey: "leftSleeve",
        renderFn: () => this.renderer.renderLeftSleeve(design, targetVersion),
      },
      {
        side: "RIGHT_SLEEVE",
        layoutKey: "rightSleeve",
        renderFn: () => this.renderer.renderRightSleeve(design, targetVersion),
      },
    ];

    for (const { side, layoutKey, renderFn } of sideChecks) {
      const sideData = layout[layoutKey];
      if (!sideData?.elements || sideData.elements.length === 0) continue;

      const result = await renderFn();
      results.push(result);

      // Persist the production asset record with immutability guard
      await AssetService.registerProductionAsset({
        userId: design.userId.toString(),
        designId,
        version: targetVersion,
        side: result.side,
        url: result.url,
        mimeType: result.mimeType,
        fileSize: result.fileSize,
        width: result.width,
        height: result.height,
      });
    }

    return results;
  }
}

export const productionAssetService = new ProductionAssetService();
