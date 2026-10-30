"use client";

import { useAddressStore, Address } from "@/store/useAddressStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus,
  Home,
  Briefcase,
  MapPin,
  X,
  Pencil,
  Trash2,
  CheckCircle2,
  Phone,
  User,
  AlertCircle,
  Loader2,
  Check,
  ChevronRight,
  Package,
  Heart,
  Star,
  FileText,
  LayoutDashboard,
  ShieldAlert,
  Compass,
} from "lucide-react";

const ACCOUNT_TABS = [
  { label: "Overview", href: "/account", icon: LayoutDashboard },
  { label: "Orders", href: "/account/orders", icon: Package },
  { label: "Addresses", href: "/account/addresses", icon: MapPin, active: true },
  { label: "Wishlist", href: "/account/wishlist", icon: Heart },
  { label: "Reviews", href: "/account/reviews", icon: Star },
  { label: "Bulk Quotes", href: "/account/bulk-orders", icon: FileText },
];

export function AddressBookClient() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();
  const {
    addresses,
    fetchAddresses,
    createAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
    isLoading,
  } = useAddressStore();

  // Drawer & Edit Modal State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);

  // Card Action States
  const [addressToDelete, setAddressToDelete] = useState<Address | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Feedback Toast State
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Form State & Validation
  const [formError, setFormError] = useState("");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
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
    isDefault: false,
  });

  const fullNameInputRef = useRef<HTMLInputElement>(null);

  // Authentication Guard
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login?redirect=/account/addresses");
    }
  }, [authLoading, isAuthenticated, router]);

  // Initial Fetch
  useEffect(() => {
    if (isAuthenticated) {
      fetchAddresses();
    }
  }, [isAuthenticated, fetchAddresses]);

  // Toast Auto-Dismiss
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Lock Body Scroll & Keyboard Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (addressToDelete) {
          setAddressToDelete(null);
        } else if (isDrawerOpen) {
          handleCloseDrawer();
        }
      }
    };

    if (isDrawerOpen || addressToDelete) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDrawerOpen, addressToDelete]);

  // Focus on first input when drawer opens
  useEffect(() => {
    if (isDrawerOpen) {
      const timeout = setTimeout(() => {
        fullNameInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [isDrawerOpen]);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
  }, []);

  const handleOpenDrawer = (address?: Address) => {
    setFormError("");
    setValidationErrors({});
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
        country: address.country || "India",
        landmark: address.landmark || "",
        addressType: address.addressType,
        isDefault: address.isDefault,
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
        isDefault: addresses.length === 0,
      });
    }
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setEditingAddress(null);
    setFormError("");
    setValidationErrors({});
  };

  // Validation Check
  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.fullName.trim()) {
      errors.fullName = "Full name is required";
    } else if (formData.fullName.trim().length < 2) {
      errors.fullName = "Name must be at least 2 characters";
    }

    const cleanPhone = formData.phone.trim().replace(/\D/g, "");
    if (!cleanPhone) {
      errors.phone = "Mobile number is required";
    } else if (cleanPhone.length !== 10) {
      errors.phone = "Enter a valid 10-digit mobile number";
    }

    const cleanPin = formData.postalCode.trim().replace(/\D/g, "");
    if (!cleanPin) {
      errors.postalCode = "PIN code is required";
    } else if (cleanPin.length !== 6) {
      errors.postalCode = "PIN code must be exactly 6 digits";
    }

    if (!formData.addressLine1.trim()) {
      errors.addressLine1 = "Building, house number or flat is required";
    }

    if (!formData.city.trim()) {
      errors.city = "City is required";
    }

    if (!formData.state.trim()) {
      errors.state = "State is required";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!validateForm()) {
      setFormError("Please correct the errors in the form before saving.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        fullName: formData.fullName.trim(),
        phone: formData.phone.trim().replace(/\D/g, ""),
        addressLine1: formData.addressLine1.trim(),
        addressLine2: formData.addressLine2.trim() || undefined,
        city: formData.city.trim(),
        state: formData.state.trim(),
        postalCode: formData.postalCode.trim().replace(/\D/g, ""),
        country: "India",
        landmark: formData.landmark.trim() || undefined,
        addressType: formData.addressType,
        isDefault: formData.isDefault,
      };

      if (editingAddress) {
        await updateAddress(editingAddress._id, payload);
        showToast("success", "Address details updated successfully.");
      } else {
        await createAddress(payload);
        showToast("success", "New delivery address added to your account.");
      }
      handleCloseDrawer();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setFormError(
        e.response?.data?.message ||
          "Failed to save address. Please verify required fields and try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!addressToDelete) return;
    const targetId = addressToDelete._id;
    const targetName = addressToDelete.fullName;
    setDeletingId(targetId);
    try {
      await deleteAddress(targetId);
      showToast("success", `Address for ${targetName} deleted.`);
      setAddressToDelete(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      showToast(
        "error",
        e.response?.data?.message || "Failed to delete address. Please try again."
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (address: Address) => {
    setSettingDefaultId(address._id);
    try {
      await setDefaultAddress(address._id);
      showToast("success", `Set as default delivery address.`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      showToast(
        "error",
        e.response?.data?.message || "Failed to set default address."
      );
    } finally {
      setSettingDefaultId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="w-full py-20 flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 text-neutral-900 animate-spin mb-3" />
        <p className="font-mono text-xs uppercase tracking-wider text-neutral-500 font-semibold">
          Authenticating account session...
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col pb-24 lg:pb-8">
      {/* Toast Feedback Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="fixed top-20 right-4 sm:right-8 z-[130] max-w-md w-[calc(100%-2rem)]"
          >
            <div
              className={`p-4 rounded-xl shadow-lg border backdrop-blur-md flex items-start gap-3 ${
                toast.type === "success"
                  ? "bg-neutral-950 text-white border-neutral-800"
                  : "bg-red-950 text-red-50 border-red-800"
              }`}
            >
              {toast.type === "success" ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-mono text-xs uppercase tracking-wider font-bold mb-0.5">
                  {toast.type === "success" ? "System Notification" : "Action Error"}
                </p>
                <p className="font-body-md text-xs sm:text-sm leading-snug">
                  {toast.message}
                </p>
              </div>
              <button
                onClick={() => setToast(null)}
                className="text-neutral-400 hover:text-white p-1 rounded transition-colors"
                aria-label="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Breadcrumb Hierarchy */}
      <nav
        aria-label="Breadcrumbs"
        className="flex items-center gap-2 text-xs font-mono text-neutral-500 uppercase tracking-wider mb-4 sm:mb-6"
      >
        <Link href="/" className="hover:text-neutral-900 transition-colors">
          Home
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
        <Link href="/account" className="hover:text-neutral-900 transition-colors">
          Account
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
        <span className="text-neutral-950 font-bold">Addresses</span>
      </nav>

      {/* Account Navigation Tabs */}
      <div className="mb-6 sm:mb-8 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex items-center gap-1.5 sm:gap-2 pb-1 border-b border-outline-variant/40 min-w-max">
          {ACCOUNT_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.active;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg font-mono text-xs font-bold uppercase tracking-wider transition-all min-h-[40px] ${
                  isActive
                    ? "bg-neutral-950 text-white shadow-sm"
                    : "text-neutral-600 hover:text-neutral-950 hover:bg-surface-container-low"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {isActive && addresses.length > 0 && (
                  <span className="bg-white/20 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                    {addresses.length}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8 pb-6 border-b border-outline-variant/40">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <h1 className="font-headline-lg text-2xl sm:text-3xl lg:text-4xl font-black text-on-surface uppercase tracking-tight">
              SAVED ADDRESSES
            </h1>
            {!isLoading && (
              <span className="bg-surface-container-high text-on-surface font-mono text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-md">
                {addresses.length} {addresses.length === 1 ? "Location" : "Locations"}
              </span>
            )}
          </div>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant max-w-xl leading-relaxed">
            Manage your delivery destinations, configure default express shipping coordinates, and ensure smooth delivery across all drop dispatches.
          </p>
        </div>

        <button
          onClick={() => handleOpenDrawer()}
          className="bg-neutral-950 text-white hover:bg-neutral-800 font-mono text-xs uppercase tracking-wider font-bold py-3 px-5 rounded-lg transition-all flex items-center justify-center gap-2 w-full sm:w-auto shadow-sm active:scale-[0.99] min-h-[44px] shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Address</span>
        </button>
      </div>

      {/* Main Content: Loading, Empty, or Address Grid */}
      {isLoading && addresses.length === 0 ? (
        /* Skeleton Loading Cards */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-5 sm:p-6 animate-pulse flex flex-col justify-between h-[260px]"
            >
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <div className="h-5 w-16 bg-surface-container-high rounded-md"></div>
                  <div className="h-4 w-14 bg-surface-container-high rounded"></div>
                </div>
                <div className="h-6 w-3/4 bg-surface-container-high rounded mt-2"></div>
                <div className="h-4 w-full bg-surface-container-low rounded"></div>
                <div className="h-4 w-2/3 bg-surface-container-low rounded"></div>
                <div className="h-4 w-1/2 bg-surface-container-low rounded"></div>
              </div>
              <div className="pt-4 border-t border-outline-variant/20 flex justify-between">
                <div className="h-7 w-20 bg-surface-container-high rounded"></div>
                <div className="h-7 w-24 bg-surface-container-low rounded"></div>
              </div>
            </div>
          ))}
        </div>
      ) : addresses.length === 0 ? (
        /* Empty State */
        <div className="text-center py-16 px-6 bg-surface-container-lowest border border-outline-variant/40 rounded-2xl max-w-xl mx-auto shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-surface-container-low text-neutral-800 flex items-center justify-center mx-auto mb-5 border border-outline-variant/40">
            <Compass className="w-8 h-8 text-neutral-700 stroke-[1.5]" />
          </div>
          <h2 className="font-headline-sm text-xl font-bold text-on-surface uppercase tracking-tight mb-2">
            No Addresses Saved Yet
          </h2>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant mb-6 max-w-sm mx-auto leading-relaxed">
            Add your primary residence, workplace, or design studio for fast 1-click express checkout across all limited streetwear drops.
          </p>
          <button
            onClick={() => handleOpenDrawer()}
            className="inline-flex items-center gap-2 px-6 py-3 bg-neutral-950 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg hover:bg-neutral-800 transition-all shadow-sm active:scale-98 min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>Add Your First Address</span>
          </button>
        </div>
      ) : (
        /* Address Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {addresses.map((address) => {
            const isDefault = address.isDefault;
            const isDeleting = deletingId === address._id;
            const isSettingDefault = settingDefaultId === address._id;

            return (
              <div
                key={address._id}
                className={`rounded-2xl p-5 sm:p-6 relative flex flex-col justify-between transition-all duration-200 streetwear-card ${
                  isDefault
                    ? "bg-surface-container-lowest border-2 border-neutral-950 shadow-sm"
                    : "bg-surface-container-lowest border border-outline-variant/60 hover:border-neutral-400 hover:shadow-sm"
                }`}
              >
                <div>
                  {/* Card Header: Type Badge & Default Badge */}
                  <div className="flex justify-between items-center gap-2 mb-4">
                    <span className="bg-surface-container-high text-on-surface font-mono text-[11px] font-bold uppercase px-2.5 py-1 rounded-md flex items-center gap-1.5 tracking-wider">
                      {address.addressType === "HOME" ? (
                        <Home className="w-3.5 h-3.5" />
                      ) : address.addressType === "WORK" ? (
                        <Briefcase className="w-3.5 h-3.5" />
                      ) : (
                        <MapPin className="w-3.5 h-3.5" />
                      )}
                      <span>{address.addressType}</span>
                    </span>

                    {isDefault ? (
                      <span className="bg-neutral-950 text-white font-mono text-[10px] uppercase px-2.5 py-1 rounded-md font-bold tracking-wider flex items-center gap-1 shadow-xs">
                        <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
                        <span>DEFAULT</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono text-neutral-400 font-medium">
                        SECONDARY
                      </span>
                    )}
                  </div>

                  {/* Recipient Details */}
                  <div className="mb-3">
                    <h2 className="font-headline-sm text-lg font-bold text-on-surface tracking-tight mb-1">
                      {address.fullName}
                    </h2>
                    <div className="font-body-md text-xs sm:text-sm text-on-surface leading-relaxed space-y-1">
                      <p className="font-medium text-neutral-800">
                        {address.addressLine1}
                      </p>
                      {address.addressLine2 && (
                        <p className="text-on-surface-variant">
                          {address.addressLine2}
                        </p>
                      )}
                      {address.landmark && (
                        <p className="text-xs text-neutral-500 flex items-center gap-1 pt-0.5">
                          <MapPin className="w-3 h-3 text-neutral-400 shrink-0" />
                          <span>
                            {address.landmark.toLowerCase().startsWith("near")
                              ? address.landmark
                              : `Near ${address.landmark}`}
                          </span>
                        </p>
                      )}
                      <p className="text-neutral-900 font-medium pt-1">
                        {address.city}, {address.state}{" "}
                        <span className="font-mono font-bold bg-surface-container-high px-1.5 py-0.5 rounded text-xs ml-1 text-neutral-950">
                          {address.postalCode}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Contact Number */}
                  <div className="pt-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-mono text-neutral-700 bg-surface-container-low px-2.5 py-1 rounded-md border border-outline-variant/30">
                      <Phone className="w-3 h-3 text-neutral-500" />
                      <span>+91 {address.phone}</span>
                    </span>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="mt-6 pt-4 border-t border-outline-variant/30 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleOpenDrawer(address)}
                      className="px-3 py-1.5 rounded-lg border border-outline-variant/60 hover:bg-neutral-950 hover:text-white hover:border-neutral-950 text-xs font-mono font-bold uppercase text-on-surface transition-all flex items-center gap-1.5 min-h-[36px]"
                      aria-label={`Edit address for ${address.fullName}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>

                    <button
                      onClick={() => setAddressToDelete(address)}
                      disabled={isDeleting}
                      className="px-3 py-1.5 rounded-lg border border-outline-variant/60 hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-xs font-mono font-bold uppercase text-neutral-500 transition-all flex items-center gap-1.5 min-h-[36px] disabled:opacity-50"
                      aria-label={`Delete address for ${address.fullName}`}
                    >
                      {isDeleting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      <span>Delete</span>
                    </button>
                  </div>

                  {!isDefault ? (
                    <button
                      onClick={() => handleSetDefault(address)}
                      disabled={isSettingDefault}
                      className="text-xs font-mono font-bold text-neutral-800 hover:text-neutral-950 uppercase tracking-wider transition-colors py-1 px-2 rounded hover:bg-surface-container-low flex items-center gap-1 min-h-[36px] disabled:opacity-50"
                    >
                      {isSettingDefault ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Setting...</span>
                        </>
                      ) : (
                        <span>Set as Default</span>
                      )}
                    </button>
                  ) : (
                    <span className="text-[11px] font-mono font-bold text-emerald-700 flex items-center gap-1 py-1">
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Active Default</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Slide-over Drawer Modal (Add / Edit) */}
      <AnimatePresence>
        {isDrawerOpen && (
          <div className="fixed inset-0 z-[120] overflow-hidden flex justify-end">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-neutral-950/60 backdrop-blur-xs"
              onClick={handleCloseDrawer}
              aria-hidden="true"
            />

            {/* Slide-over Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="relative w-full sm:max-w-md md:max-w-lg bg-surface-container-lowest shadow-2xl flex flex-col h-[100dvh] max-h-[100dvh] z-10 overflow-hidden"
              role="dialog"
              aria-modal="true"
              aria-labelledby="drawer-title"
            >
              {/* Drawer Header */}
              <div className="px-5 sm:px-6 py-4.5 sm:py-5 border-b border-outline-variant/30 flex justify-between items-center bg-surface-container-lowest shrink-0 pt-safe">
                <div>
                  <h2
                    id="drawer-title"
                    className="font-headline-lg text-lg sm:text-xl font-black text-on-surface tracking-tight uppercase"
                  >
                    {editingAddress ? "EDIT ADDRESS" : "ADD NEW ADDRESS"}
                  </h2>
                  <p className="font-body-md text-xs text-on-surface-variant">
                    {editingAddress
                      ? "Update shipping destination and contact point."
                      : "Enter location coordinates for express checkout."}
                  </p>
                </div>
                <button
                  onClick={handleCloseDrawer}
                  className="text-on-surface-variant hover:text-on-surface p-2 rounded-lg hover:bg-surface-container-low transition-colors touch-target-base flex items-center justify-center min-w-[40px] min-h-[40px]"
                  aria-label="Close address drawer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Scrollable Form Body */}
              <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-grow bg-surface-container-lowest space-y-5 overscroll-contain">
                <form id="address-form" onSubmit={handleSubmit} className="space-y-5">
                  {/* Top Level Error Alert */}
                  {formError && (
                    <div className="p-3.5 rounded-xl bg-red-50 text-red-700 text-xs font-mono font-bold border border-red-200 flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {/* 1. Address Type Selector */}
                  <div>
                    <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-2">
                      Address Type
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["HOME", "WORK", "OTHER"] as const).map((type) => {
                        const isSelected = formData.addressType === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() =>
                              setFormData({ ...formData, addressType: type })
                            }
                            className={`py-2.5 px-3 rounded-lg border font-mono text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 min-h-[42px] ${
                              isSelected
                                ? "bg-neutral-950 border-neutral-950 text-white shadow-xs"
                                : "bg-surface-container-low border-outline-variant/60 text-neutral-700 hover:border-neutral-400"
                            }`}
                          >
                            {type === "HOME" ? (
                              <Home className="w-3.5 h-3.5" />
                            ) : type === "WORK" ? (
                              <Briefcase className="w-3.5 h-3.5" />
                            ) : (
                              <MapPin className="w-3.5 h-3.5" />
                            )}
                            <span>{type}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. Recipient Name */}
                  <div>
                    <label
                      htmlFor="addr-fullname"
                      className="block font-mono text-[10px] text-neutral-600 uppercase tracking-wider font-bold mb-1.5"
                    >
                      Full Name *
                    </label>
                    <div className="relative">
                      <input
                        id="addr-fullname"
                        ref={fullNameInputRef}
                        required
                        value={formData.fullName}
                        onChange={(e) => {
                          setFormData({ ...formData, fullName: e.target.value });
                          if (validationErrors.fullName) {
                            setValidationErrors({ ...validationErrors, fullName: "" });
                          }
                        }}
                        className={`w-full bg-surface-container-low border rounded-lg pl-9.5 pr-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none transition-colors ${
                          validationErrors.fullName
                            ? "border-red-500 focus:border-red-600 ring-1 ring-red-500/20"
                            : "border-outline-variant/60 focus:border-neutral-900 focus:bg-white"
                        }`}
                        placeholder="e.g. Kabir Sharma"
                        type="text"
                      />
                      <User className="w-4 h-4 text-neutral-400 absolute left-3 top-3 pointer-events-none" />
                    </div>
                    {validationErrors.fullName && (
                      <p className="mt-1 text-xs text-red-600 font-mono">
                        {validationErrors.fullName}
                      </p>
                    )}
                  </div>

                  {/* 3. Mobile Number */}
                  <div>
                    <label
                      htmlFor="addr-phone"
                      className="block font-mono text-[10px] text-neutral-600 uppercase tracking-wider font-bold mb-1.5"
                    >
                      Mobile Number (10 Digits) *
                    </label>
                    <div className="flex">
                      <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-outline-variant/60 bg-surface-container-high text-neutral-700 font-mono text-xs font-bold select-none">
                        +91
                      </span>
                      <input
                        id="addr-phone"
                        required
                        inputMode="numeric"
                        maxLength={10}
                        value={formData.phone}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "");
                          setFormData({ ...formData, phone: val });
                          if (validationErrors.phone) {
                            setValidationErrors({ ...validationErrors, phone: "" });
                          }
                        }}
                        className={`w-full bg-surface-container-low border rounded-r-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono focus:outline-none transition-colors ${
                          validationErrors.phone
                            ? "border-red-500 focus:border-red-600 ring-1 ring-red-500/20"
                            : "border-outline-variant/60 focus:border-neutral-900 focus:bg-white"
                        }`}
                        placeholder="9876543210"
                        type="tel"
                      />
                    </div>
                    {validationErrors.phone ? (
                      <p className="mt-1 text-xs text-red-600 font-mono">
                        {validationErrors.phone}
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-neutral-500 font-body-sm">
                        Used for dispatch alerts and Delhivery OTP verification.
                      </p>
                    )}
                  </div>

                  {/* 4. PIN Code & City Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label
                        htmlFor="addr-pincode"
                        className="block font-mono text-[10px] text-neutral-600 uppercase tracking-wider font-bold mb-1.5"
                      >
                        PIN Code *
                      </label>
                      <input
                        id="addr-pincode"
                        required
                        inputMode="numeric"
                        maxLength={6}
                        value={formData.postalCode}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "");
                          setFormData({ ...formData, postalCode: val });
                          if (validationErrors.postalCode) {
                            setValidationErrors({
                              ...validationErrors,
                              postalCode: "",
                            });
                          }
                        }}
                        className={`w-full bg-surface-container-low border rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono focus:outline-none transition-colors ${
                          validationErrors.postalCode
                            ? "border-red-500 focus:border-red-600 ring-1 ring-red-500/20"
                            : "border-outline-variant/60 focus:border-neutral-900 focus:bg-white"
                        }`}
                        placeholder="6-digit PIN"
                        type="text"
                      />
                      {validationErrors.postalCode && (
                        <p className="mt-1 text-xs text-red-600 font-mono">
                          {validationErrors.postalCode}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="addr-city"
                        className="block font-mono text-[10px] text-neutral-600 uppercase tracking-wider font-bold mb-1.5"
                      >
                        City *
                      </label>
                      <input
                        id="addr-city"
                        required
                        value={formData.city}
                        onChange={(e) => {
                          setFormData({ ...formData, city: e.target.value });
                          if (validationErrors.city) {
                            setValidationErrors({ ...validationErrors, city: "" });
                          }
                        }}
                        className={`w-full bg-surface-container-low border rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none transition-colors ${
                          validationErrors.city
                            ? "border-red-500 focus:border-red-600 ring-1 ring-red-500/20"
                            : "border-outline-variant/60 focus:border-neutral-900 focus:bg-white"
                        }`}
                        placeholder="City / District"
                        type="text"
                      />
                      {validationErrors.city && (
                        <p className="mt-1 text-xs text-red-600 font-mono">
                          {validationErrors.city}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 5. Address Line 1 */}
                  <div>
                    <label
                      htmlFor="addr-line1"
                      className="block font-mono text-[10px] text-neutral-600 uppercase tracking-wider font-bold mb-1.5"
                    >
                      Flat / House No. / Building / Floor *
                    </label>
                    <input
                      id="addr-line1"
                      required
                      value={formData.addressLine1}
                      onChange={(e) => {
                        setFormData({ ...formData, addressLine1: e.target.value });
                        if (validationErrors.addressLine1) {
                          setValidationErrors({
                            ...validationErrors,
                            addressLine1: "",
                          });
                        }
                      }}
                      className={`w-full bg-surface-container-low border rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none transition-colors ${
                        validationErrors.addressLine1
                          ? "border-red-500 focus:border-red-600 ring-1 ring-red-500/20"
                          : "border-outline-variant/60 focus:border-neutral-900 focus:bg-white"
                      }`}
                      placeholder="e.g. Flat 402, Royal Residency, Tower B"
                      type="text"
                    />
                    {validationErrors.addressLine1 && (
                      <p className="mt-1 text-xs text-red-600 font-mono">
                        {validationErrors.addressLine1}
                      </p>
                    )}
                  </div>

                  {/* 6. Address Line 2 */}
                  <div>
                    <label
                      htmlFor="addr-line2"
                      className="block font-mono text-[10px] text-neutral-600 uppercase tracking-wider font-bold mb-1.5"
                    >
                      Street / Locality / Sector (Optional)
                    </label>
                    <input
                      id="addr-line2"
                      value={formData.addressLine2}
                      onChange={(e) =>
                        setFormData({ ...formData, addressLine2: e.target.value })
                      }
                      className="w-full bg-surface-container-low border border-outline-variant/60 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 focus:bg-white transition-colors"
                      placeholder="e.g. Barakhamba Road, Connaught Place"
                      type="text"
                    />
                  </div>

                  {/* 7. Landmark & State */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label
                        htmlFor="addr-landmark"
                        className="block font-mono text-[10px] text-neutral-600 uppercase tracking-wider font-bold mb-1.5"
                      >
                        Landmark (Optional)
                      </label>
                      <input
                        id="addr-landmark"
                        value={formData.landmark}
                        onChange={(e) =>
                          setFormData({ ...formData, landmark: e.target.value })
                        }
                        className="w-full bg-surface-container-low border border-outline-variant/60 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 focus:bg-white transition-colors"
                        placeholder="e.g. Near Metro Gate 3"
                        type="text"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="addr-state"
                        className="block font-mono text-[10px] text-neutral-600 uppercase tracking-wider font-bold mb-1.5"
                      >
                        State *
                      </label>
                      <input
                        id="addr-state"
                        required
                        value={formData.state}
                        onChange={(e) => {
                          setFormData({ ...formData, state: e.target.value });
                          if (validationErrors.state) {
                            setValidationErrors({
                              ...validationErrors,
                              state: "",
                            });
                          }
                        }}
                        className={`w-full bg-surface-container-low border rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none transition-colors ${
                          validationErrors.state
                            ? "border-red-500 focus:border-red-600 ring-1 ring-red-500/20"
                            : "border-outline-variant/60 focus:border-neutral-900 focus:bg-white"
                        }`}
                        placeholder="e.g. Delhi, Maharashtra"
                        type="text"
                      />
                      {validationErrors.state && (
                        <p className="mt-1 text-xs text-red-600 font-mono">
                          {validationErrors.state}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 8. Make Default Checkbox Card */}
                  <div className="pt-2">
                    <label className="flex items-start gap-3 p-3.5 rounded-xl border border-outline-variant/50 hover:border-neutral-400 bg-surface-container-low/60 cursor-pointer transition-all">
                      <input
                        type="checkbox"
                        checked={formData.isDefault}
                        onChange={(e) =>
                          setFormData({ ...formData, isDefault: e.target.checked })
                        }
                        className="w-4 h-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 mt-0.5 cursor-pointer"
                      />
                      <div className="select-none">
                        <span className="font-mono text-xs font-bold text-on-surface block uppercase tracking-wider">
                          Set as default delivery address
                        </span>
                        <span className="font-body-md text-xs text-on-surface-variant block mt-0.5 leading-snug">
                          Orders and checkout will automatically pre-select this address.
                        </span>
                      </div>
                    </label>
                  </div>
                </form>
              </div>

              {/* Drawer Sticky Footer */}
              <div className="p-4 sm:p-5 border-t border-outline-variant/30 bg-surface-container-lowest shrink-0 flex gap-3 pb-safe">
                <button
                  onClick={handleCloseDrawer}
                  type="button"
                  className="flex-1 py-3 px-4 rounded-lg border border-outline-variant/60 text-on-surface font-mono text-xs uppercase tracking-wider font-bold hover:bg-surface-container-low transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  form="address-form"
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-3 px-4 rounded-lg bg-neutral-950 text-white font-mono text-xs uppercase tracking-wider font-bold hover:bg-neutral-800 transition-all disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2 shadow-sm"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>{editingAddress ? "Update Address" : "Save Address"}</span>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {addressToDelete && (
          <div className="fixed inset-0 z-[140] overflow-y-auto flex items-center justify-center p-4">
            {/* Modal Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-neutral-950/60 backdrop-blur-xs"
              onClick={() => setAddressToDelete(null)}
              aria-hidden="true"
            />

            {/* Modal Box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="relative w-full max-w-md bg-surface-container-lowest rounded-2xl border border-outline-variant/40 shadow-2xl p-6 z-10"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-dialog-title"
              aria-describedby="delete-dialog-desc"
            >
              <div className="w-12 h-12 rounded-xl bg-red-100 text-red-600 flex items-center justify-center mb-4">
                <ShieldAlert className="w-6 h-6 stroke-[1.75]" />
              </div>

              <h3
                id="delete-dialog-title"
                className="font-headline-sm text-lg font-bold text-on-surface uppercase tracking-tight mb-2"
              >
                Delete Saved Address?
              </h3>

              <p
                id="delete-dialog-desc"
                className="font-body-md text-xs sm:text-sm text-on-surface-variant leading-relaxed mb-4"
              >
                Are you sure you want to remove the address for{" "}
                <span className="font-bold text-neutral-900">
                  {addressToDelete.fullName}
                </span>{" "}
                ({addressToDelete.city}, {addressToDelete.postalCode})? This action
                cannot be undone.
              </p>

              {addressToDelete.isDefault && (
                <div className="mb-5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs font-mono">
                  <strong>Notice:</strong> This is currently your default delivery location.
                  Another address will need to be selected for express checkout.
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAddressToDelete(null)}
                  disabled={deletingId !== null}
                  className="px-4 py-2.5 rounded-lg border border-outline-variant/60 text-xs font-mono font-bold uppercase text-neutral-700 hover:bg-surface-container-low transition-colors min-h-[40px]"
                >
                  Keep Address
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deletingId !== null}
                  className="px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-mono font-bold uppercase transition-all flex items-center gap-2 shadow-sm min-h-[40px] disabled:opacity-50"
                >
                  {deletingId ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Address</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
