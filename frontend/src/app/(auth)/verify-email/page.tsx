"use client";

import React, { useState, useEffect, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle2, AlertCircle, Mail, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

function extractErrorMessage(err: unknown, defaultMessage: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const response = err.response;
    if (response && typeof response === "object" && "data" in response) {
      const data = response.data;
      if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
        return data.message;
      }
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return defaultMessage;
}

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const emailParam = searchParams.get("email") || "";

  const { setUser } = useAuthStore();

  const [email, setEmail] = useState(emailParam);
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoVerifying, setIsAutoVerifying] = useState(Boolean(token));
  const [apiError, setApiError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isResending, setIsResending] = useState(false);

  // Countdown timer for resend code
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Handle direct link verification when token is in URL
  const verifyWithToken = useCallback(
    async (rawToken: string) => {
      try {
        setIsLoading(true);
        setIsAutoVerifying(true);
        setApiError("");

        const response = await api.post("/auth/verify-email", { token: rawToken });

        if (response.data.success) {
          if (response.data.data?.accessToken) {
            localStorage.setItem("accessToken", response.data.data.accessToken);
          }
          if (response.data.data?.user) {
            setUser(response.data.data.user);
          }
          setSuccessMessage("Your email has been verified successfully! Redirecting to your account...");
          setTimeout(() => {
            router.push("/account");
          }, 2000);
        }
      } catch (err: unknown) {
        setApiError(extractErrorMessage(err, "Failed to verify email. The link may be expired or invalid."));
      } finally {
        setIsLoading(false);
        setIsAutoVerifying(false);
      }
    },
    [router, setUser]
  );

  useEffect(() => {
    if (token) {
      verifyWithToken(token);
    }
  }, [token, verifyWithToken]);

  // Handle manual OTP submission
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) {
      setApiError("Please enter the 6-digit verification code.");
      return;
    }

    try {
      setIsLoading(true);
      setApiError("");
      setSuccessMessage("");

      const response = await api.post("/auth/verify-email", {
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
      });

      if (response.data.success) {
        if (response.data.data?.accessToken) {
          localStorage.setItem("accessToken", response.data.data.accessToken);
        }
        if (response.data.data?.user) {
          setUser(response.data.data.user);
        }
        setSuccessMessage("Your email has been verified successfully! Redirecting...");
        setTimeout(() => {
          router.push("/account");
        }, 1500);
      }
    } catch (err: unknown) {
      setApiError(extractErrorMessage(err, "Invalid verification code. Please check and try again."));
    } finally {
      setIsLoading(false);
    }
  };

  // Handle resend OTP
  const handleResendOtp = async () => {
    if (!email.trim() || resendCooldown > 0 || isResending) return;

    try {
      setIsResending(true);
      setApiError("");

      const response = await api.post("/auth/resend-verification", {
        email: email.trim().toLowerCase(),
      });

      if (response.data.success) {
        setSuccessMessage(response.data.message || "A new verification code has been sent.");
        setResendCooldown(60); // 60s cooldown
      }
    } catch (err: unknown) {
      setApiError(extractErrorMessage(err, "Failed to resend verification code. Please try again later."));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-surface px-4 py-16">
      <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-sm overflow-hidden">
        <div className="p-8 space-y-6">
          <div className="text-center space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold">THREADVIBE // SECURITY</p>
            <h1 className="text-2xl sm:text-3xl font-black font-headline-lg uppercase tracking-tight text-on-surface">
              VERIFY EMAIL
            </h1>
            <p className="text-xs font-mono text-on-surface-variant">
              CONFIRM YOUR EMAIL ADDRESS TO SECURE YOUR ACCOUNT
            </p>
          </div>

          {isAutoVerifying ? (
            <div className="py-10 text-center space-y-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
              <p className="text-sm text-on-surface-variant font-medium">
                Verifying your email address from secure link...
              </p>
            </div>
          ) : successMessage ? (
            <div className="space-y-6 text-center">
              <div className="p-4 bg-green-50 text-green-700 border border-green-200 rounded-md text-sm flex items-center justify-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                <span>{successMessage}</span>
              </div>
              <Link href="/account" className="block w-full">
                <Button className="w-full" variant="outline">
                  Go to Account Dashboard
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              {apiError && (
                <div className="p-3 text-sm bg-red-50 text-red-500 border border-red-200 rounded-md flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{apiError}</span>
                </div>
              )}

              <div className="p-3 bg-surface-container rounded-lg border border-outline-variant/30 flex items-center gap-3">
                <Mail className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-on-surface-variant uppercase font-mono font-semibold">
                    Verification Sent To
                  </div>
                  <div className="text-sm font-semibold truncate text-on-surface">
                    {email || "your registered email"}
                  </div>
                </div>
              </div>

              {!email && (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="email-input">
                    Email Address
                  </label>
                  <input
                    id="email-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              )}

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium" htmlFor="otp">
                    6-Digit Verification Code
                  </label>
                  <span className="text-xs text-muted-foreground font-mono">15 min expiry</span>
                </div>
                <input
                  id="otp"
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-center text-2xl font-mono tracking-[0.5em] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Check your inbox (or spam folder) for the 6-digit code or click the link in the email.
                </p>
              </div>

              <Button type="submit" className="w-full h-11" disabled={isLoading || otp.length < 6}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Verify Email
              </Button>

              <div className="pt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Didn&apos;t receive the email?</span>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendCooldown > 0 || isResending || !email}
                  className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline flex items-center gap-1"
                >
                  {isResending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCw className="h-3 w-3" />
                  )}
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
                </button>
              </div>
            </form>
          )}

          <div className="mt-8 text-center text-sm text-muted-foreground border-t border-outline-variant/30 pt-4">
            Already verified or have questions?{" "}
            <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[80vh] flex items-center justify-center bg-surface">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <VerifyEmailForm />
    </Suspense>
  );
}
