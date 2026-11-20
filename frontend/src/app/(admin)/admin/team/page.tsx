"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import { ADMIN_MODULES, AdminModule, PermissionLevel } from "@/lib/adminPermissions";
import {
  Shield,
  Users,
  UserX,
  Plus,
  Trash2,
  Edit,
  Search,
  Check,
  AlertTriangle,
  Loader2,
  X,
  Lock,
} from "lucide-react";

interface StaffRole {
  _id: string;
  name: string;
  description?: string;
}

interface StaffMember {
  _id: string;
  name: string;
  email: string;
  role: "ADMIN" | "SUPER_ADMIN" | "CUSTOMER";
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  emailVerified: boolean;
  customRoleId?: StaffRole | null;
  lastLoginAt?: string;
  createdAt: string;
}

interface RoleItem {
  _id: string;
  name: string;
  description: string;
  permissions: Record<AdminModule, PermissionLevel>;
  canRefund: boolean;
  canChangePrices: boolean;
  canManageCoupons: boolean;
  canSuspendUsers: boolean;
  canManageSettings: boolean;
  canManageWebhooks: boolean;
  userCount: number;
  createdAt: string;
}

interface Candidate {
  _id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  emailVerified: boolean;
  customRoleId?: string | null;
}

const MODULE_CATEGORIES: { title: string; modules: { key: AdminModule; label: string }[] }[] = [
  {
    title: "Overview",
    modules: [{ key: "dashboard", label: "Dashboard" }],
  },
  {
    title: "Store Management",
    modules: [
      { key: "orders", label: "Orders" },
      { key: "products", label: "Products" },
      { key: "categories", label: "Categories" },
      { key: "inventory", label: "Inventory" },
      { key: "customers", label: "Customers" },
      { key: "returns", label: "Returns" },
      { key: "reviews", label: "Reviews" },
      { key: "support", label: "Support" },
      { key: "settings", label: "Store Settings" },
    ],
  },
  {
    title: "Custom Printing & Production",
    modules: [
      { key: "printCatalog", label: "Print Catalog" },
      { key: "printPricing", label: "Print Pricing" },
      { key: "customOrders", label: "Custom Orders" },
      { key: "bulkOrders", label: "Bulk Orders" },
      { key: "production", label: "Production Queue" },
    ],
  },
  {
    title: "Marketing & CMS",
    modules: [
      { key: "banners", label: "Banners" },
      { key: "campaigns", label: "Campaigns" },
      { key: "coupons", label: "Coupons" },
      { key: "themes", label: "Themes" },
    ],
  },
  {
    title: "Operations & Reporting",
    modules: [
      { key: "invoices", label: "Invoices" },
      { key: "inventoryLedger", label: "Inventory Ledger" },
      { key: "notifications", label: "Notifications" },
      { key: "paymentReconciliation", label: "Payment Reconciliation" },
      { key: "paymentDiagnostics", label: "Payment Diagnostics" },
      { key: "auditLogs", label: "Audit Logs" },
      { key: "webhooks", label: "Webhooks" },
      { key: "systemHealth", label: "System Health" },
    ],
  },
];

