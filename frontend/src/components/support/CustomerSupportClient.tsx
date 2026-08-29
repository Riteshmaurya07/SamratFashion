"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface TicketItem {
  _id: string;
  ticketNumber: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  orderId?: {
    _id: string;
    orderNumber: string;
    status: string;
    total: number;
  };
}

interface RecentOrder {
  _id: string;
  orderNumber: string;
  status: string;
  total: number;
  createdAt: string;
  items: Array<{ productName: string }>;
}

export default function CustomerSupportClient() {
  const router = useRouter();

  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Create Ticket Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("ORDER");
  const [description, setDescription] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // FAQ Accordion State
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Fetch Customer Tickets & Recent Orders
  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get("/support/tickets");
        if (res.data?.success) {
          setTickets(res.data.data.tickets || []);
          setRecentOrders(res.data.data.recentOrders || []);
        }
      } catch (err: any) {
        if (err.response?.status === 401) {
          router.push("/login?redirect=/support");
          return;
        }
        setError(err.response?.data?.message || "Failed to load support center.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [router]);

  // Submit Create Ticket
  const handleCreateTicket = async () => {
    if (!subject.trim() || subject.trim().length < 5 || !description.trim() || description.trim().length < 10) return;
    setIsSubmitting(true);
    setToast(null);

    try {
      const res = await api.post("/support/tickets", {
        subject: subject.trim(),
        category,
        description: description.trim(),
        orderId: selectedOrderId || undefined,
      });

      if (res.data?.success) {
        setTickets([res.data.data, ...tickets]);
        setIsModalOpen(false);
        setSubject("");
        setDescription("");
        setSelectedOrderId("");
        setToast({ text: `Support ticket ${res.data.data.ticketNumber} created successfully!`, type: "success" });
        import("@/lib/analytics").then(({ trackEvent }) => {
          trackEvent("support_ticket_created", {
            ticket_number: res.data.data.ticketNumber,
            category: res.data.data.category,
          });
        });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to create ticket.", type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const categoriesList = [
    { key: "ORDER", label: "Orders", icon: "package_2" },
    { key: "PAYMENT", label: "Payment", icon: "payments" },
    { key: "DELIVERY", label: "Shipping", icon: "local_shipping" },
    { key: "RETURN", label: "Returns", icon: "assignment_return" },
    { key: "CUSTOM_PRINTING", label: "Custom", icon: "print" },
    { key: "OTHER", label: "Other", icon: "help_outline" },
  ];

  const faqs = [
    {
      q: "How do I track my order?",
      a: "You can track your order status in the 'Orders' section of your profile or use the tracking link sent via email once your order ships.",
    },
    {
      q: "What is the return policy?",
      a: "We accept return requests within 14 days of delivery for unworn items with original tags attached.",
    },
    {
      q: "How long does custom printing take?",
      a: "Custom T-shirt design production typically takes 2-3 business days plus 3-5 days standard delivery.",
    },
  ];

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-12 font-body-md pb-24">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-20 right-6 z-50 px-6 py-4 rounded-lg shadow-xl text-white font-medium transition-all ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Header Section (Stitch Match) */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h1 className="font-display-lg text-3xl md:text-5xl font-extrabold text-on-surface tracking-tight">
            Help & Support Center
          </h1>
          <p className="font-body-md text-on-surface-variant mt-1">
            How can we help you today? Search help topics, view recent orders, or open a support ticket.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-6 py-3 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-lg">add_circle</span>
          Create Support Ticket
        </button>
      </div>

      {/* Search Input (Stitch Screen Match) */}
      <div className="relative mb-8 max-w-2xl">
        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-surface-container-lowest border border-outline-variant rounded-2xl py-4 pl-12 pr-4 font-body-md text-sm outline-none focus:border-primary shadow-sm"
          placeholder="Search help topics, FAQs, ticket numbers..."
        />
      </div>

      {/* Categories Bento Grid (Stitch Screen Match) */}
      <div className="mb-10">
        <h3 className="font-label-caps text-xs uppercase tracking-widest text-on-surface-variant mb-4 font-bold">Topics</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {categoriesList.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setSelectedCategory(cat.key === selectedCategory ? "All" : cat.key)}
              className={`bg-surface-container-lowest border rounded-2xl p-4 flex flex-col items-center justify-center gap-2 transition-all hover:scale-105 shadow-sm ${
                selectedCategory === cat.key ? "border-primary text-primary bg-primary/5" : "border-outline-variant/30 text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-2xl text-primary">{cat.icon}</span>
              <span className="font-bold text-xs">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent Orders Horizontal Rail (Stitch Match) */}
      {recentOrders.length > 0 && (
        <div className="mb-10">
          <h3 className="font-label-caps text-xs uppercase tracking-widest text-on-surface-variant mb-4 font-bold">Recent Orders</h3>
          <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
            {recentOrders.map((ord) => (
              <div key={ord._id} className="w-64 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-4 flex-shrink-0 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-label-caps text-xs font-bold text-on-surface-variant">{ord.orderNumber}</span>
                    <span className="bg-primary/10 text-primary font-label-caps text-[10px] font-bold px-2 py-0.5 rounded">{ord.status}</span>
                  </div>
                  <p className="font-bold text-sm text-on-surface truncate">{ord.items[0]?.productName || "Order Item"}</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedOrderId(ord._id);
                    setIsModalOpen(true);
                  }}
                  className="mt-4 w-full py-2 border border-primary text-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary/5 transition-colors"
                >
                  Get Help with Order
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Support Tickets List */}
      <div className="mb-12">
        <h3 className="font-label-caps text-xs uppercase tracking-widest text-on-surface-variant mb-4 font-bold">Your Support Tickets</h3>
        {isLoading && <div className="p-8 text-center text-on-surface-variant font-bold">Loading support tickets...</div>}
        {error && <div className="p-4 bg-error-container text-on-error-container rounded-xl text-center font-bold mb-6">{error}</div>}

        {!isLoading && !error && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 overflow-hidden shadow-sm">
            {tickets.length === 0 ? (
              <div className="p-12 text-center text-on-surface-variant">
                <span className="material-symbols-outlined text-4xl text-outline mb-2">support_agent</span>
                <p className="font-bold text-on-surface">No open support tickets.</p>
                <p className="text-xs text-on-surface-variant mt-1">Need assistance? Click "Create Support Ticket" to get help.</p>
              </div>
            ) : (
              <div className="divide-y divide-outline-variant/20">
                {tickets.map((t) => (
                  <div
                    key={t._id}
                    onClick={() => router.push(`/support/${t._id}`)}
                    className="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:bg-surface-container-low transition-colors cursor-pointer"
                  >
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-bold font-label-caps text-primary text-sm">{t.ticketNumber}</span>
                        <span
                          className={`px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                            t.status === "RESOLVED" || t.status === "CLOSED"
                              ? "bg-emerald-100 text-emerald-800"
                              : t.status === "WAITING_FOR_CUSTOMER"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                      <h4 className="font-bold text-base text-on-surface">{t.subject}</h4>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Category: {t.category} {t.orderId ? `• Order #${t.orderId.orderNumber}` : ""} • Created {new Date(t.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button className="px-4 py-2 bg-surface-container-high text-on-surface font-label-caps text-xs font-bold rounded-xl hover:bg-surface-variant transition-colors">
                      View Thread
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Popular FAQs Accordion (Stitch Screen Match) */}
      <div className="bg-surface-container-lowest p-6 md:p-8 rounded-2xl border border-outline-variant/20 shadow-sm">
        <h3 className="font-label-caps text-xs uppercase tracking-widest text-on-surface-variant mb-4 font-bold">Popular FAQs</h3>
        <div className="divide-y divide-outline-variant/20">
          {faqs.map((faq, idx) => (
            <div key={idx} className="py-4">
              <button
                onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                className="w-full flex justify-between items-center text-left font-bold text-base text-on-surface"
              >
                <span>{faq.q}</span>
                <span className={`material-symbols-outlined text-lg transition-transform ${openFaq === idx ? "rotate-180" : ""}`}>
                  expand_more
                </span>
              </button>
              {openFaq === idx && <p className="text-sm text-on-surface-variant mt-3 leading-relaxed">{faq.a}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Create Ticket Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-background/50 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl border border-outline-variant/20 overflow-hidden flex flex-col">
            <div className="p-6 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low">
              <h3 className="font-bold text-lg text-on-surface">Create Support Ticket</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Subject (Min 5 chars)</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. Question regarding delivery status for order"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs font-bold text-on-surface focus:outline-none focus:border-primary"
                  >
                    <option value="ORDER">Orders</option>
                    <option value="PAYMENT">Payment</option>
                    <option value="DELIVERY">Shipping & Delivery</option>
                    <option value="RETURN">Returns & Exchange</option>
                    <option value="REFUND">Refund</option>
                    <option value="PRODUCT">Product Quality</option>
                    <option value="CUSTOM_PRINTING">Custom Printing</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Link Order (Optional)</label>
                  <select
                    value={selectedOrderId}
                    onChange={(e) => setSelectedOrderId(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs font-bold text-on-surface focus:outline-none focus:border-primary"
                  >
                    <option value="">None</option>
                    {recentOrders.map((o) => (
                      <option key={o._id} value={o._id}>
                        {o.orderNumber}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Description (Min 10 chars)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary resize-none"
                  placeholder="Provide detailed information regarding your inquiry..."
                />
              </div>
            </div>

            <div className="p-6 border-t border-outline-variant/10 bg-surface-container-low flex justify-end gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2.5 border border-outline-variant font-label-caps text-xs font-bold rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTicket}
                disabled={isSubmitting || subject.trim().length < 5 || description.trim().length < 10}
                className="px-6 py-2.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md disabled:opacity-50"
              >
                {isSubmitting ? "Creating..." : "Submit Ticket"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
