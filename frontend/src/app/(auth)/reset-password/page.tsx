"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const passwordSchema = z.string().min(8, "Password must be at least 8 characters long")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
  confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token") || "";
  const [manualToken, setManualToken] = useState(tokenFromUrl);
  
  const [showPassword, setShowPassword] = useState(false);
  const hasToken = Boolean(tokenFromUrl || manualToken.trim());
  const [apiError, setApiError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (tokenFromUrl) {
      setManualToken(tokenFromUrl);
    }
  }, [tokenFromUrl]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const onSubmit = async (data: ResetPasswordFormValues) => {
    const effectiveToken = (tokenFromUrl || manualToken).trim();
    if (!effectiveToken) {
      setApiError("Reset token is required. Please check the link in your email or paste your token below.");
      return;
    }
    
    try {
      setIsLoading(true);
      setApiError("");
      
      const response = await api.post("/auth/reset-password", {
        token: effectiveToken,
        newPassword: data.newPassword,
      });
      
      if (response.data.success) {
        setSuccessMessage(response.data.message);
        setTimeout(() => {
          router.push("/login");
        }, 2500);
      }
    } catch (error: unknown) {
      let msg = "An unexpected error occurred. Please try again.";
      if (error && typeof error === "object" && "response" in error) {
        const resp = error.response;
        if (resp && typeof resp === "object" && "data" in resp) {
          const dataObj = resp.data;
          if (dataObj && typeof dataObj === "object" && "message" in dataObj && typeof dataObj.message === "string") {
            msg = dataObj.message;
          }
        }
      } else if (error instanceof Error) {
        msg = error.message;
      }
      setApiError(msg);
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-surface px-4 py-16">
      <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-sm overflow-hidden">
        <div className="p-8 space-y-6">
          <div className="text-center space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold">THREADVIBE // SECURITY</p>
            <h1 className="text-2xl sm:text-3xl font-black font-headline-lg uppercase tracking-tight text-on-surface">
              NEW PASSWORD
            </h1>
            <p className="text-xs font-mono text-on-surface-variant">
              CHOOSE A STRONG NEW PASSWORD FOR YOUR ACCOUNT
            </p>
          </div>

          {successMessage ? (
            <div className="space-y-6 text-center">
              <div className="p-4 bg-green-50 text-green-700 border border-green-200 rounded-md text-sm">
                {successMessage}
              </div>
              <p className="text-sm text-muted-foreground">Redirecting to login...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {apiError && (
                <div className="p-3 text-sm bg-red-50 text-red-500 border border-red-200 rounded-md">
                  {apiError}
                </div>
              )}
              {!tokenFromUrl && (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="reset-token">
                    Reset Token / Code
                  </label>
                  <input
                    id="reset-token"
                    type="text"
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    placeholder="Paste reset token from email"
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="newPassword">
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pr-10"
                    {...register("newPassword")}
                    disabled={!hasToken}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    disabled={!hasToken}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.newPassword && <p className="text-xs text-red-500">{errors.newPassword.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="confirmPassword">
                  Confirm New Password
                </label>
                <input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register("confirmPassword")}
                  disabled={!hasToken}
                />
                {errors.confirmPassword && <p className="text-xs text-red-500">{errors.confirmPassword.message}</p>}
              </div>

              <Button type="submit" className="w-full h-11" disabled={isLoading || !hasToken}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Reset Password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
      <ResetPasswordForm />
    </React.Suspense>
  );
}
