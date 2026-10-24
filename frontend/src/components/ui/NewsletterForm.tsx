"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email address");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      setError("Please enter a valid email address");
      return;
    }

    setError("");
    try {
      localStorage.setItem("threadvibe_newsletter_email", trimmed);
    } catch {
      // Ignore localStorage availability errors
    }
    setIsSubmitted(true);
  };

  if (isSubmitted) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-neutral-900 border border-neutral-800 rounded-lg p-3.5 space-y-2 mt-1"
      >
        <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs font-bold uppercase tracking-wider">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>Priority Alert Confirmed</span>
        </div>
        <p className="text-[11px] text-neutral-300 leading-relaxed">
          You&apos;re subscribed for drop notifications. Create an account to save sizes and track orders.
        </p>
        <Link
          href={`/register?email=${encodeURIComponent(email)}`}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:text-white transition-colors uppercase font-bold pt-1"
        >
          <span>Complete Member Profile</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-1.5 mt-1">
      <div className="flex max-w-sm">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError("");
          }}
          placeholder="Enter your email"
          aria-label="Email address for exclusive drops"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "newsletter-error" : undefined}
          className="bg-neutral-900 border border-neutral-800 text-white font-body-sm text-xs px-3.5 h-11 rounded-l-md focus:outline-none focus:border-primary w-full placeholder:text-neutral-500 focus-ring"
        />
        <button
          type="submit"
          aria-label="Subscribe to exclusive drops"
          className="bg-primary text-white px-5 h-11 rounded-r-md font-mono text-xs font-bold uppercase tracking-wider hover:bg-primary/90 active:scale-95 transition-all shrink-0 min-h-[44px] cursor-pointer"
        >
          JOIN
        </button>
      </div>
      {error && (
        <p id="newsletter-error" role="alert" className="text-red-400 font-mono text-[11px] pt-0.5">
          {error}
        </p>
      )}
    </form>
  );
}
