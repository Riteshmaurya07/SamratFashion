"use client";

import { use } from "react";
import CouponForm from "@/components/admin/CouponForm";

export default function EditCouponPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  return <CouponForm couponId={resolvedParams.id} />;
}
