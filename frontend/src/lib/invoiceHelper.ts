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

    setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 60000);
  } catch (err: unknown) {
    console.error("[INVOICE DOWNLOAD ERROR]", err);
    let message = "Failed to retrieve tax invoice. Please ensure you are logged in and try again.";

    if (err && typeof err === "object" && "response" in err) {
      const response = err.response;
      if (response && typeof response === "object" && "data" in response) {
        const data = response.data;
        if (data instanceof Blob) {
          try {
            const text = await data.text();
            const parsed: unknown = JSON.parse(text);
            if (parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string") {
              message = parsed.message;
            }
          } catch {
            // Non-JSON blob, keep default message
          }
        } else if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
          message = data.message;
        }
      }
    }

    alert(message);
  }
}
