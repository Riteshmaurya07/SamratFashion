export interface CategoryShippingValidationResult {
  isValid: boolean;
  error?: string;
  parsedAmount?: number;
}

/**
 * Validates category-specific free shipping threshold inputs.
 * Strictly rejects negative values, empty input when enabled, NaN, and Infinity.
 * Preserves exact numerical precision without silent rounding or clamping.
 */
export function validateCategoryShipping(
  isEnabled: boolean,
  rawAmount: string | number | undefined | null
): CategoryShippingValidationResult {
  if (!isEnabled) {
    const fallbackNum = rawAmount !== undefined && rawAmount !== null && rawAmount !== "" ? Number(rawAmount) : 0;
    return {
      isValid: true,
      parsedAmount: Number.isFinite(fallbackNum) && fallbackNum >= 0 ? fallbackNum : 0,
    };
  }

  if (rawAmount === undefined || rawAmount === null) {
    return {
      isValid: false,
      error: "Minimum order amount is required when category free delivery is enabled",
    };
  }

  const str = String(rawAmount).trim();
  if (str === "") {
    return {
      isValid: false,
      error: "Minimum order amount is required when category free delivery is enabled",
    };
  }

  const num = Number(str);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    return {
      isValid: false,
      error: "Minimum order amount must be a valid finite number",
    };
  }

  if (num < 0) {
    return {
      isValid: false,
      error: "Minimum order amount cannot be negative",
    };
  }

  return {
    isValid: true,
    parsedAmount: num,
  };
}
