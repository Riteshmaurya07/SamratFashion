import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "link" | "cobalt" | "dark";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-neutral-900 text-white font-mono text-xs uppercase tracking-wider font-bold shadow-sm hover:bg-neutral-800":
              variant === "default" || variant === "dark",
            "bg-primary text-white font-mono text-xs uppercase tracking-wider font-bold shadow-sm hover:bg-primary/90":
              variant === "cobalt",
            "border border-neutral-300 bg-transparent text-neutral-900 font-mono text-xs uppercase tracking-wider font-bold hover:bg-neutral-900 hover:text-white":
              variant === "outline",
            "hover:bg-neutral-100 text-neutral-900 font-mono text-xs uppercase tracking-wider": variant === "ghost",
            "text-primary underline-offset-4 hover:underline font-mono text-xs uppercase tracking-wider": variant === "link",
            "h-9 px-4 py-2": size === "default",
            "h-8 rounded-md px-3 text-xs": size === "sm",
            "h-10 rounded-md px-8": size === "lg",
            "h-9 w-9": size === "icon",
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
