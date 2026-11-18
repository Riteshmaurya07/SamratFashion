export interface AddressParts {
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
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
