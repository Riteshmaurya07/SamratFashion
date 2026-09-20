"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface AdminTicketItem {
  _id: string;
  ticketNumber: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  userId?: {
    _id: string;
    name: string;
    email: string;
  };
  orderId?: {
    orderNumber: string;
  };
}

export default function AdminSupportQueueClient() {
  const router = useRouter();

  const [tickets, setTickets] = useState<AdminTicketItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [categoryFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch Admin Tickets
  const fetchTickets = useCallback(
    async (isBackground = false) => {
      try {
        const res = await api.get("/admin/support/tickets", {
          params: {
            status: statusFilter !== "All" ? statusFilter : undefined,
            priority: priorityFilter !== "All" ? priorityFilter : undefined,
            category: categoryFilter !== "All" ? categoryFilter : undefined,
            q: searchQuery || undefined,
          },
        });
        if (res.data?.success) {
          setTickets(res.data.data);
        }
      } catch (err: any) {
        if (err.response?.status === 403 || err.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        if (!isBackground) {
          setError(err.response?.data?.message || "Failed to load support tickets.");
        }
      } finally {
        if (!isBackground) {
          setIsLoading(false);
        }
      }
    },
    [statusFilter, priorityFilter, categoryFilter, searchQuery, router]
  );

  // Initial Load
  useEffect(() => {
    setIsLoading(true);
    fetchTickets(false);
  }, [fetchTickets]);

  // Polling Loop (10000ms) with Visibility Control for Queue
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    const startPolling = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => {
        if (document.visibilityState === "visible") {
          fetchTickets(true);
        }
      }, 10000);
    };

    startPolling();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchTickets(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchTickets]);

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-10 font-body-md pb-24">
      {/* Header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="font-display-lg text-3xl md:text-4xl font-extrabold text-on-surface tracking-tight">
            Support Queue & Tickets
          </h1>
          <p className="font-body-md text-on-surface-variant mt-1">
            Manage customer inquiries, assign support staff, and resolve tickets.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant mb-6 shadow-sm flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[280px]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-surface-container-low border border-outline-variant rounded-lg font-body-sm text-sm outline-none focus:border-primary"
            placeholder="Search ticket #, customer, subject, order #..."
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
        >
          <option value="All">Status: All</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="WAITING_FOR_CUSTOMER">Waiting for Customer</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
        >
          <option value="All">Priority: All</option>
          <option value="HIGH">High Priority</option>
          <option value="MEDIUM">Medium Priority</option>
          <option value="LOW">Low Priority</option>
        </select>
      </div>

      {isLoading && (
        <div className="p-8 text-center font-bold text-on-surface-variant">Loading support queue...</div>
      )}

      {error && (
        <div className="p-4 bg-error-container text-on-error-container rounded-xl text-center font-bold mb-6">{error}</div>
      )}

      {/* Admin Queue Data Table */}
      {!isLoading && !error && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Ticket #</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Customer</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Subject & Category</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Order Reference</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Status</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Priority</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-sm">
                {tickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-on-surface-variant">
                      No support tickets found matching the selected filters.
                    </td>
                  </tr>
                ) : (
                  tickets.map((t) => (
                    <tr
                      key={t._id}
                      onClick={() => router.push(`/admin/support/${t._id}`)}
                      className="border-b border-outline-variant hover:bg-surface-container-low transition-colors cursor-pointer"
                    >
                      <td className="p-4 font-bold font-label-caps text-primary">{t.ticketNumber}</td>
                      <td className="p-4 font-medium text-on-surface-variant">{t.userId?.name || "Customer"}</td>
                      <td className="p-4">
                        <p className="font-bold text-on-surface line-clamp-1">{t.subject}</p>
                        <p className="text-xs text-on-surface-variant font-label-caps">{t.category}</p>
                      </td>
                      <td className="p-4 font-label-caps text-xs text-on-surface">
                        {t.orderId ? `#${t.orderId.orderNumber}` : "None"}
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                            t.status === "RESOLVED" || t.status === "CLOSED"
                              ? "bg-emerald-100 text-emerald-800"
                              : t.status === "WAITING_FOR_CUSTOMER"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="p-4">
                        <span
                          className={`text-xs font-bold ${
                            t.priority === "HIGH" ? "text-red-600 font-extrabold" : "text-on-surface-variant"
                          }`}
                        >
                          {t.priority}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/admin/support/${t._id}`);
                          }}
                          className="px-3 py-1.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-lg hover:bg-primary-container transition-colors"
                        >
                          Inspect Ticket
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
