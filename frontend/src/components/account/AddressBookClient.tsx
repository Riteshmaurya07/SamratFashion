"use client";

import { useAddressStore, Address } from "@/store/useAddressStore";
import { useEffect, useState } from "react";
import { Plus, Home, Briefcase, MapPin, X } from "lucide-react";

export function AddressBookClient() {
  const { addresses, fetchAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress, isLoading } = useAddressStore();
  
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [formError, setFormError] = useState("");
  const [formData, setFormData] = useState({
    fullName: "",
    phone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "India",
    landmark: "",
    addressType: "HOME" as "HOME" | "WORK" | "OTHER",
    isDefault: false
  });

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  const handleOpenDrawer = (address?: Address) => {
    if (address) {
      setEditingAddress(address);
      setFormData({
        fullName: address.fullName,
        phone: address.phone,
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2 || "",
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
        landmark: address.landmark || "",
        addressType: address.addressType,
        isDefault: address.isDefault
      });
    } else {
      setEditingAddress(null);
      setFormData({
        fullName: "",
        phone: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "India",
        landmark: "",
        addressType: "HOME",
        isDefault: false
      });
    }
    setFormError("");
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (
      !formData.fullName.trim() ||
      !formData.phone.trim() ||
      !formData.addressLine1.trim() ||
      !formData.city.trim() ||
      !formData.state.trim() ||
      !formData.postalCode.trim()
    ) {
      setFormError("Please fill out all required fields: Full Name, Phone, Address, City, State, and PIN Code.");
      return;
    }

    try {
      const payload = {
        ...formData,
        fullName: formData.fullName.trim(),
        phone: formData.phone.trim(),
        addressLine1: formData.addressLine1.trim(),
        addressLine2: formData.addressLine2.trim() || undefined,
        city: formData.city.trim(),
        state: formData.state.trim(),
        postalCode: formData.postalCode.trim(),
        landmark: formData.landmark.trim() || undefined,
      };

      if (editingAddress) {
        await updateAddress(editingAddress._id, payload);
      } else {
        await createAddress(payload);
      }
      handleCloseDrawer();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setFormError(e.response?.data?.message || "Failed to save address. Please check required fields.");
    }
  };

  return (
    <div className="flex-grow flex flex-col w-full max-w-4xl pb-28 lg:pb-0">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8 pb-5 border-b border-outline-variant/30">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight mb-1.5">SAVED ADDRESSES</h1>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant">Manage your delivery locations for faster express checkout.</p>
        </div>
        <button 
          onClick={() => handleOpenDrawer()}
          className="bg-neutral-950 text-white font-mono text-xs uppercase font-bold py-3 px-5 rounded-lg hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2 w-full sm:w-auto shadow-sm min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Address</span>
        </button>
      </div>

      {/* Address Grid */}
      {isLoading && addresses.length === 0 ? (
        <p className="text-on-surface-variant font-mono text-xs">Loading addresses...</p>
      ) : addresses.length === 0 ? (
        <div className="text-center py-12 bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-6">
          <MapPin className="w-12 h-12 text-outline-variant mx-auto mb-4" />
          <h3 className="font-headline-sm text-base font-bold text-on-surface mb-2">No addresses saved yet</h3>
          <p className="text-on-surface-variant text-xs sm:text-sm mb-6 max-w-sm mx-auto">Add your home or work address for one-click express checkout.</p>
          <button 
            onClick={() => handleOpenDrawer()}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-neutral-900 text-white font-mono text-xs uppercase font-bold rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Your First Address</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {addresses.map((address) => (
            <div key={address._id} className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 sm:p-5 relative group hover:border-neutral-900 transition-all flex flex-col justify-between streetwear-card">
              <div>
                <div className="flex justify-between items-center mb-3">
                  <span className="bg-surface-container-high text-on-surface font-mono text-[11px] font-bold uppercase px-2.5 py-1 rounded-md flex items-center gap-1.5">
                    {address.addressType === 'HOME' ? <Home className="w-3.5 h-3.5" /> : address.addressType === 'WORK' ? <Briefcase className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
                    {address.addressType}
                  </span>
                  {address.isDefault && (
                    <span className="bg-neutral-900 text-white font-mono text-[9px] uppercase px-2 py-0.5 rounded font-bold tracking-wider">
                      DEFAULT
                    </span>
                  )}
                </div>

                <h3 className="font-headline-sm text-base sm:text-lg font-bold text-on-surface mb-1">{address.fullName}</h3>
                <p className="font-body-md text-xs sm:text-sm text-on-surface-variant leading-relaxed mb-3">
                  {address.addressLine1}
                  {address.addressLine2 && <><br />{address.addressLine2}</>}
                  <br />
                  {address.city}, {address.state} - <span className="font-mono font-medium">{address.postalCode}</span>
                </p>
                <div className="flex items-center gap-2 text-on-surface font-mono text-xs text-neutral-600">
                  <span>+91 {address.phone}</span>
                </div>
              </div>

              <div className="mt-5 pt-3.5 border-t border-outline-variant/20 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenDrawer(address)}
                    className="px-3 py-1.5 rounded-md border border-outline-variant/50 hover:bg-surface-container text-xs font-mono font-bold text-on-surface transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteAddress(address._id)}
                    className="px-3 py-1.5 rounded-md border border-outline-variant/50 hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-xs font-mono font-bold text-neutral-500 transition-colors"
                  >
                    Delete
                  </button>
                </div>
                {!address.isDefault && (
                  <button
                    onClick={() => setDefaultAddress(address._id)}
                    className="text-xs font-mono font-bold text-neutral-800 hover:underline uppercase transition-all py-1"
                  >
                    Set as Default
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Side Drawer Modal */}
      {isDrawerOpen && (
        <>
          <div className="fixed inset-0 bg-on-background/40 backdrop-blur-sm z-[100] transition-opacity" onClick={handleCloseDrawer} />
          <div className="fixed top-0 right-0 h-full w-full sm:w-[480px] bg-surface-container-lowest shadow-2xl z-[101] flex flex-col pb-safe">
            <div className="px-5 sm:px-6 py-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-lowest sticky top-0 z-10">
              <h2 className="font-headline-lg text-lg sm:text-xl font-black text-on-surface tracking-tight uppercase">
                {editingAddress ? 'Edit Address' : 'Add New Address'}
              </h2>
              <button onClick={handleCloseDrawer} className="text-on-surface-variant hover:text-on-surface p-2 rounded-lg hover:bg-surface-container-low transition-colors touch-target-base flex items-center justify-center">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto flex-grow bg-surface-container-lowest">
              <form id="address-form" onSubmit={handleSubmit} className="space-y-5">
                {formError && (
                  <div className="p-3.5 rounded-lg bg-red-50 text-red-700 text-xs font-mono font-bold border border-red-200">
                    {formError}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold">Address Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['HOME', 'WORK', 'OTHER'] as const).map(type => (
                      <label key={type} className="relative flex cursor-pointer">
                        <input 
                          type="radio" 
                          name="addressType" 
                          value={type}
                          checked={formData.addressType === type}
                          onChange={(e) => setFormData({...formData, addressType: e.target.value as "HOME" | "WORK" | "OTHER"})}
                          className="peer sr-only" 
                        />
                        <div className="w-full py-2.5 px-2 rounded-lg border border-outline-variant/40 peer-checked:border-neutral-950 peer-checked:bg-neutral-950 peer-checked:text-white text-on-surface-variant font-mono text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 bg-surface-container-low">
                          {type === 'HOME' ? <Home className="w-3.5 h-3.5"/> : type === 'WORK' ? <Briefcase className="w-3.5 h-3.5"/> : <MapPin className="w-3.5 h-3.5"/>}
                          <span>{type}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1.5">Full Name *</label>
                    <input 
                      required
                       value={formData.fullName}
                       onChange={(e) => setFormData({...formData, fullName: e.target.value})}
                      className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 transition-colors" 
                       placeholder="Enter your full name" 
                       type="text" 
                     />
                   </div>
                   <div>
                    <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1.5">Phone Number *</label>
                     <input 
                       required
                       value={formData.phone}
                       onChange={(e) => setFormData({...formData, phone: e.target.value})}
                      className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 transition-colors font-mono" 
                       placeholder="10-digit mobile number" 
                       type="tel" 
                     />
                   </div>
                  <div className="grid grid-cols-2 gap-3">
                     <div>
                      <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1.5">PIN Code *</label>
                       <input 
                         required
                         value={formData.postalCode}
                         onChange={(e) => setFormData({...formData, postalCode: e.target.value})}
                        className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 transition-colors font-mono" 
                         placeholder="6 digits" 
                         type="text" 
                       />
                     </div>
                    <div>
                      <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1.5">City *</label>
                      <input 
                        required
                        value={formData.city}
                        onChange={(e) => setFormData({...formData, city: e.target.value})}
                        className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 transition-colors" 
                        placeholder="City" 
                        type="text" 
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1.5">House / Flat / Building *</label>
                     <input 
                       required
                       value={formData.addressLine1}
                       onChange={(e) => setFormData({...formData, addressLine1: e.target.value})}
                      className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 transition-colors" 
                      placeholder="House / Flat / Building number" 
                       type="text" 
                     />
                   </div>
                   <div>
                    <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1.5">Street / Locality / Area</label>
                     <input 
                       value={formData.addressLine2}
                       onChange={(e) => setFormData({...formData, addressLine2: e.target.value})}
                      className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 transition-colors" 
                       placeholder="Street name, Area" 
                       type="text" 
                     />
                   </div>
                  <div className="grid grid-cols-2 gap-3">
                     <div>
                      <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1.5">Landmark</label>
                       <input 
                        value={formData.landmark}
                        onChange={(e) => setFormData({...formData, landmark: e.target.value})}
                        className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 transition-colors" 
                        placeholder="e.g. Near Metro" 
                         type="text" 
                       />
                     </div>
                     <div>
                      <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1.5">State *</label>
                       <input 
                         required
                         value={formData.state}
                         onChange={(e) => setFormData({...formData, state: e.target.value})}
                        className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 transition-colors" 
                         placeholder="State" 
                         type="text" 
                       />
                     </div>
                   </div>
 
                  <div className="pt-2">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                       <input 
                         checked={formData.isDefault}
                         onChange={(e) => setFormData({...formData, isDefault: e.target.checked})}
                         type="checkbox" 
                        className="w-4 h-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 cursor-pointer" 
                       />
                      <span className="font-mono text-xs text-on-surface font-medium">Make this my default delivery address</span>
                     </label>
                   </div>
                 </div>
               </form>
             </div>
 
            <div className="p-4 sm:p-5 border-t border-outline-variant/20 bg-surface-container-lowest sticky bottom-0 z-10 flex gap-3 pb-safe">
              <button
                onClick={handleCloseDrawer}
                type="button"
                className="flex-1 py-3 px-4 rounded-lg border border-outline-variant/60 text-on-surface font-mono text-xs uppercase font-bold hover:bg-surface-container-low transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                form="address-form"
                type="submit"
                disabled={isLoading}
                className="flex-1 py-3 px-4 rounded-lg bg-neutral-950 text-white font-mono text-xs uppercase font-bold hover:bg-neutral-800 transition-colors disabled:opacity-50 min-h-[44px]"
              >
                 {isLoading ? "Saving..." : "Save Address"}
               </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
