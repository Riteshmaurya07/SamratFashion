import { create } from "zustand";
import { api } from "@/lib/api";

export interface Address {
  _id: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  landmark?: string;
  addressType: 'HOME' | 'WORK' | 'OTHER';
  isDefault: boolean;
}

interface AddressState {
  addresses: Address[];
  isLoading: boolean;
  error: string | null;
  
  fetchAddresses: () => Promise<void>;
  createAddress: (address: Omit<Address, '_id' | 'isDefault'> & { isDefault?: boolean }) => Promise<void>;
  updateAddress: (id: string, address: Partial<Address>) => Promise<void>;
  deleteAddress: (id: string) => Promise<void>;
  setDefaultAddress: (id: string) => Promise<void>;
}

export const useAddressStore = create<AddressState>((set, get) => ({
  addresses: [],
  isLoading: false,
  error: null,

  fetchAddresses: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get("/addresses");
      set({ addresses: res.data.data });
    } catch (error: any) {
      if (error.response?.status !== 401) {
        set({ error: error.response?.data?.message || "Failed to load addresses" });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  createAddress: async (address) => {
    set({ isLoading: true, error: null });
    try {
      await api.post("/addresses", address);
      await get().fetchAddresses();
    } catch (error: any) {
      set({ error: error.response?.data?.message || "Failed to create address" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  updateAddress: async (id, address) => {
    set({ isLoading: true, error: null });
    try {
      await api.put(`/addresses/${id}`, address);
      await get().fetchAddresses();
    } catch (error: any) {
      set({ error: error.response?.data?.message || "Failed to update address" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteAddress: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await api.delete(`/addresses/${id}`);
      await get().fetchAddresses();
    } catch (error: any) {
      set({ error: error.response?.data?.message || "Failed to delete address" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  setDefaultAddress: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await api.patch(`/addresses/${id}/default`);
      await get().fetchAddresses();
    } catch (error: any) {
      set({ error: error.response?.data?.message || "Failed to set default address" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  }
}));
