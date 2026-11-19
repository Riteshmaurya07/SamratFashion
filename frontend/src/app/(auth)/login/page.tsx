"use client";

import { useState, useEffect, Suspense } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { sanitizeLoginRedirect } from "@/lib/authRedirect";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function getSignInContextMessage(reason: string | null, redirect: string | null): string {
  if (reason === "wishlist" || redirect?.startsWith("/account/wishlist")) {
    return "Sign in is required to save items and view your wishlist.";
  }
  if (reason === "cart" || redirect?.startsWith("/cart") || reason === "checkout" || redirect?.startsWith("/checkout")) {
    return "Sign in is required to shop — add items to your bag and check out.";
  }
  if (reason === "orders" || redirect?.startsWith("/account/orders")) {
    return "Sign in to view your order history, shipments, and invoices.";
  }
  if (reason === "product" || redirect?.startsWith("/shop/")) {
    return "Sign in is required to shop — you'll return right to this product after signing in.";
  }
  return "Sign in is required to shop, save wishlists, and view your orders.";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawRedirect = searchParams.get("redirect");
  const reason = searchParams.get("reason");
  const isExpired = searchParams.get("expired") === "true";
  const redirectTarget = sanitizeLoginRedirect(rawRedirect);
  const { setUser, isAuthenticated, isLoading: authLoading } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [apiError, setApiError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace(rawRedirect ? redirectTarget : "/account");
    }
  }, [authLoading, isAuthenticated, rawRedirect, redirectTarget, router]);

  const contextMessage = getSignInContextMessage(reason, rawRedirect);
  const registerHref = rawRedirect
    ? `/register?redirect=${encodeURIComponent(redirectTarget)}`
    : "/register";

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormValues) => {
    try {
      setIsLoading(true);
      setApiError("");

      const response = await api.post("/auth/login", data);

      if (response.data.success) {
        setUser(response.data.data.user);
        Promise.all([
          useCartStore.getState().fetchCart().catch(() => {}),
          useWishlistStore.getState().fetchWishlist().catch(() => {}),
        ]);
        router.push(redirectTarget);
      }
    } catch (error: unknown) {
      let msg = "An unexpected error occurred. Please try again.";
      if (error && typeof error === "object" && "response" in error) {
        const resp = error.response as { data?: { message?: string } };
        if (resp?.data?.message) msg = resp.data.message;
      }
      setApiError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading || isAuthenticated) {
    return (
      <AuthPageShell backHref="/" backLabel="Back to store">
        <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-sm p-8 flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-on-surface-variant">
            {isAuthenticated ? "You are already signed in. Redirecting…" : "Checking your session…"}
          </p>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell backHref="/" backLabel="Back to store">
      <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 sm:p-8 space-y-5 sm:space-y-6">
          <div className="text-center space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold">
              SAMRAT FASHION
            </p>
            <h1 className="text-2xl sm:text-3xl font-black font-headline-lg uppercase tracking-tight text-on-surface">
              SIGN IN
            </h1>
            <p className="text-xs font-mono text-on-surface-variant">
              ACCESS YOUR BAG, WISHLIST &amp; ORDERS
            </p>
          </div>

          {/* Clear explanation of why sign-in is required */}
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-surface-container-low border border-outline-variant/40 text-xs text-on-surface-variant leading-relaxed">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <span>
              {isExpired
                ? "Your session expired. Sign in again to continue shopping."
                : contextMessage}
            </span>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {apiError && (
              <div className="p-3 text-sm bg-red-50 text-red-500 border border-red-200 rounded-md">
                {apiError}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="customer-email">
                Email Address
              </label>
              <input
                id="customer-email"
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base sm:text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-xs text-red-500">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" htmlFor="customer-password">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="customer-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base sm:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pr-10"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-red-500">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full h-12 font-mono uppercase tracking-wider font-bold text-xs" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Sign In
            </Button>
          </form>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-outline-variant/40" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-surface-container-lowest px-2 text-muted-foreground font-mono">
                Or continue with
              </span>
            </div>
          </div>

          <GoogleAuthButton
            label="Continue with Google"
            redirectTo={redirectTarget}
            onError={(err) => setApiError(err)}
          />

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href={registerHref}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </AuthPageShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}
