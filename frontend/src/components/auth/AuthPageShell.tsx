"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/ui/Navbar";
import { Footer } from "@/components/ui/Footer";
import { MotionProvider } from "@/components/providers/MotionProvider";

interface AuthPageShellProps {
  children: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}

export function AuthPageShell({
  children,
  backHref = "/",
  backLabel = "Back to store",
}: AuthPageShellProps) {
  return (
    <MotionProvider>
      <div className="min-h-screen flex flex-col bg-surface">
        <Navbar />
        <main className="flex-grow flex flex-col items-center justify-center px-4 py-8 sm:py-14">
          <div className="w-full max-w-md mb-4">
            <Link
              href={backHref}
              className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider font-bold text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{backLabel}</span>
            </Link>
          </div>
          {children}
        </main>
        <Footer />
      </div>
    </MotionProvider>
  );
}
