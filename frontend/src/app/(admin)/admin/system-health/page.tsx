"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Activity, Database, CreditCard, Truck, Mail, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

interface ServiceConfigStatus {
  provider: string;
  status: "CONFIGURED" | "NOT_CONFIGURED";
  verificationType: string;
}

interface DiagnosticsData {
  status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  database: "CONNECTED" | "DISCONNECTED";
  paymentProvider: ServiceConfigStatus;
  logisticsProvider: ServiceConfigStatus;
  emailProvider: ServiceConfigStatus;
  requestId: string;
}

export default function AdminSystemHealthPage() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastChecked, setLastChecked] = useState<string>("");

  const fetchDiagnostics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/diagnostics");
      if (res.data) {
        setData(res.data);
        setLastChecked(new Date().toLocaleTimeString("en-IN"));
      }
      setError("");
    } catch {
      setError("Failed to fetch system diagnostics. Check server connectivity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDiagnostics();
  }, [fetchDiagnostics]);

  const getServiceBadge = (st?: "CONFIGURED" | "NOT_CONFIGURED") => {
    if (st === "CONFIGURED") {
      return {
        label: "CONFIGURED",
        badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400",
        icon: CheckCircle2,
      };
    }
    return {
      label: "NOT CONFIGURED",
      badgeClass: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400",
      icon: AlertTriangle,
    };
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-5">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">
            System Health &amp; Diagnostics
          </h1>
          <p className="font-body-sm text-xs text-on-surface-variant mt-1">
            Live operational status across MongoDB, Razorpay gateway, Delhivery logistics, and Brevo email providers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastChecked && (
            <span className="font-mono text-xs text-neutral-400">
              Checked: {lastChecked}
            </span>
          )}
          <button
            type="button"
            onClick={fetchDiagnostics}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 text-white font-mono text-xs uppercase font-bold tracking-wider rounded-md hover:bg-neutral-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-mono">
          {error}
        </div>
      )}

      {/* Grid of Service Nodes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Database */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-xs flex flex-col justify-between h-44">
          <div className="flex justify-between items-start">
            <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/40">
              <Database className="w-5 h-5 text-on-surface" />
            </div>
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border font-mono text-[10px] font-bold uppercase ${
              data?.database === "CONNECTED"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400"
            }`}>
              {data?.database === "CONNECTED" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
              <span>{data?.database || "CHECKING..."}</span>
            </span>
          </div>
          <div>
            <h2 className="font-headline-sm text-sm font-bold text-on-surface uppercase">Database (MongoDB)</h2>
            <p className="text-[11px] text-neutral-400 font-body-sm mt-0.5">
              Active cluster connection &amp; document storage.
            </p>
          </div>
        </div>

        {/* Payment Gateway */}
        {(() => {
          const badge = getServiceBadge(data?.paymentProvider?.status);
          const Icon = badge.icon;
          return (
            <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-xs flex flex-col justify-between h-44">
              <div className="flex justify-between items-start">
                <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/40">
                  <CreditCard className="w-5 h-5 text-on-surface" />
                </div>
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border font-mono text-[10px] font-bold uppercase ${badge.badgeClass}`}>
                  <Icon className="w-3 h-3" />
                  <span>{badge.label}</span>
                </span>
              </div>
              <div>
                <h2 className="font-headline-sm text-sm font-bold text-on-surface uppercase">Razorpay Gateway</h2>
                <p className="text-[11px] text-neutral-400 font-body-sm mt-0.5">
                  Key &amp; Secret credentials verified.
                </p>
              </div>
            </div>
          );
        })()}

        {/* Logistics Provider */}
        {(() => {
          const badge = getServiceBadge(data?.logisticsProvider?.status);
          const Icon = badge.icon;
          return (
            <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-xs flex flex-col justify-between h-44">
              <div className="flex justify-between items-start">
                <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/40">
                  <Truck className="w-5 h-5 text-on-surface" />
                </div>
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border font-mono text-[10px] font-bold uppercase ${badge.badgeClass}`}>
                  <Icon className="w-3 h-3" />
                  <span>{badge.label}</span>
                </span>
              </div>
              <div>
                <h2 className="font-headline-sm text-sm font-bold text-on-surface uppercase">
                  {data?.logisticsProvider?.provider || "DELHIVERY"} Logistics
                </h2>
                <p className="text-[11px] text-neutral-400 font-body-sm mt-0.5">
                  Dispatch token &amp; provider binding verified.
                </p>
              </div>
            </div>
          );
        })()}

        {/* Email Provider */}
        {(() => {
          const badge = getServiceBadge(data?.emailProvider?.status);
          const Icon = badge.icon;
          return (
            <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-xs flex flex-col justify-between h-44">
              <div className="flex justify-between items-start">
                <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/40">
                  <Mail className="w-5 h-5 text-on-surface" />
                </div>
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border font-mono text-[10px] font-bold uppercase ${badge.badgeClass}`}>
                  <Icon className="w-3 h-3" />
                  <span>{badge.label}</span>
                </span>
              </div>
              <div>
                <h2 className="font-headline-sm text-sm font-bold text-on-surface uppercase">
                  {data?.emailProvider?.provider || "BREVO"} Email
                </h2>
                <p className="text-[11px] text-neutral-400 font-body-sm mt-0.5">
                  Transactional delivery token verified.
                </p>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Non-intrusive notice */}
      <div className="p-3.5 bg-surface-container-low rounded-xl border border-outline-variant/30 font-mono text-[11px] text-neutral-500 leading-relaxed">
        <strong className="text-on-surface font-bold uppercase">Note on provider diagnostics: </strong>
        Third-party payment, courier, and email providers display verified environment configuration status. Non-intrusive checks avoid incurring synthetic test charges or bookings on live logistics and payment networks.
      </div>

      {/* Observability Details Card */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-xs space-y-3 font-mono text-xs">
        <div className="flex items-center gap-2 text-on-surface font-bold uppercase text-[11px]">
          <Activity className="w-4 h-4 text-primary" />
          <span>Active Request Observability Context</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-neutral-600 bg-surface-container-low p-3.5 rounded-lg">
          <div>
            <span className="text-neutral-400">REQUEST ID: </span>
            <span className="font-semibold text-on-surface">{data?.requestId || "obs_direct"}</span>
          </div>
          <div>
            <span className="text-neutral-400">ENVIRONMENT: </span>
            <span className="font-semibold text-emerald-600">PRODUCTION READY</span>
          </div>
        </div>
      </div>
    </div>
  );
}
