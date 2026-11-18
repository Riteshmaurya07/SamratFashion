export interface AddressParts {
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

/**
 * Normalizes minor punctuation/ordinal spacing glitches in saved addresses
 * (e.g., "Halla , Tahseel" -> "Halla, Tahseel", "1 st Floor" -> "1st Floor").
 */
export function cleanAddressLine(line?: string | null): string {
  if (!line) return "";
  return line
    .trim()
    .replace(/\s+,/g, ",")
    .replace(/,\s*/g, ", ")
    .replace(/\b(\d+)\s+(st|nd|rd|th)\b/gi, "$1$2")
    .replace(/\s{2,}/g, " ");
}

/**
 * Formats city, state, and postal code as a single joined string so React
 * never splits adjacent text nodes (which can drop spaces during rendering/SSR).
 */
export function formatCityStatePin(address?: AddressParts | null): string {
  if (!address) return "";
  const cityState = [address.city?.trim(), address.state?.trim()]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  const pin = address.postalCode?.trim() || "";
  if (cityState && pin) return `${cityState} - ${pin}`;
  return cityState || pin;
}
