export interface ServiceabilityResult {
  serviceable: boolean;
  codAvailable: boolean;
  estimatedDays?: number;
  postalCode: string;
}

export interface RateRequest {
  originPostalCode?: string;
  destinationPostalCode: string;
  weightGrams?: number;
  cod?: boolean;
}

export interface RateResult {
  rate: number;
  carrier: string;
  estimatedDays: number;
}

export interface CreateShipmentParams {
  orderId: string;
  orderNumber: string;
  recipient: {
    fullName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
  }>;
  packageDetails?: {
    weightGrams: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  codAmount?: number;
}

export interface ShipmentResponse {
  providerShipmentId: string;
  awbNumber: string;
  carrier: string;
  trackingUrl?: string;
  labelUrl?: string;
  status: string;
}

export interface TrackingEvent {
  status: string;
  location?: string;
  description: string;
  timestamp: Date;
  providerEventId?: string;
}

export interface ILogisticsProvider {
  name: string;
  checkServiceability(postalCode: string): Promise<ServiceabilityResult>;
  getRates(params: RateRequest): Promise<RateResult>;
  createShipment(params: CreateShipmentParams): Promise<ShipmentResponse>;
  cancelShipment(providerShipmentId: string, awbNumber: string): Promise<{ success: boolean }>;
  getTracking(awbNumber: string): Promise<{ status: string; history: TrackingEvent[] }>;
  generateLabel(awbNumber: string): Promise<{ labelUrl: string }>;
  requestPickup(awbNumber: string, pickupDate?: Date): Promise<{ pickupId: string; status: string }>;
}
