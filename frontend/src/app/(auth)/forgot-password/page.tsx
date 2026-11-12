"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";
import { api } from "@/lib/api";

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [successMessage, setSuccessMessage] = useState("");
  const [devResetUrl, setDevResetUrl] = useState("");
  const [apiError, setApiError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const captchaRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordFormValues) => {
    if (captchaRequired && !captchaToken) {
      setApiError("CAPTCHA verification is still loading. Please wait a moment and try again.");
      return;
    }

    try {
      setIsLoading(true);
      setApiError("");
      setSuccessMessage("");
      setDevResetUrl("");

      const response = await api.post("/auth/forgot-password", {
        ...data,
        captchaToken: captchaToken || undefined,
      });
      
      if (response.data.success) {
        setSuccessMessage(response.data.message);
        const resetToken = response.data.data?.resetToken;
        if (typeof resetToken === "string" && resetToken) {
          const localResetUrl = new URL("/reset-password", window.location.origin);
          localResetUrl.searchParams.set("token", resetToken);
          setDevResetUrl(localResetUrl.toString());
        } else if (typeof response.data.data?.resetUrl === "string") {
          setDevResetUrl(response.data.data.resetUrl);
        }
      }
    } catch (error: unknown) {
      // Turnstile tokens are single-use; request a fresh one after any failure.
      setCaptchaToken("");
      setCaptchaResetKey((key) => key + 1);
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
              RESET PASSWORD
            </h1>
            <p className="text-xs font-mono text-on-surface-variant">
              ENTER YOUR ACCOUNT EMAIL TO RECEIVE PASSWORD RECOVERY INSTRUCTIONS
            </p>
          </div>

          {successMessage ? (
            <div className="space-y-6 text-center">
              <div className="p-4 bg-green-50 text-green-700 border border-green-200 rounded-md text-sm">
                {successMessage}
              </div>
              {devResetUrl && (
                <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg text-left space-y-2">
                  <div className="text-xs font-mono font-bold text-primary uppercase flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    Development Direct Link
                  </div>
                  <p className="text-xs text-on-surface-variant">
                    In local dev/mock mode, click below to open the reset password screen immediately:
                  </p>
                  <Link
                    href={devResetUrl}
                    className="inline-block text-xs font-semibold text-primary underline break-all hover:text-primary/80"
                  >
                    {devResetUrl}
                  </Link>
                </div>
              )}
              {!devResetUrl && process.env.NODE_ENV !== "production" && (
                <p className="text-xs text-on-surface-variant">
                  No local reset link was returned. Confirm this email belongs to an active account, then check the
                  browser Network response and backend email logs.
                </p>
              )}
              <Link href="/login" className="block w-full">
                <Button className="w-full" variant="outline">Return to Sign In</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {apiError && (
                <div className="p-3 text-sm bg-red-50 text-red-500 border border-red-200 rounded-md">
                  {apiError}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="email">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register("email")}
                />
                {errors.email && (
                  <p className="text-xs text-red-500">{errors.email.message}</p>
                )}
              </div>

              <TurnstileWidget
                action="forgot_password"
                resetKey={captchaResetKey}
                onToken={setCaptchaToken}
                onExpire={() => setCaptchaToken("")}
                onError={(message) => setApiError(message)}
              />

              <Button type="submit" className="w-full h-11" disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Send Reset Link
              </Button>
            </form>
          )}

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Remember your password?{" "}
            <Link
              href="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
