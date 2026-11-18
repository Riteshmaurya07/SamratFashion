"use client";

import Link from "next/link";
import {
  ShoppingBag,
  Package,
  Heart,
  User,
  MapPin,
  Star,
  ShieldCheck,
  ArrowLeft,
  ArrowRight,
  LogIn,
} from "lucide-react";

type SignInContext =
  | "cart"
  | "account"
  | "orders"
  | "order-detail"
  | "wishlist"
  | "addresses"
  | "reviews"
  | "checkout";

const CONTEXT_CONFIG: Record<
  SignInContext,
  {
    icon: React.ComponentType<{ className?: string }>;
    eyebrow: string;
    title: string;
    description: string;
    reason: string;
  }
> = {
  cart: {
    icon: ShoppingBag,
    eyebrow: "SHOPPING BAG",
    title: "Sign in to continue",
    description:
      "Sign in to view your shopping bag, apply promo codes, and proceed to checkout.",
    reason: "cart",
  },
  account: {
    icon: User,
    eyebrow: "MY ACCOUNT",
    title: "Sign in to continue",
    description:
      "Sign in to access your account dashboard, orders, saved addresses, and wishlist.",
    reason: "account",
  },
  orders: {
    icon: Package,
    eyebrow: "MY ORDERS",
    title: "Sign in to continue",
    description:
      "Sign in to view your order history, track active shipments, and download GST invoices.",
    reason: "orders",
  },
  "order-detail": {
    icon: Package,
    eyebrow: "ORDER DETAILS",
    title: "Sign in to continue",
    description:
      "Sign in to view this order's status, shipment timeline, and invoice.",
    reason: "orders",
  },
  wishlist: {
    icon: Heart,
    eyebrow: "SAVED WISHLIST",
    title: "Sign in to continue",
    description:
      "Sign in to view your saved pieces and move your favorites straight to your bag.",
    reason: "wishlist",
  },
  addresses: {
    icon: MapPin,
    eyebrow: "ADDRESS BOOK",
    title: "Sign in to continue",
    description:
      "Sign in to manage your saved shipping addresses for faster checkout.",
    reason: "account",
  },
  reviews: {
    icon: Star,
    eyebrow: "MY REVIEWS",
    title: "Sign in to continue",
    description:
      "Sign in to view your submitted reviews and rate your delivered orders.",
    reason: "account",
  },
  checkout: {
    icon: ShieldCheck,
    eyebrow: "SECURE CHECKOUT",
    title: "Sign in to continue",
    description:
      "An account is required to place an order, choose a delivery address, and complete payment.",
    reason: "checkout",
  },
};

interface SignInRequiredStateProps {
  context: SignInContext;
  redirectPath: string;
}

export function SignInRequiredState({
  context,
  redirectPath,
}: SignInRequiredStateProps) {
  const config = CONTEXT_CONFIG[context];
  const Icon = config.icon;
  const encodedRedirect = encodeURIComponent(redirectPath);
  const loginHref = `/login?redirect=${encodedRedirect}&reason=${config.reason}`;
  const registerHref = `/register?redirect=${encodedRedirect}`;

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 sm:py-24 flex items-center justify-center">
      <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-6 sm:p-10 text-center shadow-sm space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-surface-container text-on-surface flex items-center justify-center mx-auto border border-outline-variant/30">
          <Icon className="w-7 h-7 stroke-[1.75]" />
        </div>

        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary font-bold">
            {config.eyebrow}
          </p>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">
            {config.title}
          </h1>
          <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
            {config.description}
          </p>
        </div>

        <div className="pt-2 space-y-2.5">
          <Link
            href={loginHref}
            className="w-full h-12 bg-neutral-950 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg hover:bg-neutral-800 transition-colors shadow-sm flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Sign In to Continue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>

          <Link
            href={registerHref}
            className="w-full h-11 border border-outline-variant/60 text-on-surface font-mono text-xs uppercase tracking-wider font-bold rounded-lg hover:bg-surface-container-low transition-colors flex items-center justify-center"
          >
            Create an Account
          </Link>
        </div>

        <div className="pt-3 border-t border-outline-variant/20">
          <Link
            href="/shop"
            className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider font-bold text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to store</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
