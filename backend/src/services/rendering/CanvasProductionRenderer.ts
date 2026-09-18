/**
 * CanvasProductionRenderer
 *
 * Real implementation of the ProductionRenderer interface using
 * Fabric.js 5.3.0 (server-side, non-browser build) + canvas 3.1.2.
 *
 * Compatibility verified:
 * - Fabric 5.x non-browser build works with node-canvas 3.1.2
 * - TEXT rendering requires patching canvas element with getAttribute() stub
 *   (fabric.Text calls ctx.canvas.getAttribute('dir') for RTL detection)
 * - SHAPE (Rect, Ellipse) renders without any patch
 * - IMAGE renders via fabric.Image.fromURL() with crossOrigin: 'anonymous'
 * - PNG export: createCanvas().toBuffer('image/png') (not StaticCanvas.toBuffer)
 * - renderAll() must be called before export
 *
 * Print coordinate system:
 * - Physical dimensions (inches × DPI) → output pixel dimensions
 * - Scale factors are derived (not independent) to prevent aspect ratio distortion
 * - Default: 12"×15" @ 300 DPI = 3600×4500px for FRONT/BACK
 * - Default: 4"×5" @ 300 DPI = 1200×1500px for sleeves
 *
 * Documented limitations:
 * - Custom web fonts: system fonts only (Arial, Times, etc.)
 *   Use canvas.registerFont() to add custom fonts before rendering
 * - CMYK conversion not performed (RGB only, standard for DTF printing)
 * - IMAGE elements with private/auth-gated URLs may fail silently (warning logged)
 */

import { IDesignLayout, IDesignElement } from "../../models/CustomTemplate";
import { ICustomDesign } from "../../models/CustomDesign";
import { IProductionAssetResult, ProductionRenderer } from "../productionAssetService";
import { AppError } from "../../utils/AppError";
import {
  DEFAULT_PRINT_AREAS,
  PrintAreaDimensions,
  resolvePrintDimensions,
} from "./PrintCoordinateSystem";
import { ImageService } from "../image/ImageService";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fabric } = require("fabric");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCanvas } = require("canvas");

type SideKey = "front" | "back" | "leftSleeve" | "rightSleeve";
type SideEnum = "FRONT" | "BACK" | "LEFT_SLEEVE" | "RIGHT_SLEEVE";

const SIDE_MAP: Record<SideEnum, SideKey> = {
  FRONT: "front",
  BACK: "back",
  LEFT_SLEEVE: "leftSleeve",
  RIGHT_SLEEVE: "rightSleeve",
};

/**
 * Creates a node-canvas instance patched with the minimal DOM stubs required
 * by fabric.js 5.x for server-side text rendering.
 * fabric.Text calls ctx.canvas.getAttribute('dir') for RTL detection.
 */
function createPatchedCanvas(width: number, height: number): any {
  const nc = createCanvas(width, height);
  // Add DOM stubs for fabric.js compatibility
  if (!nc.getAttribute) nc.getAttribute = (attr: string) => attr === "dir" ? "ltr" : null;
  if (!nc.setAttribute) nc.setAttribute = () => {};
  if (!nc.style) nc.style = {};

  const origGetContext = nc.getContext.bind(nc);
  nc.getContext = function (type: string, attrs?: any) {
    const ctx = origGetContext(type, attrs);
    if (ctx && ctx.canvas && !ctx.canvas.getAttribute) {
      ctx.canvas.getAttribute = (a: string) => a === "dir" ? "ltr" : null;
      ctx.canvas.setAttribute = () => {};
    }
    return ctx;
  };
  return nc;
}

export class CanvasProductionRenderer implements ProductionRenderer {
  /**
   * Render a specific side of the design and upload it.
   */
  private async renderSide(
    design: ICustomDesign,
    versionNumber: number,
    sideEnum: SideEnum
  ): Promise<IProductionAssetResult> {
    const versionData = design.versions.find((v) => v.version === versionNumber);
    if (!versionData) {
      throw new AppError(`Design version ${versionNumber} not found`, 404);
    }

    const sideKey = SIDE_MAP[sideEnum];
    const layout: IDesignLayout = versionData.design || design.getActiveLayout();
    const sideData = layout[sideKey];

    if (!sideData || !sideData.elements || sideData.elements.length === 0) {
      throw new AppError(`Side ${sideEnum} has no elements to render`, 400);
    }

    // Resolve print dimensions for this side
    const printArea: PrintAreaDimensions =
      DEFAULT_PRINT_AREAS[sideEnum] || DEFAULT_PRINT_AREAS.FRONT;
    const dims = resolvePrintDimensions(printArea);

    // Create a high-resolution node-canvas with required DOM patches
    const nc = createPatchedCanvas(dims.outputWidthPx, dims.outputHeightPx);

    // Create a Fabric StaticCanvas backed by the node-canvas
    const canvas = new fabric.StaticCanvas(nc, {
      width: dims.outputWidthPx,
      height: dims.outputHeightPx,
      enableRetinaScaling: false,
    });

    // Sort elements by zIndex ascending (lower z-index = bottom layer)
    const sortedElements = [...sideData.elements].sort(
      (a, b) => (a.zIndex || 0) - (b.zIndex || 0)
    );

    // Add each element to the canvas
    for (const el of sortedElements) {
      await this.addElementToCanvas(canvas, el, dims.scaleX, dims.scaleY);
    }

    // Render all elements and export PNG
    canvas.renderAll();
    const pngBuffer: Buffer = nc.toBuffer("image/png");

    if (!pngBuffer || pngBuffer.length < 200) {
      throw new AppError("Canvas export produced empty buffer — rendering failed", 500);
    }

    // Verify PNG header bytes
    const validPng = pngBuffer[0] === 0x89 && pngBuffer[1] === 0x50 && pngBuffer[2] === 0x4E;
    if (!validPng) {
      throw new AppError("Canvas export did not produce a valid PNG", 500);
    }

    // Upload via existing ImageService abstraction
    const uploadResult = await ImageService.getProvider().upload(pngBuffer, {
      folder: `samrat-fashion/production-assets/${design._id}`,
      tags: [
        "production",
        `design_${design._id}`,
        `version_${versionNumber}`,
        sideEnum.toLowerCase(),
      ],
      resourceType: "image",
    });

    return {
      side: sideEnum,
      url: uploadResult.secureUrl || uploadResult.url,
      width: dims.outputWidthPx,
      height: dims.outputHeightPx,
      mimeType: "image/png",
      fileSize: pngBuffer.length,
    };
  }

