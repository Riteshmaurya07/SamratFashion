import { create } from "zustand";
import { api } from "@/lib/api";
import { Address } from "./useAddressStore";

export interface OrderItemSnapshot {
  productId: string;
  variantId: string;
  productName: string;
  productImage: string;
  selectedSize: string;
  selectedColor: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;

  // Custom Design V2 fields
  isCustomized?: boolean;
  customDesignId?: string;
  customConfigurations?: any[];
  customizationSnapshot?: {
    previewImage?: string;
    name?: string;
    printLocations?: string[];
    customFee?: number;
  };
  designFiles?: {
    url: string;
    fileType: string;
    filename?: string;
    uploadedAt?: string;
  }[];
  customizationNotes?: string;
  mockupImages?: {
    url: string;
    uploadedAt?: string;
    uploadedBy?: string;
  }[];
  approvalStatus?: 'pending_design' | 'mockup_sent' | 'approved' | 'revision_requested' | 'in_production';
  approvalHistory?: {
    status: string;
    note?: string;
    actor?: string;
    timestamp?: string;
  }[];
}

export interface Order {
  _id: string;
  orderNumber: string;
  userId: string;
  items: OrderItemSnapshot[];
  shippingAddress: Omit<Address, '_id' | 'isDefault'>;
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
  status: 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  approvalStatus?: 'pending_design' | 'mockup_sent' | 'approved' | 'revision_requested' | 'in_production';
  refunds?: any[];
  returns?: any[];
  shipment?: any;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

interface OrderState {
  orders: Order[];
  currentOrder: Order | null;
  isLoading: boolean;
  error: string | null;
  
  fetchOrders: () => Promise<void>;
  fetchOrder: (id: string) => Promise<void>;
  createOrder: (addressId: string, idempotencyKey?: string) => Promise<Order>;
  cancelOrder: (id: string) => Promise<void>;
}

export const useOrderStore = create<OrderState>((set, get) => ({
  orders: [],
  currentOrder: null,
  isLoading: false,
  error: null,

  fetchOrders: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get("/orders");
      set({ orders: res.data.data });
    } catch (error: any) {
      if (error.response?.status !== 401) {
        set({ error: error.response?.data?.message || "Failed to load orders" });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  fetchOrder: async (id: string) => {
    const existingOrder = get().currentOrder;
    const isSameOrder = existingOrder && (existingOrder._id === id || existingOrder.orderNumber === id);
    set({ isLoading: !isSameOrder, error: null, currentOrder: isSameOrder ? existingOrder : null });
    try {
      const res = await api.get(`/orders/${id}`);
      set({ currentOrder: res.data.data, error: null });
    } catch (error: any) {
      set({ error: error.response?.data?.message || "Failed to load order" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  createOrder: async (addressId: string, idempotencyKey?: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post("/orders", { addressId, idempotencyKey });
      return res.data.data;
    } catch (error: any) {
      set({ error: error.response?.data?.message || "Failed to create order" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  cancelOrder: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post(`/orders/${id}/cancel`);
      set({ currentOrder: res.data.data });
      await get().fetchOrders();
    } catch (error: any) {
      set({ error: error.response?.data?.message || "Failed to cancel order" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  }
}));
