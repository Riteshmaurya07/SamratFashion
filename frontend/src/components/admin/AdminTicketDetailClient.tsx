"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Send,
  User,
  ShoppingBag,
  ExternalLink,
  Clock,
  ShieldAlert,
  AlertCircle,
  RefreshCw,
  ArrowDown,
  Phone,
} from "lucide-react";
import { api } from "@/lib/api";

interface Message {
  _id?: string;
  senderId?: {
    _id: string;
    name: string;
    role: string;
  };
  senderRole: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
  body: string;
  createdAt: string;
}

interface TicketDetail {
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
    phone?: string;
  };
  orderId?: {
    _id: string;
    orderNumber: string;
    status: string;
    total: number;
  };
  messages: Message[];
}

export default function AdminTicketDetailClient({ ticketId }: { ticketId: string }) {
  const router = useRouter();

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPollError, setIsPollError] = useState(false);

  const [replyBody, setReplyBody] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef<boolean>(true);

  // Helper to check scroll position
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isBottom = scrollHeight - scrollTop - clientHeight < 150;
    isNearBottomRef.current = isBottom;
    if (isBottom) {
      setHasNewMessagesBelow(false);
    }
  };

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    setHasNewMessagesBelow(false);
  }, []);

  // Fetch Ticket Detail
  const fetchTicket = useCallback(
    async (isBackground = false) => {
      try {
        const res = await api.get(`/admin/support/tickets/${ticketId}`);
        if (res.data?.success) {
          const freshTicket: TicketDetail = res.data.data;
          setIsPollError(false);

          setTicket((prev) => {
            if (!prev) return freshTicket;

            const prevMsgCount = prev.messages.length;
            const newMsgCount = freshTicket.messages.length;

            if (
              newMsgCount !== prevMsgCount ||
              freshTicket.status !== prev.status ||
              freshTicket.priority !== prev.priority
            ) {
              if (newMsgCount > prevMsgCount) {
                if (isNearBottomRef.current) {
                  setTimeout(() => scrollToBottom(true), 100);
                } else {
                  setHasNewMessagesBelow(true);
                }
              }
              return freshTicket;
            }
            return prev;
          });
        }
      } catch (err: unknown) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          if (status === 403 || status === 401) {
            router.push("/admin/login");
            return;
          }
          if (status === 404) {
            setError("Support ticket not found.");
            return;
          }
        }
        if (isBackground) {
          setIsPollError(true);
        } else {
          setError("Failed to load support ticket detail.");
        }
      } finally {
        if (!isBackground) {
          setIsLoading(false);
        }
      }
    },
    [ticketId, router, scrollToBottom]
  );

  // Initial Load
  useEffect(() => {
    setIsLoading(true);
    fetchTicket(false).then(() => {
      scrollToBottom(false);
    });
  }, [fetchTicket, scrollToBottom]);

  // Polling Loop (5000ms) with Visibility Control
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    const startPolling = () => {
      clearInterval(intervalId!);
      intervalId = setInterval(() => {
        if (document.visibilityState === "visible") {
          fetchTicket(true);
        }
      }, 5000);
    };

    startPolling();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchTicket(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(intervalId!);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchTicket]);

  // Update Status
  const handleUpdateStatus = async (newStatus: string) => {
    if (!ticket) return;
    setIsUpdating(true);
    setToast(null);

    try {
      const res = await api.patch(`/admin/support/tickets/${ticket._id}/status`, {
        status: newStatus,
      });

      if (res.data?.success) {
        setTicket((prev) => (prev ? { ...prev, status: newStatus } : null));
        setToast({ text: `Ticket status updated to ${newStatus}`, type: "success" });
      }
    } catch {
      setToast({ text: "Status update failed. Please try again.", type: "error" });
    } finally {
      setIsUpdating(false);
    }
  };

  // Update Priority
  const handleUpdatePriority = async (newPriority: string) => {
    if (!ticket) return;
    setIsUpdating(true);
    setToast(null);

    try {
      const res = await api.patch(`/admin/support/tickets/${ticket._id}/priority`, {
        priority: newPriority,
      });

      if (res.data?.success) {
        setTicket((prev) => (prev ? { ...prev, priority: newPriority } : null));
        setToast({ text: `Priority updated to ${newPriority}`, type: "success" });
      }
    } catch {
      setToast({ text: "Priority update failed. Please try again.", type: "error" });
    } finally {
      setIsUpdating(false);
    }
  };

  // Send Admin Reply
  const handleSendReply = async () => {
    if (!replyBody.trim() || !ticket) return;
    setIsUpdating(true);
    setToast(null);

    const messageText = replyBody.trim();
    setReplyBody("");

    try {
      const res = await api.post(`/admin/support/tickets/${ticket._id}/messages`, {
        body: messageText,
      });

      if (res.data?.success) {
        setTicket(res.data.data);
        setToast({ text: "Admin reply sent to customer", type: "success" });
        setTimeout(() => scrollToBottom(true), 100);
      }
    } catch {
      setReplyBody(messageText);
      setToast({ text: "Failed to send reply. Please try again.", type: "error" });
    } finally {
      setIsUpdating(false);
    }
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case "RESOLVED":
      case "CLOSED":
        return "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300";
      case "IN_PROGRESS":
        return "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300";
      case "WAITING_FOR_CUSTOMER":
        return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300";
      default:
        return "bg-neutral-100 text-neutral-800 border-neutral-300 dark:bg-neutral-800 dark:text-neutral-300";
    }
  };

  const getPriorityBadge = (pr: string) => {
    switch (pr) {
      case "HIGH":
        return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400";
      case "MEDIUM":
        return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400";
      default:
        return "bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-400";
    }
  };

  if (isLoading) {
    return (
      <main className="w-full max-w-5xl mx-auto px-4 py-16 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-surface-container-high border border-outline-variant/40 flex items-center justify-center mb-4">
          <RefreshCw className="w-6 h-6 text-primary animate-spin" />
        </div>
        <h2 className="font-headline-sm text-lg font-bold text-on-surface">
          Loading support ticket...
        </h2>
        <p className="font-body-sm text-xs text-neutral-500 mt-1">
          Syncing conversation history and order diagnostics.
        </p>
      </main>
    );
  }

  if (error || !ticket) {
    return (
      <main className="w-full max-w-xl mx-auto px-4 py-16">
        <div className="bg-surface border border-outline-variant/40 rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h2 className="font-headline-sm text-xl font-bold text-on-surface">
            {error || "Ticket not found."}
          </h2>
          <p className="text-xs text-neutral-500">
            The requested support ticket does not exist or has been archived.
          </p>
          <Link
            href="/admin/support"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-neutral-950 text-white rounded-lg font-mono text-xs uppercase font-bold hover:bg-neutral-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Queue</span>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6 w-full">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-20 right-4 sm:right-6 z-50 px-5 py-3 rounded-xl shadow-xl text-white font-mono text-xs font-bold transition-all ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Poll Connection Warning Indicator */}
      {isPollError && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 p-3 rounded-xl text-xs font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>Live sync disconnected — retrying server connection...</span>
          </div>
          <button
            type="button"
            onClick={() => fetchTicket(true)}
            className="font-bold underline hover:text-neutral-950 text-[11px]"
          >
            Retry Now
          </button>
        </div>
      )}

      {/* Navigation Breadcrumb */}
      <div>
        <Link
          href="/admin/support"
          className="inline-flex items-center gap-1.5 text-on-surface-variant hover:text-primary transition-colors font-mono text-xs uppercase font-bold"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Support Queue</span>
        </Link>
      </div>

      {/* Ticket Header & Status Machine Card */}
      <section className="bg-surface-container-lowest p-4 sm:p-6 rounded-2xl border border-outline-variant/30 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-md border border-primary/20">
                {ticket.ticketNumber}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold uppercase border ${getStatusBadge(ticket.status)}`}>
                {ticket.status.replace(/_/g, " ")}
              </span>
              <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase border ${getPriorityBadge(ticket.priority)}`}>
                {ticket.priority} Priority
              </span>
              <span className="px-2 py-0.5 rounded bg-surface-container-high text-neutral-600 font-mono text-[10px] font-bold uppercase">
                {ticket.category}
              </span>
            </div>

            <h1 className="font-headline-lg text-lg sm:text-2xl font-black text-on-surface uppercase tracking-tight leading-snug">
              {ticket.subject}
            </h1>

            <p className="font-mono text-xs text-neutral-500">
              Opened on: {new Date(ticket.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </div>

          {/* Workflow State Transition Controls */}
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto pt-2 lg:pt-0 border-t lg:border-t-0 border-outline-variant/20">
            <select
              value={ticket.priority}
              onChange={(e) => handleUpdatePriority(e.target.value)}
              disabled={isUpdating}
              aria-label="Update ticket priority"
              className="flex-1 sm:flex-none px-3 py-2 bg-surface-container-low border border-outline-variant/60 rounded-lg text-xs font-mono font-bold text-on-surface focus:outline-none min-h-[40px] uppercase"
            >
              <option value="LOW">Priority: Low</option>
              <option value="MEDIUM">Priority: Medium</option>
              <option value="HIGH">Priority: High</option>
            </select>

            <button
              type="button"
              onClick={() => handleUpdateStatus("IN_PROGRESS")}
              disabled={isUpdating || ticket.status === "IN_PROGRESS"}
              className="flex-1 sm:flex-none px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs uppercase font-bold rounded-lg transition-colors disabled:opacity-40 min-h-[40px]"
            >
              In Progress
            </button>

            <button
              type="button"
              onClick={() => handleUpdateStatus("RESOLVED")}
              disabled={isUpdating || ticket.status === "RESOLVED"}
              className="flex-1 sm:flex-none px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs uppercase font-bold rounded-lg transition-colors disabled:opacity-40 min-h-[40px]"
            >
              Resolve
            </button>

            <button
              type="button"
              onClick={() => handleUpdateStatus("CLOSED")}
              disabled={isUpdating || ticket.status === "CLOSED"}
              className="flex-1 sm:flex-none px-3.5 py-2 border border-outline-variant/60 text-on-surface hover:bg-surface-container font-mono text-xs uppercase font-bold rounded-lg transition-colors disabled:opacity-40 min-h-[40px]"
            >
              Close
            </button>
          </div>
        </div>
      </section>

      {/* Main Grid: Responsive Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
        {/* Mobile-First: Customer & Order Quick Reference (displayed on top for mobile, sidebar on desktop) */}
        <div className="lg:hidden space-y-4">
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-4 shadow-xs space-y-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-primary" />
              <span>Customer Reference</span>
            </h3>

            <div className="space-y-1 text-xs">
              <p className="font-semibold text-on-surface text-sm">{ticket.userId?.name || "Customer"}</p>
              <p className="text-neutral-500 font-mono text-[11px] truncate">{ticket.userId?.email || "—"}</p>
              {ticket.userId?.phone && (
                <p className="text-neutral-600 font-mono text-[11px] flex items-center gap-1 pt-0.5">
                  <Phone className="w-3 h-3 text-neutral-400" />
                  <span>+91 {ticket.userId.phone}</span>
                </p>
              )}
            </div>

            {ticket.orderId && (
              <div className="pt-2 border-t border-outline-variant/20 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-neutral-400 uppercase font-mono block">Linked Order</span>
                  <span className="font-mono text-xs font-bold text-primary">#{ticket.orderId.orderNumber}</span>
                </div>
                <Link
                  href={`/admin/orders/${ticket.orderId._id}`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-neutral-950 text-white rounded-md font-mono text-[11px] uppercase font-bold hover:bg-neutral-800 transition-colors"
                >
                  <span>Inspect</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Left Column: Conversation Message Thread (8 cols on desktop) */}
        <div className="lg:col-span-8 flex flex-col gap-4 sm:gap-5">
          {/* Thread Header */}
          <div className="flex items-center justify-between text-xs font-mono text-neutral-500 px-1">
            <span>Conversation Thread ({ticket.messages.length} messages)</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>Real-time Sync Active</span>
            </span>
          </div>

          {/* Messages Scroll Canvas */}
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="space-y-3.5 min-h-[340px] max-h-[620px] overflow-y-auto pr-1 p-1"
          >
            {ticket.messages.length === 0 ? (
              <div className="p-8 text-center bg-surface-container-lowest border border-outline-variant/30 rounded-2xl text-xs font-mono text-neutral-400">
                No messages recorded in this ticket.
              </div>
            ) : (
              ticket.messages.map((msg, idx) => {
                const isAdmin = msg.senderRole === "ADMIN" || msg.senderRole === "SUPER_ADMIN";
                return (
                  <div
                    key={msg._id || `msg_${idx}_${msg.createdAt}`}
                    className={`flex flex-col ${isAdmin ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[92%] sm:max-w-[80%] p-4 sm:p-5 rounded-2xl shadow-xs text-xs sm:text-sm space-y-2 ${
                        isAdmin
                          ? "bg-neutral-950 text-white rounded-br-none"
                          : "bg-surface-container-lowest border border-outline-variant/40 text-on-surface rounded-bl-none"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 text-[11px] font-mono opacity-80 border-b border-white/10 pb-1.5">
                        <span className="font-bold flex items-center gap-1">
                          {isAdmin ? (
                            <>
                              <ShieldAlert className="w-3 h-3 text-emerald-400" />
                              <span>Support Agent</span>
                            </>
                          ) : (
                            <>
                              <User className="w-3 h-3 text-primary" />
                              <span>{ticket.userId?.name || "Customer"}</span>
                            </>
                          )}
                        </span>
                        <span className="text-[10px]">
                          {new Date(msg.createdAt).toLocaleTimeString("en-IN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Floating New Messages Indicator */}
          {hasNewMessagesBelow && (
            <button
              type="button"
              onClick={() => scrollToBottom(true)}
              className="sticky bottom-4 mx-auto bg-neutral-950 text-white px-4 py-2 rounded-full shadow-2xl text-xs font-mono font-bold flex items-center gap-1.5 animate-bounce z-20"
            >
              <span>New messages below</span>
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Admin Reply Box */}
          <div className="bg-surface-container-lowest p-4 sm:p-5 rounded-2xl border border-outline-variant/30 shadow-xs space-y-3">
            <label className="block font-mono text-[11px] uppercase font-bold text-neutral-500">
              Reply to Customer
            </label>
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleSendReply();
                }
              }}
              rows={3}
              className="w-full bg-surface-container-low border border-outline-variant/60 rounded-xl p-3.5 text-xs sm:text-sm text-on-surface focus:outline-none focus:border-neutral-950 resize-none font-body-sm"
              placeholder="Type your official administrative response (Ctrl+Enter to send)..."
            />
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
              <span className="text-[11px] font-mono text-neutral-400 hidden sm:block">
                Press Ctrl+Enter to send reply directly
              </span>
              <button
                type="button"
                onClick={handleSendReply}
                disabled={isUpdating || !replyBody.trim()}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-neutral-950 hover:bg-neutral-800 text-white font-mono text-xs uppercase font-bold rounded-xl transition-all shadow-sm disabled:opacity-50 min-h-[40px]"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isUpdating ? "Sending..." : "Send Admin Reply"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Customer & Linked Order Diagnostics (4 cols on desktop) */}
        <div className="hidden lg:block lg:col-span-4 space-y-5">
          {/* Customer Profile Card */}
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-5 shadow-xs space-y-4">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
              <User className="w-4 h-4 text-primary" />
              <span>Customer Profile</span>
            </h3>

            <div className="space-y-2.5 text-xs">
              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-mono block">Customer Name</span>
                <strong className="text-on-surface text-sm">{ticket.userId?.name || "Customer"}</strong>
              </div>

              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-mono block">Email Address</span>
                <p className="font-mono text-xs text-on-surface truncate">{ticket.userId?.email || "—"}</p>
              </div>

              {ticket.userId?.phone && (
                <div>
                  <span className="text-[10px] text-neutral-400 uppercase font-mono block">Mobile Phone</span>
                  <p className="font-mono text-xs text-on-surface">+91 {ticket.userId.phone}</p>
                </div>
              )}
            </div>

            {/* Linked Order Card */}
            {ticket.orderId ? (
              <div className="pt-4 border-t border-outline-variant/20 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-mono text-xs font-bold uppercase text-neutral-600 flex items-center gap-1.5">
                    <ShoppingBag className="w-3.5 h-3.5 text-primary" />
                    <span>Linked Order</span>
                  </h4>
                  <span className="font-mono text-xs font-bold text-primary">
                    #{ticket.orderId.orderNumber}
                  </span>
                </div>

                <div className="p-3 bg-surface-container-low rounded-xl border border-outline-variant/20 text-xs font-mono space-y-1">
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Status</span>
                    <span className="font-bold text-on-surface">{ticket.orderId.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Total Value</span>
                    <span className="font-bold text-neutral-900">₹{ticket.orderId.total?.toLocaleString("en-IN")}</span>
                  </div>
                </div>

                <Link
                  href={`/admin/orders/${ticket.orderId._id}`}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 text-on-surface rounded-xl font-mono text-xs uppercase font-bold transition-colors"
                >
                  <span>Inspect Order Details</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>
            ) : (
              <div className="pt-4 border-t border-outline-variant/20 text-xs font-mono text-neutral-400 italic">
                No specific order attached to this inquiry.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
