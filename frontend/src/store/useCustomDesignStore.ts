import { create } from 'zustand';

export interface IDesignElement {
  id: string;
  type: "TEXT" | "IMAGE" | "SHAPE";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  locked: boolean;
  zIndex: number;
  properties: Record<string, any>;
}

export interface IDesignLayout {
  front: { elements: IDesignElement[] };
  back: { elements: IDesignElement[] };
  leftSleeve: { elements: IDesignElement[] };
  rightSleeve: { elements: IDesignElement[] };
}

export type DesignZone = keyof IDesignLayout;

export interface ISizeDistribution {
  size: string;
  quantity: number;
}

export interface IPricingSnapshot {
  basePrice: number;
  variantPrice: number;
  printCharges: number;
  bulkDiscount: number;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
}

interface CustomDesignState {
  // Metadata
  designId?: string;
  productId?: string;
  variantId?: string;
  currentVersion?: number;
  
  // Editor State
  activeZone: DesignZone;
  selectedElementId: string | null;
  activeConfigIndex: number;
  
  // Core Business Data
  design: IDesignLayout;
  
  // Configurations (Multi-Color/Variant)
  configurations: {
    color: string;
    variantId?: string;
    sizes: ISizeDistribution[];
  }[];

  pricing: IPricingSnapshot | null;
  isCalculatingPrice: boolean;
  isSaving: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  
  // History (Undo/Redo)
  history: IDesignLayout[];
  historyIndex: number;

  // Actions
  setActiveZone: (zone: DesignZone) => void;
  selectElement: (id: string | null) => void;
  
  // Elements
  addElement: (element: IDesignElement) => void;
  updateElement: (id: string, updates: Partial<IDesignElement>) => void;
  removeElement: (id: string) => void;
  
  // Sizes & Pricing
  addConfiguration: (color: string) => void;
  setActiveConfiguration: (index: number) => void;
  updateSizeQuantity: (configIndex: number, size: string, quantity: number) => void;
  fetchPricing: () => Promise<void>;
  
  // Loading/Saving
  setBaseProduct: (productId: string, variantId: string, color?: string, size?: string) => void;
  loadDesign: (design: IDesignLayout, metadata?: any) => void;
  saveDesign: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  pushHistory: () => void; // Call this *after* a debounced meaningful change
}

const emptyDesign: IDesignLayout = {
  front: { elements: [] },
  back: { elements: [] },
  leftSleeve: { elements: [] },
  rightSleeve: { elements: [] }
};

