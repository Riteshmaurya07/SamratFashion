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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10 pb-6 border-b border-outline-variant/20">
        <div>
          <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface mb-2">My Addresses</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">Manage your saved delivery addresses for faster checkout.</p>
        </div>
        <button 
          onClick={() => handleOpenDrawer()}
          className="bg-primary text-on-primary font-headline-sm text-[16px] font-bold py-3 px-6 rounded-lg hover:bg-primary-container transition-all shadow-[0_4px_14px_rgba(37,99,235,0.2)] hover:scale-[1.02] flex items-center gap-2 whitespace-nowrap"
        >
          <Plus className="w-5 h-5" />
          Add New Address
        </button>
      </div>

      {/* Address Grid */}
      {isLoading && addresses.length === 0 ? (
        <p className="text-on-surface-variant">Loading addresses...</p>
      ) : addresses.length === 0 ? (
        <div className="text-center py-12 bg-surface-container-lowest border border-outline-variant/30 rounded-xl">
          <MapPin className="w-12 h-12 text-outline-variant mx-auto mb-4" />
          <h3 className="font-headline-sm font-semibold mb-2">No addresses saved</h3>
          <p className="text-on-surface-variant mb-6">Add an address so you can quickly checkout next time.</p>
          <button 
            onClick={() => handleOpenDrawer()}
            className="text-primary font-semibold underline underline-offset-4"
          >
            Add an address
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {addresses.map((address) => (
            <div key={address._id} className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-6 relative group hover:border-primary/50 transition-all hover:shadow-[0_12px_40px_rgba(15,23,42,0.06)] flex flex-col h-full">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <span className={`${address.addressType === 'HOME' ? 'bg-primary/10 text-primary' : 'bg-surface-variant text-on-surface-variant'} font-label-caps text-label-caps px-3 py-1 rounded-full flex items-center gap-1`}>
                    {address.addressType === 'HOME' ? <Home className="w-3.5 h-3.5" /> : address.addressType === 'WORK' ? <Briefcase className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
                    {address.addressType}
                  </span>
                  {address.isDefault && (
                    <span className="bg-tertiary-container text-on-tertiary-container font-label-caps text-label-caps px-2 py-1 rounded border border-tertiary-container/20">DEFAULT</span>
                  )}
                </div>
              </div>

              <div className="flex-grow">
                <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface mb-1">{address.fullName}</h3>
                <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed mb-4">
                  {address.addressLine1}<br/>
                  {address.addressLine2 && <>{address.addressLine2}<br/></>}
                  {address.city}, {address.state} - {address.postalCode}
                </p>
                <div className="flex items-center gap-2 text-on-surface font-body-sm">
                  <span>{address.phone}</span>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-outline-variant/20 flex gap-4 items-center">
                <button onClick={() => handleOpenDrawer(address)} className="font-headline-sm text-[14px] font-semibold text-primary hover:text-primary-container transition-colors">Edit</button>
                <span className="text-outline-variant">|</span>
                <button onClick={() => deleteAddress(address._id)} className="font-headline-sm text-[14px] font-semibold text-outline hover:text-error transition-colors">Delete</button>
                <div className="flex-grow"></div>
                {!address.isDefault && (
                  <button onClick={() => setDefaultAddress(address._id)} className="font-body-sm text-[13px] font-medium text-on-surface-variant hover:text-primary underline decoration-primary/30 underline-offset-4 transition-all">Set as Default</button>
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
          <div className="fixed top-0 right-0 h-full w-full sm:w-[480px] bg-surface shadow-[0_0_40px_rgba(15,23,42,0.15)] z-[101] flex flex-col animate-in slide-in-from-right pb-safe">
            
            <div className="px-5 sm:px-8 py-5 sm:py-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-lowest sticky top-0 z-10">
              <h2 className="font-headline-lg text-[24px] font-bold text-on-surface tracking-tight">{editingAddress ? 'Edit Address' : 'Add New Address'}</h2>
              <button onClick={handleCloseDrawer} className="text-on-surface-variant hover:text-error transition-colors p-2 rounded-full hover:bg-surface-variant/50">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-5 sm:p-8 overflow-y-auto flex-grow bg-surface">
              <form id="address-form" onSubmit={handleSubmit} className="space-y-6">
                {formError && (
                  <div className="p-3.5 rounded-xl bg-error-container text-error text-xs font-bold border border-error/20">
                    {formError}
                  </div>
                )}
                <div className="space-y-3">
                  <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">Save as</label>
                  <div className="flex gap-4">
                    {['HOME', 'WORK', 'OTHER'].map(type => (
                      <label key={type} className="relative flex cursor-pointer">
                        <input 
                          type="radio" 
                          name="addressType" 
                          value={type}
                          checked={formData.addressType === type}
                          onChange={(e) => setFormData({...formData, addressType: e.target.value as any})}
                          className="peer sr-only" 
                        />
                        <div className="px-5 py-3 rounded-lg border border-outline-variant/40 peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:text-primary text-on-surface-variant font-headline-sm text-[15px] transition-all flex items-center gap-2 bg-surface-container-lowest">
                          {type === 'HOME' ? <Home className="w-4 h-4"/> : type === 'WORK' ? <Briefcase className="w-4 h-4"/> : <MapPin className="w-4 h-4"/>}
                          {type.charAt(0) + type.slice(1).toLowerCase()}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label className="block font-label-caps text-[11px] text-on-surface-variant uppercase mb-2">Full Name</label>
                    <input 
                      required
                      value={formData.fullName}
                      onChange={(e) => setFormData({...formData, fullName: e.target.value})}
                      className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                      placeholder="Enter your full name" 
                      type="text" 
                    />
                  </div>
                  <div>
                    <label className="block font-label-caps text-[11px] text-on-surface-variant uppercase mb-2">Phone Number</label>
                    <input 
                      required
                      value={formData.phone}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                      className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                      placeholder="10-digit mobile number" 
                      type="tel" 
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block font-label-caps text-[11px] text-on-surface-variant uppercase mb-2">PIN Code</label>
                      <input 
                        required
                        value={formData.postalCode}
                        onChange={(e) => setFormData({...formData, postalCode: e.target.value})}
                        className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                        placeholder="6 digits" 
                        type="text" 
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-label-caps text-[11px] text-on-surface-variant uppercase mb-2">House / Flat / Block No.</label>
                    <input 
                      required
                      value={formData.addressLine1}
                      onChange={(e) => setFormData({...formData, addressLine1: e.target.value})}
                      className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                      placeholder="House/Flat number" 
                      type="text" 
                    />
                  </div>
                  <div>
                    <label className="block font-label-caps text-[11px] text-on-surface-variant uppercase mb-2">Street / Locality / Area</label>
                    <input 
                      value={formData.addressLine2}
                      onChange={(e) => setFormData({...formData, addressLine2: e.target.value})}
                      className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                      placeholder="Street name, Area" 
                      type="text" 
                    />
                  </div>
                  <div>
                    <label className="block font-label-caps text-[11px] text-on-surface-variant uppercase mb-2">Landmark (Optional)</label>
                    <input 
                      value={formData.landmark}
                      onChange={(e) => setFormData({...formData, landmark: e.target.value})}
                      className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                      placeholder="e.g. Near Apollo Hospital" 
                      type="text" 
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block font-label-caps text-[11px] text-on-surface-variant uppercase mb-2">City</label>
                      <input 
                        required
                        value={formData.city}
                        onChange={(e) => setFormData({...formData, city: e.target.value})}
                        className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                        placeholder="City" 
                        type="text" 
                      />
                    </div>
                    <div>
                      <label className="block font-label-caps text-[11px] text-on-surface-variant uppercase mb-2">State</label>
                      <input 
                        required
                        value={formData.state}
                        onChange={(e) => setFormData({...formData, state: e.target.value})}
                        className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                        placeholder="State" 
                        type="text" 
                      />
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-outline-variant/20">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <input 
                        checked={formData.isDefault}
                        onChange={(e) => setFormData({...formData, isDefault: e.target.checked})}
                        type="checkbox" 
                        className="w-5 h-5 border-2 border-outline-variant rounded checked:bg-primary checked:border-primary transition-colors cursor-pointer" 
                      />
                      <span className="font-body-md text-on-surface group-hover:text-primary transition-colors">Make this my default address</span>
                    </label>
                  </div>
                </div>

              </form>
            </div>

            <div className="p-6 border-t border-outline-variant/20 bg-surface-container-lowest sticky bottom-0 z-10 flex gap-4">
              <button onClick={handleCloseDrawer} type="button" className="flex-1 py-4 px-6 rounded-lg border border-outline text-on-surface font-headline-sm text-[16px] font-bold hover:bg-surface-variant transition-colors">Cancel</button>
              <button form="address-form" type="submit" disabled={isLoading} className="flex-1 py-4 px-6 rounded-lg bg-primary text-on-primary font-headline-sm text-[16px] font-bold hover:bg-primary-container transition-all shadow-[0_4px_14px_rgba(37,99,235,0.2)] hover:scale-[1.02] disabled:opacity-50">
                {isLoading ? "Saving..." : "Save Address"}
              </button>
            </div>
            
          </div>
        </>
      )}
    </div>
  );
}
