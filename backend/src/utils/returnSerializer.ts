/**
 * Customer-safe ReturnRequest serializer using an explicit allowlist.
 *
 * Ensures internal operational, reconciliation, refund-claim, and admin-only
 * fields (e.g. refundClaimToken, refundClaimExpiresAt, refundError,
 * requiresInventoryReconciliation, inventoryReconciliationReason, adminNote,
 * reviewedBy, internalNotes, packageDetails.confirmedBy, etc.) can never leak
 * through customer-facing return or order endpoints.
 */

export interface CustomerSafeReturnItem {
  productId: unknown;
  variantId: unknown;
  quantity: number;
  reason: string;
}

export interface CustomerSafePickupAddress {
  fullName?: string;
  phone?: string;
  alternatePhone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface CustomerSafeReturn {
  _id: unknown;
  orderId: unknown;
  items: CustomerSafeReturnItem[];
  status: string;
  customerNote?: string;
  refundId?: unknown;
  refundStatus?: string;
  requestedAt?: unknown;
  approvedAt?: unknown;
  receivedAt?: unknown;
  inspectedAt?: unknown;
  completedAt?: unknown;
  rejectedAt?: unknown;
  cancelledAt?: unknown;
  returnAwbNumber?: string;
  returnCarrier?: string;
  returnShippingMethod?: string;
  pickupAddress?: CustomerSafePickupAddress;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function serializePickupAddress(raw: unknown): CustomerSafePickupAddress | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const addr = raw as Record<string, unknown>;
  const out: CustomerSafePickupAddress = {};
  if (typeof addr.fullName === 'string') out.fullName = addr.fullName;
  if (typeof addr.phone === 'string') out.phone = addr.phone;
  if (typeof addr.alternatePhone === 'string') out.alternatePhone = addr.alternatePhone;
  if (typeof addr.addressLine1 === 'string') out.addressLine1 = addr.addressLine1;
  if (typeof addr.addressLine2 === 'string') out.addressLine2 = addr.addressLine2;
  if (typeof addr.city === 'string') out.city = addr.city;
  if (typeof addr.state === 'string') out.state = addr.state;
  if (typeof addr.postalCode === 'string') out.postalCode = addr.postalCode;
  if (typeof addr.country === 'string') out.country = addr.country;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function serializeCustomerReturn(returnDoc: unknown): CustomerSafeReturn {
  const src: Record<string, unknown> =
    returnDoc && typeof returnDoc === 'object' && typeof (returnDoc as { toObject?: () => unknown }).toObject === 'function'
      ? ((returnDoc as { toObject: () => Record<string, unknown> }).toObject())
      : ((returnDoc && typeof returnDoc === 'object' ? (returnDoc as Record<string, unknown>) : {}));

  const rawItems = Array.isArray(src.items) ? src.items : [];
  const items: CustomerSafeReturnItem[] = rawItems.map((rawItem: unknown) => {
    const item = rawItem && typeof rawItem === 'object' ? (rawItem as Record<string, unknown>) : {};
    return {
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity as number,
      reason: item.reason as string,
    };
  });

  const result: CustomerSafeReturn = {
    _id: src._id,
    orderId: src.orderId,
    items,
    status: src.status as string,
  };

  if (src.customerNote !== undefined) result.customerNote = src.customerNote as string;
  if (src.refundId !== undefined) result.refundId = src.refundId;
  if (src.refundStatus !== undefined) result.refundStatus = src.refundStatus as string;
  if (src.requestedAt !== undefined) result.requestedAt = src.requestedAt;
  if (src.approvedAt !== undefined) result.approvedAt = src.approvedAt;
  if (src.receivedAt !== undefined) result.receivedAt = src.receivedAt;
  if (src.inspectedAt !== undefined) result.inspectedAt = src.inspectedAt;
  if (src.completedAt !== undefined) result.completedAt = src.completedAt;
  if (src.rejectedAt !== undefined) result.rejectedAt = src.rejectedAt;
  if (src.cancelledAt !== undefined) result.cancelledAt = src.cancelledAt;
  if (src.returnAwbNumber !== undefined) result.returnAwbNumber = src.returnAwbNumber as string;
  if (src.returnCarrier !== undefined) result.returnCarrier = src.returnCarrier as string;
  if (src.returnShippingMethod !== undefined) result.returnShippingMethod = src.returnShippingMethod as string;

  const pickupAddress = serializePickupAddress(src.pickupAddress);
  if (pickupAddress) result.pickupAddress = pickupAddress;

  if (src.createdAt !== undefined) result.createdAt = src.createdAt;
  if (src.updatedAt !== undefined) result.updatedAt = src.updatedAt;

  return result;
}

export function serializeCustomerReturns(returnDocs: unknown[]): CustomerSafeReturn[] {
  return (Array.isArray(returnDocs) ? returnDocs : []).map(serializeCustomerReturn);
}

