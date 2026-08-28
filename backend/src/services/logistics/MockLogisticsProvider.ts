import {
  ILogisticsProvider,
  ServiceabilityResult,
  RateRequest,
  RateResult,
  CreateShipmentParams,
  ShipmentResponse,
  TrackingEvent
} from './ILogisticsProvider';

export class MockLogisticsProvider implements ILogisticsProvider {
  public name = 'mock';

  async checkServiceability(postalCode: string): Promise<ServiceabilityResult> {
    const cleanPin = (postalCode || '').trim();
    const isValidIndianPin = /^[1-9][0-9]{5}$/.test(cleanPin);

    if (!isValidIndianPin) {
      return {
        serviceable: false,
        codAvailable: false,
        estimatedDays: 0,
        postalCode: cleanPin
      };
    }

    // Unserviceable pincode mock check: pincodes ending in '000' are unserviceable in mock
    const isUnserviceable = cleanPin.endsWith('000');
    // COD unserviceable pincode mock check: pincodes starting with '9' have prepaid only
    const codBlocked = cleanPin.startsWith('9');

    return {
      serviceable: !isUnserviceable,
      codAvailable: !isUnserviceable && !codBlocked,
      estimatedDays: 3,
      postalCode: cleanPin
    };
  }

  async getRates(params: RateRequest): Promise<RateResult> {
    const weightKg = ((params.weightGrams || 500) / 1000);
    const baseRate = 80;
    const rate = Math.round(baseRate + weightKg * 40);

    return {
      rate,
      carrier: 'Samrat Express Courier',
      estimatedDays: 3
    };
  }

  async createShipment(params: CreateShipmentParams): Promise<ShipmentResponse> {
    const randomSeq = Math.floor(100000000 + Math.random() * 900000000);
    const awbNumber = `SF-DEL-${randomSeq}`;
    const providerShipmentId = `MOCK-SHIP-${Date.now()}`;
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:5000/api';
    const trackingUrl = `https://track.samratfashion.local/?awb=${awbNumber}`;
    const labelUrl = `${baseUrl}/admin/orders/${params.orderId}/shipment/label`;

    return {
      providerShipmentId,
      awbNumber,
      carrier: 'Samrat Express Courier',
      trackingUrl,
      labelUrl,
      status: 'LABEL_CREATED'
    };
  }

  async cancelShipment(providerShipmentId: string, awbNumber: string): Promise<{ success: boolean }> {
    return { success: true };
  }

  async getTracking(awbNumber: string): Promise<{ status: string; history: TrackingEvent[] }> {
    const now = new Date();
    const history: TrackingEvent[] = [
      {
        status: 'LABEL_CREATED',
        location: 'Mumbai Hub',
        description: 'Shipping label created & package ready for dispatch',
        timestamp: new Date(now.getTime() - 3600000 * 24),
        providerEventId: `evt_1_${awbNumber}`
      },
      {
        status: 'PICKED_UP',
        location: 'Mumbai Hub',
        description: 'Package picked up by courier service',
        timestamp: new Date(now.getTime() - 3600000 * 18),
        providerEventId: `evt_2_${awbNumber}`
      },
      {
        status: 'IN_TRANSIT',
        location: 'Regional Logistics Center',
        description: 'In transit to destination hub',
        timestamp: new Date(now.getTime() - 3600000 * 6),
        providerEventId: `evt_3_${awbNumber}`
      }
    ];

    return {
      status: 'IN_TRANSIT',
      history
    };
  }

  async generateLabel(awbNumber: string): Promise<{ labelUrl: string }> {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:5000/api';
    return {
      labelUrl: `${baseUrl}/admin/orders/${awbNumber}/shipment/label`
    };
  }

  async requestPickup(awbNumber: string, pickupDate?: Date): Promise<{ pickupId: string; status: string }> {
    return {
      pickupId: `PU-${Math.floor(100000 + Math.random() * 900000)}`,
      status: 'PICKUP_REQUESTED'
    };
  }
}
