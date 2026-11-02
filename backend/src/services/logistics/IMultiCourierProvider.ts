import { ILogisticsProvider } from './ILogisticsProvider';

export interface MultiCourierRateRequest {
  originPostalCode: string;
  destinationPostalCode: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  paymentMode: 'prepaid' | 'cod';
  orderValuePaise: number;
  orderId?: string;
  orderNumber?: string;
}

export interface CourierOption {
  courierId: string;
  courierCode: string;
  courierName: string;
  courierDisplayName?: string;
  courierType?: string; // air, surface, etc.
  tatDays?: number; // Estimated days
  zone?: string;
  zoneLabel?: string;
  chargeableWeightGrams: number;
  forwardRatePaise: number;
  codChargesPaise: number;
  surchargesPaise: number;
  totalRatePaise: number;
  totalRateRupees: number;
  autoPickup?: boolean;
}

export interface ExcludedCourierOption {
  courierId?: string;
  courierCode?: string;
  courierName: string;
  courierDisplayName?: string;
  reason: string;
  detail?: string;
}

export interface MultiCourierRateResult {
  provider: string; // e.g. 'nimbuspost'
  originPostalCode: string;
  destinationPostalCode: string;
  paymentMode: 'prepaid' | 'cod';
  totalChargeableGrams?: number;
  available: CourierOption[];
  excluded: ExcludedCourierOption[];
}

export interface ReverseRateRequest {
  customerPostalCode: string;
  warehousePostalCode?: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  orderValuePaise: number;
  returnRequestId?: string;
}

export interface CreateReverseShipmentParams {
  returnRequestId: string;
  orderId: string;
  orderNumber: string;
  parentNimbusOrderId?: string;
  courierId?: string;
  returnReason?: string;
  returnReasonNote?: string;
  pickupAddress: {
    fullName: string;
    phone: string;
    alternatePhone?: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  };
  warehouseAddress?: {
    warehouseId?: string;
    name?: string;
    address: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  };
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    sku?: string;
  }>;
  packageDetails: {
    weightGrams: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
}

export interface ReverseShipmentResponse {
  providerOrderId: string;
  awbNumber: string;
  carrier: string;
  courierId?: string;
  trackingUrl?: string;
  labelUrl?: string;
  status: string;
}

export interface IMultiCourierProvider extends ILogisticsProvider {
  getMultiCourierRates(params: MultiCourierRateRequest): Promise<MultiCourierRateResult>;
  getReverseRates?(params: ReverseRateRequest): Promise<MultiCourierRateResult>;
  createReverseShipment?(params: CreateReverseShipmentParams): Promise<ReverseShipmentResponse>;
}
