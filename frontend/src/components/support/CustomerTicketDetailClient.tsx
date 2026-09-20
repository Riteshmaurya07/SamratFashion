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
  orderId?: {
    _id: string;
    orderNumber: string;
    status: string;
    total: number;
  };
  messages: Message[];
}

export default function CustomerTicketDetailClient({ ticketId }: { ticketId: string }) {
  const router = useRouter();

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPollError, setIsPollError] = useState(false);

  const [replyBody, setReplyBody] = useState("");
  const [isSending, setIsSending] = useState(false);
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
        const res = await api.get(`/support/tickets/${ticketId}`);
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
        if (err.response?.status === 401) {
          router.push(`/login?redirect=/support/${ticketId}`);
          return;
        }
        if (err.response?.status === 403 || err.response?.status === 404) {
          setError(err.response?.data?.message || "Access denied or ticket not found.");
          return;
        }
        if (isBackground) {
          setIsPollError(true);
        } else {
          setError(err.response?.data?.message || "Failed to load support ticket.");
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

  // Send Customer Reply
  const handleSendReply = async () => {
    if (!replyBody.trim() || !ticket) return;
    setIsSending(true);
    setToast(null);

    const messageText = replyBody.trim();
    setReplyBody("");

    try {
      const res = await api.post(`/support/tickets/${ticket._id}/messages`, {
        body: messageText,
      });

      if (res.data?.success) {
        setTicket(res.data.data);
        setToast({ text: "Reply sent to support agent", type: "success" });
        setTimeout(() => scrollToBottom(true), 100);
      }
    } catch (err: any) {
      setReplyBody(messageText);
      setToast({ text: err.response?.data?.message || "Failed to send reply", type: "error" });
    } finally {
      setIsSending(false);
    }
  };

  // Close Ticket
  const handleCloseTicket = async () => {
    if (!ticket) return;
    setIsSending(true);
    try {
      const res = await api.post(`/support/tickets/${ticket._id}/close`);
      if (res.data?.success) {
        setTicket(res.data.data);
        setToast({ text: "Ticket marked as closed", type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to close ticket", type: "error" });
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen flex items-center justify-center">
        <div className="text-center font-bold text-on-surface-variant">Loading support ticket conversation...</div>
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
      className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-12 font-body-md pb-24 relative overflow-y-auto"
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
        <Link href="/support" className="hover:text-primary transition-colors">
          Support Center
        </Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="text-primary font-bold">{ticket.ticketNumber}</span>
      </div>

      {/* Ticket Header Section */}
      <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="font-headline-lg text-2xl font-bold text-on-surface">{ticket.subject}</span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                ticket.status === "RESOLVED" || ticket.status === "CLOSED"
                  ? "bg-emerald-100 text-emerald-800"
                  : ticket.status === "WAITING_FOR_CUSTOMER"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {ticket.status}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant font-label-caps mt-1">
            Category: {ticket.category} • Created {new Date(ticket.createdAt).toLocaleString()}
          </p>
          {ticket.orderId && (
            <Link
              href={`/account/orders/${ticket.orderId._id}`}
              className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline mt-2"
            >
              <span className="material-symbols-outlined text-sm">package_2</span>
              Linked Order #{ticket.orderId.orderNumber}
            </Link>
          )}
        </div>

        {ticket.status !== "CLOSED" && (
          <button
            onClick={handleCloseTicket}
            disabled={isSending}
            className="px-4 py-2 border border-outline text-on-surface font-label-caps text-xs font-bold rounded-xl hover:bg-surface-container-low transition-colors disabled:opacity-50"
          >
            Mark Ticket as Closed
          </button>
        )}
      </div>

      {/* Conversation Thread */}
      <div className="space-y-4 mb-8">
        {ticket.messages.map((msg, idx) => {
          const isCustomer = msg.senderRole === "CUSTOMER";
          return (
            <div
              key={msg._id || `msg_${idx}_${msg.createdAt}`}
              className={`flex flex-col ${isCustomer ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-2xl p-5 rounded-2xl shadow-sm text-sm ${
                  isCustomer
                    ? "bg-primary text-on-primary rounded-br-none"
                    : "bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-bl-none"
                }`}
              >
                <div className="flex justify-between items-center gap-4 mb-2 text-xs font-label-caps opacity-90">
                  <span className="font-bold">{isCustomer ? "You" : "SamratFashion Support Agent"}</span>
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

      {/* Reply Input Box */}
      {ticket.status !== "CLOSED" ? (
        <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm flex flex-col gap-3">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={3}
            className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary resize-none"
            placeholder="Type your reply to the support team..."
          />
          <div className="flex justify-end">
            <button
              onClick={handleSendReply}
              disabled={isSending || !replyBody.trim()}
              className="px-6 py-2.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md disabled:opacity-50 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-base">send</span>
              {isSending ? "Sending..." : "Send Reply"}
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 bg-surface-container-low rounded-2xl text-center text-xs font-bold text-on-surface-variant">
          This support ticket has been closed.
        </div>
      )}
    </div>
  );
}
