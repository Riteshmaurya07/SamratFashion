import { api } from "@/lib/api";

/**
 * Downloads or views an invoice PDF through an authenticated HTTP request using the API client.
 * This guarantees proper Authorization header attachment and handles blob URL creation cleanly.
 */
export async function downloadOrViewInvoicePdf(orderId: string, filename?: string): Promise<void> {
  try {
    const response = await api.get(`/orders/${orderId}/invoice/pdf`, {
      responseType: "blob",
    });

    const blob = new Blob([response.data], { type: "application/pdf" });
    const url = window.URL.createObjectURL(blob);

    // Try to open PDF in a new window/tab
    const newTab = window.open(url, "_blank");
    
    // If popup is blocked by browser, trigger direct download via temporary anchor element
    if (!newTab) {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || `Invoice-${orderId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (err: any) {
    console.error("[INVOICE DOWNLOAD ERROR]", err);
    const message = err.response?.data?.message || "Failed to retrieve tax invoice. Please ensure you are logged in and try again.";
    alert(message);
  }
}
