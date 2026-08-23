"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        const loginUrl = pathname.startsWith("/admin") ? "/admin/login" : "/login";
        router.replace(loginUrl);
      } else if (allowedRoles && user && !allowedRoles.includes(user.role)) {
        if (pathname.startsWith("/admin")) {
          router.replace("/admin/login");
        } else {
          router.replace("/account");
        }
      } else {
        setIsAuthorized(true);
      }
    }
  }, [isLoading, isAuthenticated, user, allowedRoles, router, pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface-container-lowest gap-3">
        <Loader2 className="w-9 h-9 animate-spin text-primary" />
        <span className="font-label-caps text-label-caps text-on-surface-variant">
          Authenticating...
        </span>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return <>{children}</>;
}
