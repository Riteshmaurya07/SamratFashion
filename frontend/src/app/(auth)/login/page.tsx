"use client";

import { useState, Suspense } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get("redirect") || "/account";
  const { setUser } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [apiError, setApiError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
        localStorage.setItem("accessToken", response.data.data.accessToken);
        setUser(response.data.data.user);
        router.push(redirectTarget);
      }
    } catch (error: any) {
      setApiError(
        error.response?.data?.message || "An unexpected error occurred. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-surface px-4 py-8 sm:py-16">
      <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 sm:p-8 space-y-5 sm:space-y-6">
          <div className="text-center space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold">THREADVIBE // STUDIO</p>
            <h1 className="text-2xl sm:text-3xl font-black font-headline-lg uppercase tracking-tight text-on-surface">
              SIGN IN
            </h1>
            <p className="text-xs font-mono text-on-surface-variant">
              ACCESS YOUR ORDERS, WISHLIST &amp; SAVED DESIGNS
            </p>
          </div>
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
                className="flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base sm:text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-xs text-red-500">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" htmlFor="password">
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
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base sm:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pr-10"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
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

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link
              href="/register"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}