export const useCustomDesignStore = create<CustomDesignState>((set, get) => ({
  activeZone: 'front',
  selectedElementId: null,
  activeConfigIndex: 0,
  design: emptyDesign,
  configurations: [
    {
      color: '#ffffff',
      sizes: [
        { size: 'S', quantity: 0 },
        { size: 'M', quantity: 0 },
        { size: 'L', quantity: 0 },
        { size: 'XL', quantity: 0 },
      ]
    }
  ],
  pricing: null,
  isCalculatingPrice: false,
  isSaving: false,
  saveStatus: 'idle',
  
  history: [emptyDesign],
  historyIndex: 0,

  setActiveZone: (zone) => set({ activeZone: zone, selectedElementId: null }),
  
  selectElement: (id) => set({ selectedElementId: id }),

  pushHistory: () => {
    const { design, history, historyIndex } = get();
    // Slice history to remove future states if we are undoing and then branching
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(design))); // deep copy
    
    // Cap history length to avoid memory leaks
    if (newHistory.length > 50) newHistory.shift();
    
    set({
      history: newHistory,
      historyIndex: newHistory.length - 1
    });
  },

  addElement: (element) => {
    const { activeZone, design, pushHistory } = get();
    const newDesign = JSON.parse(JSON.stringify(design)) as IDesignLayout;
    newDesign[activeZone].elements.push(element);
    set({ design: newDesign, selectedElementId: element.id });
    pushHistory();
  },

  updateElement: (id, updates) => {
    const { activeZone, design } = get();
    const newDesign = JSON.parse(JSON.stringify(design)) as IDesignLayout;
    const element = newDesign[activeZone].elements.find(e => e.id === id);
    if (element) {
      Object.assign(element, updates);
      set({ design: newDesign });
      // We DO NOT call pushHistory here automatically because updates can be high-frequency (dragging).
      // pushHistory must be called from the component on 'drag-end' or 'modify-end'.
    }
  },

  removeElement: (id) => {
    const { activeZone, design, pushHistory } = get();
    const newDesign = JSON.parse(JSON.stringify(design)) as IDesignLayout;
    newDesign[activeZone].elements = newDesign[activeZone].elements.filter(e => e.id !== id);
    set({ design: newDesign, selectedElementId: null });
    pushHistory();
  },

  setBaseProduct: (productId, variantId, color = 'Black', size = 'L') => {
    const { configurations } = get();
    const updatedConfigs = configurations.length > 0 
      ? configurations.map((c, i) => i === 0 ? { ...c, color, variantId } : c)
      : [{ color, variantId, sizes: [{ size: 'S', quantity: 0 }, { size: 'M', quantity: 0 }, { size: 'L', quantity: 0 }, { size: 'XL', quantity: 0 }] }];
    set({
      productId,
      variantId,
      configurations: updatedConfigs
    });
  },

  loadDesign: (loadedDesign, metadata) => {
    set({
      design: loadedDesign,
      history: [JSON.parse(JSON.stringify(loadedDesign))],
      historyIndex: 0,
      activeZone: 'front',
      selectedElementId: null,
      ...metadata
    });
  },

  addConfiguration: (color) => {
    const { configurations } = get();
    set({
      configurations: [...configurations, {
        color,
        sizes: [
          { size: 'S', quantity: 0 },
          { size: 'M', quantity: 0 },
          { size: 'L', quantity: 0 },
          { size: 'XL', quantity: 0 },
        ]
      }],
      activeConfigIndex: configurations.length
    });
  },

  setActiveConfiguration: (index) => set({ activeConfigIndex: index }),

  updateSizeQuantity: (configIndex, size, quantity) => {
    const configurations = [...get().configurations];
    const targetConfig = configurations[configIndex];
    if (!targetConfig) return;

    const targetSize = targetConfig.sizes.find(s => s.size === size);
    if (targetSize) {
      targetSize.quantity = Math.max(0, quantity);
    } else {
      targetConfig.sizes.push({ size, quantity: Math.max(0, quantity) });
    }
    set({ configurations });
  },

  fetchPricing: async () => {
    const { productId, variantId, designId, configurations } = get();
    
    // Check if any config has > 0 quantity
    const hasQuantities = configurations.some(c => c.sizes.some(s => s.quantity > 0));
    
    if (!productId || !variantId || !hasQuantities) return;

    set({ isCalculatingPrice: true });
    try {
      const customConfigsPayload = configurations
        .filter(c => c.sizes.some(s => s.quantity > 0))
        .map(c => ({
          color: c.color,
          variantId: c.variantId || variantId, // fallback to base variantId
          designId,
          sizeDistribution: c.sizes.filter(s => s.quantity > 0)
        }));

      const response = await fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          quantity: 1, // Base level is overridden by custom config
          isCustomized: true,
          customConfigurations: customConfigsPayload
        })
      });
      const data = await response.json();
      if (data.success) {
        set({ pricing: data.data });
      }
    } catch (e) {
      console.error("Failed to fetch pricing", e);
    } finally {
      set({ isCalculatingPrice: false });
    }
  },

  saveDesign: async () => {
    const { designId, productId, variantId, configurations, design } = get();
    if (!productId || !variantId) return;

    // Use the color from the first configuration as the primary display color
    const primaryColor = configurations[0]?.color || '#ffffff';

    set({ isSaving: true, saveStatus: 'saving' });
    try {
      const payload = {
        name: "My Custom Design",
        productId,
        selectedVariantId: variantId,
        selectedColor: primaryColor,
        design,
      };

      const url = designId ? `/api/designs/${designId}` : '/api/designs';
      const method = designId ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (response.status === 409) {
        set({ saveStatus: 'error' });
        alert("A newer version of this design exists on the server. Please refresh.");
        return;
      }
      
      const data = await response.json();
      if (data.success) {
        set({ 
          designId: data.data._id, 
          currentVersion: data.data.currentVersion,
          saveStatus: 'saved' 
        });
        setTimeout(() => set({ saveStatus: 'idle' }), 3000);
      }
    } catch (e) {
      console.error("Failed to save design", e);
      set({ saveStatus: 'error' });
    } finally {
      set({ isSaving: false });
    }
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      set({
        historyIndex: historyIndex - 1,
        design: JSON.parse(JSON.stringify(history[historyIndex - 1])),
        selectedElementId: null
      });
    }
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      set({
        historyIndex: historyIndex + 1,
        design: JSON.parse(JSON.stringify(history[historyIndex + 1])),
        selectedElementId: null
      });
    }
  }
}));