export default function AdminTeamPage() {
  const { user: currentUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"staff" | "roles">("staff");

  // Staff State
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);

  // Roles State
  const [rolesList, setRolesList] = useState<RoleItem[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);

  // Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);

  // Messages
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Role Edit/Create Modal State
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleFormName, setRoleFormName] = useState("");
  const [roleFormDesc, setRoleFormDesc] = useState("");
  const [roleFormPerms, setRoleFormPerms] = useState<Record<AdminModule, PermissionLevel>>({} as any);
  const [roleFormRefund, setRoleFormRefund] = useState(false);
  const [roleFormPrices, setRoleFormPrices] = useState(false);
  const [roleFormCoupons, setRoleFormCoupons] = useState(false);
  const [roleFormSuspend, setRoleFormSuspend] = useState(false);
  const [roleFormSettings, setRoleFormSettings] = useState(false);
  const [roleFormWebhooks, setRoleFormWebhooks] = useState(false);
  const [savingRole, setSavingRole] = useState(false);

  // Assign Role Modal State
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [targetUser, setTargetUser] = useState<StaffMember | Candidate | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [savingAssignment, setSavingAssignment] = useState(false);

  const fetchStaff = useCallback(async () => {
    try {
      setLoadingStaff(true);
      const res = await api.get("/admin/team/members");
      if (res.data?.success) {
        setStaffList(res.data.data || []);
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || "Failed to load staff list");
    } finally {
      setLoadingStaff(false);
    }
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      setLoadingRoles(true);
      const res = await api.get("/admin/team/roles");
      if (res.data?.success) {
        setRolesList(res.data.data || []);
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || "Failed to load roles");
    } finally {
      setLoadingRoles(false);
    }
  }, []);

  useEffect(() => {
    fetchStaff();
    fetchRoles();
  }, [fetchStaff, fetchRoles]);

  // Search candidates debounced
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const res = await api.get(`/admin/team/search-candidates?email=${encodeURIComponent(searchQuery.trim())}`);
        if (res.data?.success) {
          setSearchResults(res.data.data || []);
        }
      } catch {
        // fail silent
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const openCreateRoleModal = () => {
    setEditingRoleId(null);
    setRoleFormName("");
    setRoleFormDesc("");
    const initialPerms = {} as Record<AdminModule, PermissionLevel>;
    for (const mod of ADMIN_MODULES) {
      initialPerms[mod] = "none";
    }
    setRoleFormPerms(initialPerms);
    setRoleFormRefund(false);
    setRoleFormPrices(false);
    setRoleFormCoupons(false);
    setRoleFormSuspend(false);
    setRoleFormSettings(false);
    setRoleFormWebhooks(false);
    setRoleModalOpen(true);
  };

  const openEditRoleModal = (role: RoleItem) => {
    setEditingRoleId(role._id);
    setRoleFormName(role.name);
    setRoleFormDesc(role.description || "");
    const initialPerms = {} as Record<AdminModule, PermissionLevel>;
    for (const mod of ADMIN_MODULES) {
      initialPerms[mod] = role.permissions?.[mod] || "none";
    }
    setRoleFormPerms(initialPerms);
    setRoleFormRefund(Boolean(role.canRefund));
    setRoleFormPrices(Boolean(role.canChangePrices));
    setRoleFormCoupons(Boolean(role.canManageCoupons));
    setRoleFormSuspend(Boolean(role.canSuspendUsers));
    setRoleFormSettings(Boolean(role.canManageSettings));
    setRoleFormWebhooks(Boolean(role.canManageWebhooks));
    setRoleModalOpen(true);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleFormName.trim()) {
      setErrorMsg("Role name is required");
      return;
    }

    try {
      setSavingRole(true);
      setErrorMsg("");
      const payload = {
        name: roleFormName.trim(),
        description: roleFormDesc.trim(),
        permissions: roleFormPerms,
        canRefund: roleFormRefund,
        canChangePrices: roleFormPrices,
        canManageCoupons: roleFormCoupons,
        canSuspendUsers: roleFormSuspend,
        canManageSettings: roleFormSettings,
        canManageWebhooks: roleFormWebhooks,
      };

      if (editingRoleId) {
        await api.put(`/admin/team/roles/${editingRoleId}`, payload);
        setSuccessMsg(`Role "${roleFormName}" updated successfully.`);
      } else {
        await api.post("/admin/team/roles", payload);
        setSuccessMsg(`Role "${roleFormName}" created successfully.`);
      }

      setRoleModalOpen(false);
      await fetchRoles();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || "Failed to save role");
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async (role: RoleItem) => {
    if (role.userCount > 0) {
      setErrorMsg(`Cannot delete role "${role.name}": ${role.userCount} user(s) are assigned to it.`);
      return;
    }
    if (!window.confirm(`Are you sure you want to delete role "${role.name}"?`)) {
      return;
    }

    try {
      setErrorMsg("");
      await api.delete(`/admin/team/roles/${role._id}`);
      setSuccessMsg(`Role "${role.name}" deleted.`);
      await fetchRoles();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || "Failed to delete role");
    }
  };

  const openAssignModal = (user: StaffMember | Candidate) => {
    setTargetUser(user);
    const existingRoleId = typeof user.customRoleId === "object" ? user.customRoleId?._id : user.customRoleId;
    setSelectedRoleId(existingRoleId || (rolesList[0]?._id || ""));
    setAssignModalOpen(true);
  };

  const handleSaveAssignment = async () => {
    if (!targetUser || !selectedRoleId) return;
    try {
      setSavingAssignment(true);
      setErrorMsg("");
      await api.post(`/admin/team/members/${targetUser._id}/role`, { roleId: selectedRoleId });
      setSuccessMsg(`Role assigned to ${targetUser.email}.`);
      setAssignModalOpen(false);
      setSearchQuery("");
      setSearchResults([]);
      await fetchStaff();
      await fetchRoles();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || "Failed to assign role");
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleRemoveStaffAccess = async (member: StaffMember) => {
    if (member._id === currentUser?.id) {
      setErrorMsg("You cannot remove your own admin access.");
      return;
    }
    if (member.role === "SUPER_ADMIN") {
      setErrorMsg("Cannot remove access for a SUPER_ADMIN.");
      return;
    }
    if (!window.confirm(`Are you sure you want to remove staff access for ${member.email}? They will become a CUSTOMER and all active sessions will be terminated immediately.`)) {
      return;
    }

    try {
      setErrorMsg("");
      await api.delete(`/admin/team/members/${member._id}/role`);
      setSuccessMsg(`Staff access removed for ${member.email}.`);
      await fetchStaff();
      await fetchRoles();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || "Failed to remove staff access");
    }
  };

  const handleToggleStatus = async (member: StaffMember) => {
    if (member._id === currentUser?.id) {
      setErrorMsg("You cannot suspend your own account.");
      return;
    }
    const nextStatus = member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    if (nextStatus === "SUSPENDED") {
      if (!window.confirm(`Suspend staff account ${member.email}? Their active sessions will be revoked.`)) {
        return;
      }
    }

    try {
      setErrorMsg("");
      await api.patch(`/admin/team/members/${member._id}/status`, { status: nextStatus });
      setSuccessMsg(`Account status for ${member.email} updated to ${nextStatus}.`);
      await fetchStaff();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || "Failed to update staff status");
    }
  };

  const setAllPermsTo = (level: PermissionLevel) => {
    const updated = {} as Record<AdminModule, PermissionLevel>;
    for (const mod of ADMIN_MODULES) {
      updated[mod] = level;
    }
    setRoleFormPerms(updated);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-outline-variant/40">
        <div>
          <h1 className="font-headline-sm text-2xl font-black text-on-surface tracking-tight uppercase flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            <span>Team & Access Control</span>
          </h1>
          <p className="font-body-sm text-xs text-neutral-500 mt-1">
            Owner (SUPER_ADMIN) portal: define granular custom roles and assign them to staff members.
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex bg-neutral-100 p-1 rounded-lg border border-neutral-200">
          <button
            onClick={() => setActiveTab("staff")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-mono text-xs font-bold transition-colors cursor-pointer ${
              activeTab === "staff" ? "bg-white text-neutral-900 shadow-xs" : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Staff Members ({staffList.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("roles")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-mono text-xs font-bold transition-colors cursor-pointer ${
              activeTab === "roles" ? "bg-white text-neutral-900 shadow-xs" : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            <Lock className="w-4 h-4" />
            <span>Custom Roles ({rolesList.length})</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg("")} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg("")} className="text-green-500 hover:text-green-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TAB 1: STAFF MEMBERS */}
      {activeTab === "staff" && (
        <div className="space-y-6">
          {/* Add Staff Search Card */}
          <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-xl p-5 shadow-xs">
            <h2 className="text-sm font-bold text-on-surface uppercase tracking-wider font-mono mb-2">
              Add Team Member
            </h2>
            <p className="text-xs text-neutral-500 mb-4">
              Team members register first via the storefront. Search their verified email below to grant them an admin role.
            </p>
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search registered user by email..."
                className="w-full pl-9 pr-4 py-2 border border-outline-variant rounded-lg text-xs font-mono focus:outline-hidden focus:border-neutral-900 bg-white"
              />
              {searching && (
                <Loader2 className="w-4 h-4 animate-spin text-neutral-400 absolute right-3 top-3" />
              )}
            </div>

            {/* Candidate Search Results */}
            {searchResults.length > 0 && (
              <div className="mt-4 border border-outline-variant/80 rounded-lg overflow-hidden divide-y divide-outline-variant/40 bg-white">
                {searchResults.map((c) => (
                  <div key={c._id} className="p-3 flex items-center justify-between text-xs hover:bg-neutral-50">
                    <div>
                      <p className="font-bold text-neutral-900">{c.name}</p>
                      <p className="font-mono text-neutral-500">{c.email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-neutral-100 text-neutral-700">
                        {c.role}
                      </span>
                      <button
                        onClick={() => openAssignModal(c)}
                        className="px-3 py-1.5 bg-neutral-900 text-white font-mono text-[11px] font-bold rounded hover:bg-neutral-800 transition-colors cursor-pointer"
                      >
                        Assign Role
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Staff Table Card */}
          <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-xl overflow-hidden shadow-xs">
            <div className="p-4 border-b border-outline-variant/40 flex items-center justify-between">
              <h2 className="text-sm font-bold text-on-surface uppercase tracking-wider font-mono">
                Current Staff Members
              </h2>
              <span className="font-mono text-xs text-neutral-400">{staffList.length} members</span>
            </div>

            {loadingStaff ? (
              <div className="p-8 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-2" />
                <span className="font-mono text-xs text-neutral-500">Loading staff...</span>
              </div>
            ) : staffList.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-500 font-mono">
                No staff members configured.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-outline-variant/40 font-mono text-neutral-500 uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Member</th>
                      <th className="py-3 px-4">Base Role</th>
                      <th className="py-3 px-4">Custom Role</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Last Login</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {staffList.map((m) => {
                      const isOwner = m.role === "SUPER_ADMIN";
                      const isSelf = m._id === currentUser?.id;
                      return (
                        <tr key={m._id} className="hover:bg-neutral-50/50">
                          <td className="py-3 px-4">
                            <p className="font-bold text-neutral-900">{m.name}</p>
                            <p className="font-mono text-neutral-500 text-[11px]">{m.email}</p>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`font-mono text-[10px] px-2 py-0.5 rounded font-bold ${
                                isOwner ? "bg-amber-100 text-amber-900" : "bg-neutral-100 text-neutral-700"
                              }`}
                            >
                              {m.role}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {isOwner ? (
                              <span className="font-mono text-neutral-500 text-[11px]">Full System Access</span>
                            ) : m.customRoleId ? (
                              <span className="font-bold text-neutral-800">
                                {typeof m.customRoleId === "object" ? m.customRoleId.name : "Assigned"}
                              </span>
                            ) : (
                              <span className="text-neutral-400 italic font-mono text-[11px]">Full Admin (Legacy)</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`font-mono text-[10px] px-2 py-0.5 rounded font-bold ${
                                m.status === "ACTIVE"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {m.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-neutral-500 text-[11px]">
                            {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString() : "Never"}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {!isOwner && (
                                <>
                                  <button
                                    onClick={() => openAssignModal(m)}
                                    className="px-2.5 py-1 text-[11px] font-mono font-bold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded transition-colors cursor-pointer"
                                  >
                                    Change Role
                                  </button>
                                  <button
                                    onClick={() => handleToggleStatus(m)}
                                    disabled={isSelf}
                                    title={isSelf ? "Cannot alter self" : ""}
                                    className={`px-2 py-1 text-[11px] font-mono font-bold rounded transition-colors cursor-pointer ${
                                      m.status === "ACTIVE"
                                        ? "text-amber-700 hover:bg-amber-50"
                                        : "text-green-700 hover:bg-green-50"
                                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                                  >
                                    {m.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                                  </button>
                                  <button
                                    onClick={() => handleRemoveStaffAccess(m)}
                                    disabled={isSelf}
                                    title={isSelf ? "Cannot remove own access" : "Remove admin role"}
                                    className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <UserX className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                              {isOwner && (
                                <span className="font-mono text-[10px] text-neutral-400">Owner</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CUSTOM ROLES */}
      {activeTab === "roles" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-on-surface uppercase tracking-wider font-mono">
                Defined Roles
              </h2>
              <p className="text-xs text-neutral-500">
                Custom roles determine page visibility and action permissions per administrative module.
              </p>
            </div>
            <button
              onClick={openCreateRoleModal}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-neutral-900 text-white font-mono text-xs font-bold uppercase rounded-lg hover:bg-neutral-800 transition-colors shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Role</span>
            </button>
          </div>

          {loadingRoles ? (
            <div className="p-8 text-center bg-white border border-outline-variant/60 rounded-xl">
              <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-2" />
              <span className="font-mono text-xs text-neutral-500">Loading roles...</span>
            </div>
          ) : rolesList.length === 0 ? (
            <div className="p-12 text-center bg-white border border-outline-variant/60 rounded-xl">
              <Lock className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
              <h3 className="font-bold text-sm text-neutral-800 mb-1">No Custom Roles Yet</h3>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto mb-4">
                Create custom roles (e.g. "Orders Staff", "Catalog Manager") to grant specific permissions to team members.
              </p>
              <button
                onClick={openCreateRoleModal}
                className="px-4 py-2 bg-neutral-900 text-white font-mono text-xs font-bold rounded-lg hover:bg-neutral-800 cursor-pointer"
              >
                Create First Role
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rolesList.map((r) => {
                const managedModulesCount = Object.values(r.permissions || {}).filter(
                  (lvl) => lvl === "manage"
                ).length;
                const viewModulesCount = Object.values(r.permissions || {}).filter(
                  (lvl) => lvl === "view"
                ).length;

                return (
                  <div
                    key={r._id}
                    className="bg-white border border-outline-variant/60 rounded-xl p-5 shadow-xs flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-bold text-base text-neutral-900">{r.name}</h3>
                        <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 font-bold">
                          {r.userCount} {r.userCount === 1 ? "user" : "users"}
                        </span>
                      </div>
                      {r.description && (
                        <p className="text-xs text-neutral-600 mb-3">{r.description}</p>
                      )}

                      {/* Permissions Breakdown */}
                      <div className="flex flex-wrap gap-1.5 mb-3 font-mono text-[10px]">
                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                          {managedModulesCount} Manage
                        </span>
                        <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 font-semibold border border-neutral-200">
                          {viewModulesCount} View-only
                        </span>
                      </div>

                      {/* Sensitive Actions Badges */}
                      <div className="flex flex-wrap gap-1 mb-4">
                        {r.canRefund && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                            Refunds
                          </span>
                        )}
                        {r.canChangePrices && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                            Price Changes
                          </span>
                        )}
                        {r.canManageCoupons && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200">
                            Coupons
                          </span>
                        )}
                        {r.canSuspendUsers && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200">
                            User Suspension
                          </span>
                        )}
                        {r.canManageSettings && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200">
                            Store Settings
                          </span>
                        )}
                        {r.canManageWebhooks && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200">
                            Webhooks
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-outline-variant/30 flex items-center justify-between">
                      <button
                        onClick={() => openEditRoleModal(r)}
                        className="flex items-center gap-1.5 text-xs font-mono font-bold text-neutral-700 hover:text-neutral-900 cursor-pointer"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        <span>Edit Role</span>
                      </button>
                      <button
                        onClick={() => handleDeleteRole(r)}
                        disabled={r.userCount > 0}
                        title={
                          r.userCount > 0
                            ? `Cannot delete role while ${r.userCount} user(s) are assigned.`
                            : "Delete role"
                        }
                        className="flex items-center gap-1.5 text-xs font-mono font-bold text-red-600 hover:text-red-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL: ASSIGN ROLE */}
      {assignModalOpen && targetUser && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-outline-variant max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant/40">
              <h3 className="font-bold text-base text-neutral-900">
                Assign Custom Role
              </h3>
              <button onClick={() => setAssignModalOpen(false)} className="text-neutral-500 hover:text-neutral-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <p className="text-xs text-neutral-500">Target Member:</p>
              <p className="font-bold text-sm text-neutral-900">{targetUser.name}</p>
              <p className="font-mono text-xs text-neutral-500">{targetUser.email}</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono font-bold text-neutral-700 uppercase">
                Select Custom Role
              </label>
              <select
                value={selectedRoleId}
                onChange={(e) => setSelectedRoleId(e.target.value)}
                className="w-full p-2.5 border border-outline-variant rounded-lg text-xs font-mono bg-white"
              >
                {rolesList.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.name} ({r.description || "Custom Role"})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-outline-variant/40">
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                className="px-4 py-2 font-mono text-xs text-neutral-600 hover:text-neutral-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAssignment}
                disabled={savingAssignment}
                className="px-4 py-2 font-mono text-xs font-bold bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {savingAssignment && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Role Assignment</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT ROLE */}
      {roleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-outline-variant max-w-3xl w-full p-6 shadow-xl space-y-5 my-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant/40 sticky top-0 bg-white z-10">
              <h3 className="font-bold text-base text-neutral-900 uppercase font-mono tracking-tight">
                {editingRoleId ? "Edit Custom Role" : "Create New Custom Role"}
              </h3>
              <button onClick={() => setRoleModalOpen(false)} className="text-neutral-500 hover:text-neutral-900">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="space-y-6">
              {/* Role Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-mono font-bold text-neutral-700 uppercase">
                    Role Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={roleFormName}
                    onChange={(e) => setRoleFormName(e.target.value)}
                    placeholder='e.g. "Orders Staff"'
                    className="w-full p-2.5 border border-outline-variant rounded-lg text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono font-bold text-neutral-700 uppercase">
                    Description
                  </label>
                  <input
                    type="text"
                    value={roleFormDesc}
                    onChange={(e) => setRoleFormDesc(e.target.value)}
                    placeholder="Brief description of responsibilities..."
                    className="w-full p-2.5 border border-outline-variant rounded-lg text-xs"
                  />
                </div>
              </div>

              {/* Sensitive Actions Toggles */}
              <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-xl space-y-3">
                <div>
                  <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-900">
                    High-Impact Sensitive Actions
                  </h4>
                  <p className="text-[11px] text-neutral-500">
                    Explicit toggles for high-risk actions. All default to OFF for staff safety.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                  <label className="flex items-start gap-2.5 p-2 bg-white border border-neutral-200 rounded-lg cursor-pointer hover:border-neutral-400">
                    <input
                      type="checkbox"
                      checked={roleFormRefund}
                      onChange={(e) => setRoleFormRefund(e.target.checked)}
                      className="mt-0.5 rounded text-neutral-900"
                    />
                    <div>
                      <p className="text-xs font-bold text-neutral-900">canRefund</p>
                      <p className="text-[10px] text-neutral-500">Issue refunds / cancellations with refund</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 bg-white border border-neutral-200 rounded-lg cursor-pointer hover:border-neutral-400">
                    <input
                      type="checkbox"
                      checked={roleFormPrices}
                      onChange={(e) => setRoleFormPrices(e.target.checked)}
                      className="mt-0.5 rounded text-neutral-900"
                    />
                    <div>
                      <p className="text-xs font-bold text-neutral-900">canChangePrices</p>
                      <p className="text-[10px] text-neutral-500">Change product basePrice / mrp</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 bg-white border border-neutral-200 rounded-lg cursor-pointer hover:border-neutral-400">
                    <input
                      type="checkbox"
                      checked={roleFormCoupons}
                      onChange={(e) => setRoleFormCoupons(e.target.checked)}
                      className="mt-0.5 rounded text-neutral-900"
                    />
                    <div>
                      <p className="text-xs font-bold text-neutral-900">canManageCoupons</p>
                      <p className="text-[10px] text-neutral-500">Create, edit, and delete coupons</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 bg-white border border-neutral-200 rounded-lg cursor-pointer hover:border-neutral-400">
                    <input
                      type="checkbox"
                      checked={roleFormSuspend}
                      onChange={(e) => setRoleFormSuspend(e.target.checked)}
                      className="mt-0.5 rounded text-neutral-900"
                    />
                    <div>
                      <p className="text-xs font-bold text-neutral-900">canSuspendUsers</p>
                      <p className="text-[10px] text-neutral-500">Suspend/reactivate customer accounts</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 bg-white border border-neutral-200 rounded-lg cursor-pointer hover:border-neutral-400">
                    <input
                      type="checkbox"
                      checked={roleFormSettings}
                      onChange={(e) => setRoleFormSettings(e.target.checked)}
                      className="mt-0.5 rounded text-neutral-900"
                    />
                    <div>
                      <p className="text-xs font-bold text-neutral-900">canManageSettings</p>
                      <p className="text-[10px] text-neutral-500">Change Store Shipping & Settings</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 bg-white border border-neutral-200 rounded-lg cursor-pointer hover:border-neutral-400">
                    <input
                      type="checkbox"
                      checked={roleFormWebhooks}
                      onChange={(e) => setRoleFormWebhooks(e.target.checked)}
                      className="mt-0.5 rounded text-neutral-900"
                    />
                    <div>
                      <p className="text-xs font-bold text-neutral-900">canManageWebhooks</p>
                      <p className="text-[10px] text-neutral-500">Retry/Resolve webhook events</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Module Permissions Matrix */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-900">
                      Module Access Permissions
                    </h4>
                    <p className="text-[11px] text-neutral-500">
                      None = page hidden + API forbidden | View = list/read | Manage = create/edit/delete
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={() => setAllPermsTo("none")}
                      className="px-2 py-1 bg-neutral-100 hover:bg-neutral-200 rounded text-neutral-700 cursor-pointer"
                    >
                      Clear All
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllPermsTo("view")}
                      className="px-2 py-1 bg-neutral-100 hover:bg-neutral-200 rounded text-neutral-700 cursor-pointer"
                    >
                      All View
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllPermsTo("manage")}
                      className="px-2 py-1 bg-neutral-100 hover:bg-neutral-200 rounded text-neutral-700 cursor-pointer"
                    >
                      All Manage
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {MODULE_CATEGORIES.map((cat) => (
                    <div key={cat.title} className="border border-outline-variant/60 rounded-lg overflow-hidden">
                      <div className="bg-neutral-50 px-3 py-2 border-b border-outline-variant/40">
                        <span className="font-mono text-[11px] font-bold text-neutral-600 uppercase tracking-wider">
                          {cat.title}
                        </span>
                      </div>
                      <div className="divide-y divide-outline-variant/30 bg-white">
                        {cat.modules.map((m) => {
                          const currentLevel = roleFormPerms[m.key] || "none";
                          return (
                            <div
                              key={m.key}
                              className="px-3 py-2 flex items-center justify-between text-xs"
                            >
                              <span className="font-medium text-neutral-800">{m.label}</span>
                              <div className="flex bg-neutral-100 rounded-md p-0.5 border border-neutral-200 font-mono text-[10px]">
                                {(["none", "view", "manage"] as PermissionLevel[]).map((level) => {
                                  const active = currentLevel === level;
                                  return (
                                    <button
                                      key={level}
                                      type="button"
                                      onClick={() =>
                                        setRoleFormPerms((prev) => ({
                                          ...prev,
                                          [m.key]: level,
                                        }))
                                      }
                                      className={`px-2.5 py-1 rounded capitalize font-bold transition-colors cursor-pointer ${
                                        active
                                          ? level === "manage"
                                            ? "bg-neutral-900 text-white shadow-xs"
                                            : level === "view"
                                            ? "bg-blue-600 text-white shadow-xs"
                                            : "bg-neutral-300 text-neutral-900 shadow-xs"
                                          : "text-neutral-500 hover:text-neutral-900"
                                      }`}
                                    >
                                      {level}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-outline-variant/40 sticky bottom-0 bg-white z-10">
                <button
                  type="button"
                  onClick={() => setRoleModalOpen(false)}
                  className="px-4 py-2 font-mono text-xs text-neutral-600 hover:text-neutral-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRole}
                  className="px-5 py-2.5 font-mono text-xs font-bold bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {savingRole && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingRoleId ? "Update Custom Role" : "Create Custom Role"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