  /**
   * Translate an IDesignElement into a Fabric object and add it to the canvas.
   * UI coordinates are scaled by scaleX/scaleY to produce print-resolution output.
   */
  private async addElementToCanvas(
    canvas: any,
    el: IDesignElement,
    scaleX: number,
    scaleY: number
  ): Promise<void> {
    // Transform position from UI space to print space
    const left = el.x * scaleX;
    const top = el.y * scaleY;
    const width = el.width * scaleX;
    const height = el.height * scaleY;

    // Common transform properties (scaleX/Y are element-relative, already applied)
    const commonProps = {
      left,
      top,
      angle: el.rotation || 0,
      scaleX: el.scaleX || 1,
      scaleY: el.scaleY || 1,
      opacity: el.opacity ?? 1,
      originX: "left",
      originY: "top",
    };

    if (el.type === "TEXT") {
      const props = el.properties || {};
      const text = (props.text as string) || "";
      if (!text) return;

      const fabricText = new fabric.Text(text, {
        ...commonProps,
        width,
        // Scale font size from UI pixels to print pixels
        fontSize: ((props.fontSize as number) || 24) * scaleX,
        fontFamily: (props.fontFamily as string) || "Arial",
        fontWeight: (props.fontWeight as string) || "normal",
        fill: (props.color as string) || "#000000",
        textAlign: (props.alignment as string) || "left",
      });
      canvas.add(fabricText);

    } else if (el.type === "IMAGE") {
      const props = el.properties || {};
      const imageUrl = props.imageUrl as string;
      if (!imageUrl) return;

      try {
        const fabricImage = await new Promise<any>((resolve, reject) => {
          fabric.Image.fromURL(
            imageUrl,
            (img: any) => {
              if (!img) {
                reject(new Error(`Failed to load image: ${imageUrl}`));
                return;
              }
              // Scale image from UI dimensions to print dimensions
              const imgScaleX = (el.scaleX || 1) * (width / (img.width || width));
              const imgScaleY = (el.scaleY || 1) * (height / (img.height || height));
              img.set({ ...commonProps, scaleX: imgScaleX, scaleY: imgScaleY });
              resolve(img);
            },
            { crossOrigin: "anonymous" }
          );
        });
        canvas.add(fabricImage);
      } catch (imgErr: any) {
        // Log warning but don't fail the entire render for one bad image
        console.warn(`[CanvasRenderer] Skipping image (${imageUrl}): ${imgErr.message}`);
      }

    } else if (el.type === "SHAPE") {
      const props = el.properties || {};
      const shapeType = (props.shapeType as string) || "rectangle";
      const fillColor = (props.fillColor as string) || "#CCCCCC";
      const strokeColor = (props.strokeColor as string) || "";
      const strokeWidth = ((props.strokeWidth as number) || 0) * scaleX;

      if (shapeType === "circle" || shapeType === "ellipse") {
        const ellipse = new fabric.Ellipse({
          ...commonProps,
          rx: width / 2,
          ry: height / 2,
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth,
        });
        canvas.add(ellipse);
      } else {
        const rect = new fabric.Rect({
          ...commonProps,
          width,
          height,
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth,
        });
        canvas.add(rect);
      }
    }
    // Unknown element types are silently skipped (non-blocking)
  }

  async renderFront(design: ICustomDesign, version: number): Promise<IProductionAssetResult> {
    return this.renderSide(design, version, "FRONT");
  }

  async renderBack(design: ICustomDesign, version: number): Promise<IProductionAssetResult> {
    return this.renderSide(design, version, "BACK");
  }

  async renderLeftSleeve(design: ICustomDesign, version: number): Promise<IProductionAssetResult> {
    return this.renderSide(design, version, "LEFT_SLEEVE");
  }

  async renderRightSleeve(design: ICustomDesign, version: number): Promise<IProductionAssetResult> {
    return this.renderSide(design, version, "RIGHT_SLEEVE");
  }
}
