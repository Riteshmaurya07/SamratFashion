"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

const passwordSchema = z.string().min(8, "Password must be at least 8 characters long")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  password: passwordSchema,
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const { setUser } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [apiError, setApiError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormValues) => {
    try {
      setIsLoading(true);
      setApiError("");
      
      const payload = {
        name: data.name,
        email: data.email,
        phone: data.phone || undefined,
        password: data.password
      };
      
      const response = await api.post("/auth/register", payload);
      
      if (response.data.success) {
        if (response.data.data?.accessToken) {
          localStorage.setItem("accessToken", response.data.data.accessToken);
        }
        if (response.data.data?.user) {
          setUser(response.data.data.user);
        }
        router.push(`/verify-email?email=${encodeURIComponent(data.email)}`);
      }
    } catch (error: unknown) {
      let msg = "An unexpected error occurred. Please try again.";
      if (error && typeof error === "object" && "response" in error) {
        const resp = error.response;
        if (resp && typeof resp === "object" && "data" in resp) {
          const data = resp.data;
          if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
            msg = data.message;
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
    <div className="min-h-[85vh] flex items-center justify-center bg-surface px-4 py-8 sm:py-16">
      <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 sm:p-8 space-y-5 sm:space-y-6">
          <div className="text-center space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold">THREADVIBE // SAMRAT FASHION</p>
            <h1 className="text-2xl sm:text-3xl font-black font-headline-lg uppercase tracking-tight text-on-surface">
              CREATE ACCOUNT
            </h1>
            <p className="text-xs font-mono text-on-surface-variant">
              JOIN FOR EXCLUSIVE STREETWEAR DROPS &amp; SPECIAL MEMBER OFFERS
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && (
              <div className="p-3 text-sm bg-red-50 text-red-500 border border-red-200 rounded-md">
                {apiError}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="name">
                Full Name
              </label>
              <input
                id="name"
                type="text"
                placeholder="John Doe"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register("name")}
              />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="email">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                placeholder="name@example.com"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register("email")}
              />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="phone">
                Phone Number <span className="text-muted-foreground font-normal">(Optional)</span>
              </label>
              <input
                id="phone"
                type="tel"
                placeholder="+1234567890"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register("phone")}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pr-10"
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
              {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="confirmPassword">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pr-10"
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && <p className="text-xs text-red-500">{errors.confirmPassword.message}</p>}
            </div>

            <Button type="submit" className="w-full h-12 font-mono uppercase tracking-wider font-bold text-xs mt-2" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Account
            </Button>
          </form>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-outline-variant/40" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-surface-container-lowest px-2 text-muted-foreground font-mono">
                Or sign up with
              </span>
            </div>
          </div>

          <GoogleAuthButton
            label="Sign up with Google"
            redirectTo="/account"
            onError={(err) => setApiError(err)}
          />

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
