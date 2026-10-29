"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import {
  Search,
  Plus,
  Package,
  CreditCard,
  Truck,
  RotateCcw,
  Printer,
  HelpCircle,
  MessageSquare,
  ChevronDown,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";

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
  const { isAuthenticated } = useAuthStore();

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

  // Fetch Customer Tickets & Recent Orders (allows guests to browse FAQs without 401 redirect)
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
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: { message?: string } } };
        if (e.response?.status === 401) {
          // Unauthenticated guest: allow viewing support center, FAQs, and topics
          setTickets([]);
          setRecentOrders([]);
          return;
        }
        setError(e.response?.data?.message || "Failed to load support center.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleOpenCreateTicket = (orderId?: string) => {
    if (!isAuthenticated) {
      router.push("/login?redirect=/support");
      return;
    }
    if (orderId) setSelectedOrderId(orderId);
    setIsModalOpen(true);
  };

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
        setToast({ text: `Ticket #${res.data.data.ticketNumber} created successfully!`, type: "success" });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setToast({ text: e.response?.data?.message || "Failed to create ticket.", type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const categoriesList = [
    { key: "ORDER", label: "Orders", icon: Package },
    { key: "PAYMENT", label: "Payment", icon: CreditCard },
    { key: "DELIVERY", label: "Shipping", icon: Truck },
    { key: "RETURN", label: "Exchange", icon: RotateCcw },
    { key: "CUSTOM_PRINTING", label: "Custom Print", icon: Printer },
    { key: "OTHER", label: "General", icon: HelpCircle },
  ];

  const allFaqs = [
    {
      category: "DELIVERY",
      q: "How do I track my order delivery?",
      a: "All orders are dispatched within 24–48 hours from New Delhi via Delhivery Express. You can view real-time tracking milestones in your 'Orders' section or through the tracking link sent via SMS and email.",
    },
    {
      category: "RETURN",
      q: "What is the size exchange and return policy?",
      a: "We offer a 7-day doorstep size exchange and return policy for unworn, unwashed garments with original tags intact. Simply initiate an exchange from your Order Details page.",
    },
    {
      category: "CUSTOM_PRINTING",
      q: "How long does custom Direct-to-Film (DTF) printing take?",
      a: "Custom apparel orders undergo digital proof verification by our studio within 24 hours. Once confirmed, high-density DTF printing and heat curing take 2 business days before express dispatch.",
    },
    {
      category: "PAYMENT",
      q: "What payment methods do you support?",
      a: "We support 100% encrypted checkout via Razorpay: UPI (Google Pay, PhonePe, Paytm, BHIM), all major Credit & Debit cards (Visa, MasterCard, RuPay), NetBanking, and Cash on Delivery where serviceable.",
    },
    {
      category: "ORDER",
      q: "How do I care for 240+ GSM heavyweight cotton garments?",
      a: "Machine wash cold inside-out with mild detergent. Avoid bleach or heavy tumble drying. For custom graphic tees, do not iron directly on the print to ensure 50+ wash durability.",
    },
  ];

  // Filtered FAQs by category and search query
  const filteredFaqs = useMemo(() => {
    return allFaqs.filter((faq) => {
      const matchesCategory = selectedCategory === "All" || faq.category === selectedCategory;
      const matchesSearch =
        !searchQuery.trim() ||
        faq.q.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        faq.a.toLowerCase().includes(searchQuery.toLowerCase().trim());
      return matchesCategory && matchesSearch;
    });
  }, [allFaqs, selectedCategory, searchQuery]);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 sm:space-y-12">
      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-20 right-4 sm:right-6 z-50 px-5 py-3.5 rounded-lg shadow-xl text-white font-mono text-xs font-bold transition-all flex items-center gap-2 ${
            toast.type === "success" ? "bg-neutral-950 border border-neutral-800" : "bg-red-600"
          }`}
        >
          {toast.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-white" />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 border-b border-outline-variant/30 pb-6">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl md:text-4xl font-black text-on-surface uppercase tracking-tight mb-1.5">
            HELP &amp; SUPPORT CENTER
          </h1>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant max-w-xl leading-relaxed">
            Fast assistance for orders, Delhivery tracking, size exchanges, and custom printing inquiries.
          </p>
        </div>
        <button
          onClick={() => handleOpenCreateTicket()}
          className="bg-neutral-950 text-white font-mono text-xs uppercase font-bold py-3 px-5 rounded-lg hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2 w-full sm:w-auto shadow-sm min-h-[44px] shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Create Support Ticket</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative w-full">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-surface-container-lowest border border-outline-variant/50 rounded-xl py-3 pl-10 pr-10 text-base sm:text-sm text-on-surface placeholder:text-neutral-400 focus:outline-none focus:border-neutral-900 transition-colors shadow-xs"
          placeholder="Search FAQs, tracking, size exchanges, custom printing..."
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-800 p-1"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Topics Grid */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-mono text-xs uppercase tracking-wider text-neutral-500 font-bold">HELP TOPICS</h3>
          {selectedCategory !== "All" && (
            <button
              onClick={() => setSelectedCategory("All")}
              className="font-mono text-[11px] text-neutral-600 hover:underline uppercase"
            >
              Reset Filter
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
          {categoriesList.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setSelectedCategory(isSelected ? "All" : cat.key)}
                className={`border rounded-xl p-3.5 sm:p-4 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer text-center ${
                  isSelected
                    ? "border-neutral-950 bg-neutral-950 text-white shadow-xs"
                    : "border-outline-variant/40 bg-surface-container-lowest text-on-surface hover:border-neutral-900 hover:bg-surface-container-low"
                }`}
              >
                <Icon className={`w-5 h-5 ${isSelected ? "text-white" : "text-neutral-700"}`} />
                <span className="font-mono text-xs font-bold uppercase tracking-tight">{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Recent Orders Rail (only shown if user has orders) */}
      {recentOrders.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-mono text-xs uppercase tracking-wider text-neutral-500 font-bold">YOUR RECENT ORDERS</h3>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar">
            {recentOrders.map((ord) => (
              <div
                key={ord._id}
                className="w-72 bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex-shrink-0 shadow-xs flex flex-col justify-between streetwear-card"
              >
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="font-mono text-xs font-bold text-on-surface">#{ord.orderNumber}</span>
                    <span className="bg-surface-container-high text-on-surface font-mono text-[9px] font-bold uppercase px-2 py-0.5 rounded">
                      {ord.status}
                    </span>
                  </div>
                  <p className="font-body-md text-xs text-on-surface-variant truncate">
                    {ord.items[0]?.productName || "Clothing Item"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenCreateTicket(ord._id)}
                  className="mt-3.5 w-full py-2 rounded-lg border border-outline-variant/60 hover:bg-surface-container text-xs font-mono font-bold uppercase text-on-surface transition-colors"
                >
                  Get Help with Order
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Support Tickets Section */}
      <div className="space-y-3">
        <h3 className="font-mono text-xs uppercase tracking-wider text-neutral-500 font-bold">YOUR SUPPORT TICKETS</h3>
        {isLoading ? (
          <div className="p-8 text-center text-on-surface-variant font-mono text-xs">Loading support tickets...</div>
        ) : error ? (
          <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl text-center text-xs font-mono font-bold">{error}</div>
        ) : !isAuthenticated ? (
          <div className="p-6 sm:p-8 text-center bg-surface-container-lowest rounded-xl border border-outline-variant/30 space-y-3">
            <MessageSquare className="w-8 h-8 text-neutral-400 mx-auto" />
            <h4 className="font-headline-sm text-base font-bold text-on-surface">Tracking an existing support request?</h4>
            <p className="text-xs text-on-surface-variant max-w-sm mx-auto">
              Sign in with your account email to view open tickets, staff replies, and resolution history.
            </p>
            <Link
              href="/login?redirect=/support"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-neutral-900 text-white font-mono text-xs uppercase font-bold rounded-lg hover:bg-neutral-800 transition-colors"
            >
              Sign In to View Tickets
            </Link>
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-8 sm:p-10 text-center bg-surface-container-lowest rounded-xl border border-outline-variant/30 space-y-2">
            <MessageSquare className="w-8 h-8 text-neutral-400 mx-auto mb-1" />
            <p className="font-headline-sm text-sm font-bold text-on-surface">No open support tickets.</p>
            <p className="text-xs text-on-surface-variant max-w-sm mx-auto">
              Need assistance with an order or custom print? Click &quot;Create Support Ticket&quot; above.
            </p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 overflow-hidden divide-y divide-outline-variant/20 shadow-xs">
            {tickets.map((t) => (
              <div
                key={t._id}
                onClick={() => router.push(`/support/${t._id}`)}
                className="p-4 sm:p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 hover:bg-surface-container-low transition-colors cursor-pointer group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                    <span className="font-mono text-xs font-bold text-neutral-950">#{t.ticketNumber}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                        t.status === "RESOLVED" || t.status === "CLOSED"
                          ? "bg-emerald-100 text-emerald-800"
                          : t.status === "WAITING_FOR_CUSTOMER"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {t.status}
                    </span>
                    <span className="font-mono text-[11px] text-neutral-400">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h4 className="font-bold text-sm text-on-surface truncate group-hover:text-primary transition-colors">
                    {t.subject}
                  </h4>
                  <p className="text-xs text-on-surface-variant mt-0.5 font-mono">
                    Category: {t.category} {t.orderId ? `• Order #${t.orderId.orderNumber}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="px-3.5 py-1.5 rounded border border-outline-variant/50 font-mono text-xs font-bold uppercase hover:bg-surface-container text-on-surface transition-colors shrink-0"
                >
                  View Thread &rarr;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Popular FAQs Accordion */}
      <div className="bg-surface-container-lowest p-5 sm:p-8 rounded-xl border border-outline-variant/30 space-y-4 shadow-xs">
        <div className="flex justify-between items-center border-b border-outline-variant/20 pb-3">
          <h3 className="font-mono text-xs uppercase tracking-wider text-neutral-500 font-bold">FREQUENTLY ASKED QUESTIONS</h3>
          <span className="font-mono text-[11px] text-neutral-400">{filteredFaqs.length} FAQs</span>
        </div>

        {filteredFaqs.length === 0 ? (
          <div className="py-8 text-center text-on-surface-variant text-xs space-y-2">
            <p>No FAQs match your search &quot;{searchQuery}&quot;.</p>
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory("All");
              }}
              className="text-neutral-900 font-mono font-bold uppercase underline"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/20">
            {filteredFaqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={idx} className="py-4">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex justify-between items-center text-left font-bold text-sm sm:text-base text-on-surface gap-4 cursor-pointer"
                  >
                    <span>{faq.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="text-xs sm:text-sm text-on-surface-variant mt-2.5 leading-relaxed font-body-sm">
                      {faq.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Ticket Modal Dialog */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl border border-outline-variant/30 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 sm:px-6 py-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-lowest sticky top-0 z-10">
              <h3 className="font-headline-sm text-base sm:text-lg font-bold text-on-surface uppercase tracking-tight">
                Create Support Ticket
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block font-mono text-[10px] uppercase font-bold text-neutral-500 mb-1.5">
                  Subject * (Min 5 chars)
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 transition-colors"
                  placeholder="e.g. Size exchange request for order"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[10px] uppercase font-bold text-neutral-500 mb-1.5">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2.5 text-xs font-mono font-bold text-on-surface focus:outline-none focus:border-neutral-900 transition-colors"
                  >
                    <option value="ORDER">Orders & Tracking</option>
                    <option value="PAYMENT">Payment & UPI</option>
                    <option value="DELIVERY">Shipping & Courier</option>
                    <option value="RETURN">Size Exchange & Returns</option>
                    <option value="REFUND">Refund Status</option>
                    <option value="PRODUCT">Garment Quality</option>
                    <option value="CUSTOM_PRINTING">Custom Printing Studio</option>
                    <option value="OTHER">Other Inquiry</option>
                  </select>
                </div>

                <div>
                  <label className="block font-mono text-[10px] uppercase font-bold text-neutral-500 mb-1.5">
                    Link Order (Optional)
                  </label>
                  <select
                    value={selectedOrderId}
                    onChange={(e) => setSelectedOrderId(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2.5 text-xs font-mono font-bold text-on-surface focus:outline-none focus:border-neutral-900 transition-colors"
                  >
                    <option value="">None</option>
                    {recentOrders.map((o) => (
                      <option key={o._id} value={o._id}>
                        #{o.orderNumber}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase font-bold text-neutral-500 mb-1.5">
                  Description * (Min 10 chars)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg p-3 text-base sm:text-sm text-on-surface focus:outline-none focus:border-neutral-900 transition-colors resize-none"
                  placeholder="Provide detailed information regarding your inquiry..."
                />
              </div>
            </div>

            <div className="p-4 sm:p-5 border-t border-outline-variant/20 bg-surface-container-lowest flex justify-end gap-3 sticky bottom-0">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2.5 border border-outline-variant/60 font-mono text-xs font-bold uppercase rounded-lg text-on-surface hover:bg-surface-container-low transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateTicket}
                disabled={isSubmitting || subject.trim().length < 5 || description.trim().length < 10}
                className="px-5 py-2.5 bg-neutral-950 text-white font-mono text-xs font-bold uppercase rounded-lg hover:bg-neutral-800 transition-colors shadow-sm disabled:opacity-40 flex items-center gap-2 min-h-[44px]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <span>Submit Ticket</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
