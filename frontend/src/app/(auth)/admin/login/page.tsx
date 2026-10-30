"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

const adminLoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type AdminLoginFormValues = z.infer<typeof adminLoginSchema>;

export default function AdminLoginPage() {
  const router = useRouter();
  const { setUser } = useAuthStore();
  const [apiError, setApiError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AdminLoginFormValues>({
    resolver: zodResolver(adminLoginSchema),
  });

  const onSubmit = async (data: AdminLoginFormValues) => {
    try {
      setIsLoading(true);
      setApiError("");

      const response = await api.post("/auth/login", data);

      if (response.data.success) {
        const userRole = response.data.data.user.role;
        if (userRole === "ADMIN" || userRole === "SUPER_ADMIN") {
          localStorage.setItem("accessToken", response.data.data.accessToken);
          setUser(response.data.data.user);
          router.push("/admin");
        } else {
          await api.post("/auth/logout");
          setApiError("Access denied. Admin privileges required.");
        }
      }
    } catch (error: any) {
      setApiError(
        error.response?.data?.message ||
          "An unexpected error occurred. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(135deg, #f8f9fa 0%, #eef0ff 50%, #f8f9fa 100%)" }}
    >
      {/* Background grid accent */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(#004ac6 1px, transparent 1px), linear-gradient(90deg, #004ac6 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-primary text-on-primary mb-4 shadow-[0_12px_40px_rgba(0,74,198,0.3)]">
            <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              shield_person
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
            Admin Portal
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            SamratFashion Operations — Internal Management
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-[0_12px_40px_rgba(15,23,42,0.08)] overflow-hidden">
          {/* Card Header accent */}
          <div className="h-1 bg-primary w-full" />

          <div className="p-8">
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
              {apiError && (
                <div className="p-3 text-sm bg-error-container/20 text-error border border-error/20 rounded-lg flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">error_outline</span>
                  {apiError}
                </div>
              )}

              {/* Email */}
              <div className="flex flex-col gap-1.5">
                <label
                  className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider"
                  htmlFor="email"
                >
                  Email Address
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
                    mail
                  </span>
                  <input
                    id="email"
                    type="email"
                    placeholder="admin@samratfashion.com"
                    className="w-full pl-10 pr-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
                    {...register("email")}
                  />
                </div>
                {errors.email && (
                  <p className="font-body-sm text-[12px] text-error">{errors.email.message}</p>
                )}
              </div>

              {/* Password */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <label
                    className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider"
                    htmlFor="password"
                  >
                    Password
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-xs font-mono text-neutral-600 hover:text-neutral-950 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
                    lock
                  </span>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-12 py-3 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface transition-colors"
                    tabIndex={-1}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {showPassword ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
                {errors.password && (
                  <p className="font-body-sm text-[12px] text-error">{errors.password.message}</p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="mt-2 w-full flex items-center justify-center gap-2 py-3 bg-primary text-on-primary font-label-caps text-label-caps rounded-lg hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-60 shadow-[0_4px_16px_rgba(0,74,198,0.3)]"
              >
                {isLoading ? (
                  <>
                    <span className="material-symbols-outlined text-[18px] animate-spin">
                      progress_activity
                    </span>
                    Authenticating...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      lock_open
                    </span>
                    Secure Sign In
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center font-body-sm text-body-sm text-on-surface-variant mt-6">
          SamratFashion Admin &mdash; Restricted Access
        </p>
      </div>
    </div>
  );
}
