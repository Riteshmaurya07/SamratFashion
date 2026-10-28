export interface PrintMethodPricingRule {
  unitPrintingFee: number;
  front: number;
  back: number;
  leftSleeve: number;
  rightSleeve: number;
}

export const PRINT_PRICING_RULES: Record<string, PrintMethodPricingRule> = {
  DTF: {
    unitPrintingFee: 200,
    front: 200,
    back: 200,
    leftSleeve: 150,
    rightSleeve: 150,
  },
  SCREEN_PRINT: {
    unitPrintingFee: 150,
    front: 150,
    back: 150,
    leftSleeve: 100,
    rightSleeve: 100,
  },
  EMBROIDERY: {
    unitPrintingFee: 250,
    front: 250,
    back: 250,
    leftSleeve: 200,
    rightSleeve: 200,
  },
  DEFAULT: {
    unitPrintingFee: 200,
    front: 200,
    back: 200,
    leftSleeve: 150,
    rightSleeve: 150,
  },
};
