import { create } from "zustand";

export interface DesignElement {
  id: string;
  type: "TEXT" | "IMAGE" | "SHAPE" | "LOGO";
  side: "FRONT" | "BACK";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  zIndex: number;
  opacity: number;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  color?: string;
  alignment?: "left" | "center" | "right";
  imageUrl?: string;
  shapeType?: "RECTANGLE" | "CIRCLE" | "STAR" | "LINE";
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

interface CustomDesignState {
  designId?: string;
  designName: string;
  productId: string;
  selectedVariantId: string;
  selectedColor: string;
  selectedSize: string;
  canvasSide: "FRONT" | "BACK";
  elements: DesignElement[];
  selectedElementId: string | null;
  previewImage: { front?: string; back?: string };
  isSaving: boolean;

  // Actions
  setDesignName: (name: string) => void;
  setBaseProduct: (productId: string, variantId: string, color: string, size: string) => void;
  setCanvasSide: (side: "FRONT" | "BACK") => void;
  setSelectedElementId: (id: string | null) => void;
  addElement: (element: Omit<DesignElement, "id" | "side" | "x" | "y" | "zIndex">) => void;
  updateElement: (id: string, updates: Partial<DesignElement>) => void;
  removeElement: (id: string) => void;
  loadDesign: (design: any) => void;
  resetDesign: () => void;
}

export const useCustomDesignStore = create<CustomDesignState>((set, get) => ({
  designId: undefined,
  designName: "My Custom Oversized Tee",
  productId: "",
  selectedVariantId: "",
  selectedColor: "Black",
  selectedSize: "L",
  canvasSide: "FRONT",
  elements: [],
  selectedElementId: null,
  previewImage: {},
  isSaving: false,

  setDesignName: (name) => set({ designName: name }),

  setBaseProduct: (productId, selectedVariantId, selectedColor, selectedSize) =>
    set({ productId, selectedVariantId, selectedColor, selectedSize }),

  setCanvasSide: (canvasSide) => set({ canvasSide, selectedElementId: null }),

  setSelectedElementId: (selectedElementId) => set({ selectedElementId }),

  addElement: (elementData) => {
    const { canvasSide, elements } = get();
    const newElement: DesignElement = {
      ...elementData,
      id: "elem_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
      side: canvasSide,
      x: 180,
      y: 180,
      zIndex: elements.length + 1,
      rotation: elementData.rotation ?? 0,
      scale: elementData.scale ?? 1,
      opacity: elementData.opacity ?? 1,
      width: elementData.width ?? 180,
      height: elementData.height ?? 180,
    };
    set({ elements: [...elements, newElement], selectedElementId: newElement.id });
  },

  updateElement: (id, updates) => {
    set((state) => ({
      elements: state.elements.map((el) => (el.id === id ? { ...el, ...updates } : el)),
    }));
  },

  removeElement: (id) => {
    set((state) => ({
      elements: state.elements.filter((el) => el.id !== id),
      selectedElementId: state.selectedElementId === id ? null : state.selectedElementId,
    }));
  },

  loadDesign: (design) => {
    set({
      designId: design._id,
      designName: design.name || "My Custom Tee",
      productId: typeof design.productId === "object" ? design.productId._id : design.productId,
      selectedVariantId: design.selectedVariantId,
      selectedColor: design.selectedColor || "Black",
      selectedSize: design.selectedSize || "L",
      elements: design.elements || [],
      previewImage: design.previewImage || {},
    });
  },

  resetDesign: () => {
    set({
      designId: undefined,
      designName: "My Custom Oversized Tee",
      elements: [],
      selectedElementId: null,
      previewImage: {},
    });
  },
}));
