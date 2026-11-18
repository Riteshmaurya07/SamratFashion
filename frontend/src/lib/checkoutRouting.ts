export interface VerifyPaymentResponse {
  status?: number;
  data?: {
    orderCancelled?: boolean;
    reconciliationRequired?: boolean;
    processing?: boolean;
    reason?: string;
  };
}

export type CheckoutRouteDestination =
  | { type: 'CONFIRMATION'; path: string; alertMessage?: string }
  | { type: 'ORDERS_STATUS'; path: string; alertMessage: string };

export function resolveCheckoutVerificationRoute(
  orderId: string,
  verifyResponse: VerifyPaymentResponse
): CheckoutRouteDestination {
  const data = verifyResponse?.data;
  const status = verifyResponse?.status;

  if (data?.orderCancelled) {
    return {
      type: 'CONFIRMATION',
      path: `/order-confirmation/${orderId}`,
      alertMessage: "We couldn't confirm your order because an item is no longer in stock. Your payment will be refunded automatically."
    };
  }

  if (data?.reconciliationRequired || data?.processing || status === 202) {
    return {
      type: 'ORDERS_STATUS',
      path: `/account/orders/${orderId}`,
      alertMessage: "Payment is being confirmed. Please check your order status."
    };
  }

  return {
    type: 'CONFIRMATION',
    path: `/order-confirmation/${orderId}`
  };
}
