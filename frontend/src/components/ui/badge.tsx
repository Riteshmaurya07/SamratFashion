import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline" | "cobalt" | "success" | "error" | "warning";
}

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold tracking-wider uppercase transition-colors",
        {
          "bg-neutral-900 text-white shadow-xs": variant === "default",
          "bg-surface-container-high text-on-surface": variant === "secondary",
          "border border-outline-variant/80 text-on-surface bg-surface-container-lowest/80 backdrop-blur-xs":
            variant === "outline",
          "bg-primary text-white shadow-xs": variant === "cobalt",
          "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800":
            variant === "success",
          "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800":
            variant === "error",
          "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800":
            variant === "warning",
        },
        className
      )}
      {...props}
    />
  );
}
