"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
      } catch (err: any) {
        if (err.response?.status === 403 || err.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        if (err.response?.status === 404) {
          setError("Support ticket not found.");
          return;
        }
        if (isBackground) {
          setIsPollError(true);
        } else {
          setError(err.response?.data?.message || "Failed to load support ticket detail.");
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
      if (intervalId) clearInterval(intervalId);
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
      if (intervalId) clearInterval(intervalId);
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
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Status update failed", type: "error" });
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
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Priority update failed", type: "error" });
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
    } catch (err: any) {
      setReplyBody(messageText);
      setToast({ text: err.response?.data?.message || "Failed to send reply", type: "error" });
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen flex items-center justify-center">
        <div className="text-center font-bold text-on-surface-variant">Loading support ticket...</div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen">
        <div className="p-6 bg-error-container text-on-error-container rounded-xl text-center font-bold">{error || "Ticket not found."}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-10 font-body-md pb-24 relative overflow-y-auto"
    >
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

      {/* Poll Connection Warning Indicator */}
      {isPollError && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 px-4 py-2 rounded-xl text-xs font-bold mb-4 flex items-center justify-between">
          <span>Connection interrupted — retrying live sync...</span>
          <button onClick={() => fetchTicket(true)} className="underline hover:text-primary">Retry Now</button>
        </div>
      )}

      {/* Breadcrumb Header */}
      <div className="flex items-center gap-2 text-xs font-label-caps text-on-surface-variant mb-6 uppercase tracking-widest">
        <Link href="/admin/support" className="hover:text-primary transition-colors">
          Support Queue
        </Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="text-primary font-bold">{ticket.ticketNumber}</span>
      </div>

      {/* Header Action Section */}
      <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm mb-8 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h1 className="font-headline-lg text-2xl md:text-3xl font-extrabold text-on-surface flex items-center gap-3">
            {ticket.subject}
            <span className="bg-surface-container-high text-on-surface font-label-caps text-xs px-3 py-1 rounded-full uppercase">
              {ticket.status}
            </span>
          </h1>
          <p className="text-xs text-on-surface-variant font-label-caps mt-1">
            Customer: {ticket.userId?.name || "Customer"} ({ticket.userId?.email}) • Ticket #{ticket.ticketNumber}
          </p>
        </div>

        {/* State Machine Transition Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={ticket.priority}
            onChange={(e) => handleUpdatePriority(e.target.value)}
            disabled={isUpdating}
            className="bg-surface-container-low border border-outline-variant rounded-xl px-3 py-2 text-xs font-bold text-on-surface outline-none"
          >
            <option value="LOW">Priority: Low</option>
            <option value="MEDIUM">Priority: Medium</option>
            <option value="HIGH">Priority: High</option>
          </select>

          <button
            onClick={() => handleUpdateStatus("IN_PROGRESS")}
            disabled={isUpdating || ticket.status === "IN_PROGRESS"}
            className="px-4 py-2 bg-blue-600 text-white font-label-caps text-xs font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40"
          >
            In Progress
          </button>
          <button
            onClick={() => handleUpdateStatus("RESOLVED")}
            disabled={isUpdating || ticket.status === "RESOLVED"}
            className="px-4 py-2 bg-emerald-600 text-white font-label-caps text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40"
          >
            Resolve
          </button>
          <button
            onClick={() => handleUpdateStatus("CLOSED")}
            disabled={isUpdating || ticket.status === "CLOSED"}
            className="px-4 py-2 border border-outline text-on-surface font-label-caps text-xs font-bold rounded-xl hover:bg-surface-container-low disabled:opacity-40"
          >
            Close
          </button>
        </div>
      </div>

      {/* Main 2-Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Conversation Thread (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="space-y-4">
            {ticket.messages.map((msg, idx) => {
              const isAdmin = msg.senderRole === "ADMIN" || msg.senderRole === "SUPER_ADMIN";
              return (
                <div key={msg._id || `msg_${idx}_${msg.createdAt}`} className={`flex flex-col ${isAdmin ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-2xl p-5 rounded-2xl shadow-sm text-sm ${
                      isAdmin
                        ? "bg-primary text-on-primary rounded-br-none"
                        : "bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-bl-none"
                    }`}
                  >
                    <div className="flex justify-between items-center gap-4 mb-2 text-xs font-label-caps opacity-90">
                      <span className="font-bold">{isAdmin ? "Admin Agent" : ticket.userId?.name || "Customer"}</span>
                      <span>{new Date(msg.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* New Messages Floating Indicator */}
          {hasNewMessagesBelow && (
            <button
              onClick={() => scrollToBottom(true)}
              className="fixed bottom-32 right-12 z-40 bg-primary text-on-primary px-4 py-2 rounded-full shadow-2xl text-xs font-bold flex items-center gap-2 animate-bounce"
            >
              <span>New messages below</span>
              <span className="material-symbols-outlined text-sm">arrow_downward</span>
            </button>
          )}

          {/* Admin Reply Input Box */}
          <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm flex flex-col gap-3">
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              rows={3}
              className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary resize-none"
              placeholder="Write an administrative reply to the customer..."
            />
            <div className="flex justify-end">
              <button
                onClick={handleSendReply}
                disabled={isUpdating || !replyBody.trim()}
                className="px-6 py-2.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md disabled:opacity-50 flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-base">send</span>
                {isUpdating ? "Sending..." : "Send Admin Reply"}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Customer & Linked Order Details (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
            <h3 className="font-headline-sm text-lg font-bold text-on-surface">Customer Info</h3>
            <div className="text-xs space-y-2">
              <p>
                <strong className="text-on-surface-variant font-label-caps uppercase">Name:</strong> {ticket.userId?.name}
              </p>
              <p>
                <strong className="text-on-surface-variant font-label-caps uppercase">Email:</strong> {ticket.userId?.email}
              </p>
            </div>

            {ticket.orderId && (
              <div className="mt-4 pt-4 border-t border-outline-variant/20">
                <h4 className="font-bold text-sm text-on-surface mb-2">Linked Order</h4>
                <p className="text-xs font-label-caps font-bold text-primary">#{ticket.orderId.orderNumber}</p>
                <p className="text-xs text-on-surface-variant">Status: {ticket.orderId.status}</p>
                <Link
                  href={`/admin/orders/${ticket.orderId._id}`}
                  className="inline-block mt-3 px-3 py-1.5 bg-surface-container-high font-label-caps text-xs font-bold text-on-surface rounded-lg hover:bg-surface-variant transition-colors"
                >
                  Inspect Order
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
