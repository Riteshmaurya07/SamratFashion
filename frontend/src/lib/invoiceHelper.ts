import { api } from "@/lib/api";

/**
 * Downloads an invoice PDF through an authenticated HTTP request using the API client.
 * Uses direct anchor download rather than `window.open(blobUrl)` so neither async popup
 * blockers nor `object-src 'none'` CSP rules silently swallow the PDF.
 */
export async function downloadOrViewInvoicePdf(
  orderId: string,
  filename?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await api.get(`/orders/${orderId}/invoice/pdf`, {
      responseType: "blob",
      timeout: 30000,
    });

    const contentType = String(response.headers?.["content-type"] || "");
    if (contentType.includes("application/json")) {
      const text = await new Blob([response.data]).text();
      let msg = "Failed to retrieve tax invoice.";
      try {
        const parsed = JSON.parse(text);
        if (parsed?.message) msg = parsed.message;
      } catch {
        // ignore parse failure
      }
      return { success: false, error: msg };
    }

    const blob = new Blob([response.data], { type: "application/pdf" });
    if (blob.size === 0) {
      return { success: false, error: "Received an empty invoice PDF from the server." };
    }

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || `Invoice-${orderId}.pdf`;
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 60000);

    return { success: true };
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

    return { success: false, error: message };
  }
}
