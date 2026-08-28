import axios from 'axios';
import {
  ILogisticsProvider,
  ServiceabilityResult,
  RateRequest,
  RateResult,
  CreateShipmentParams,
  ShipmentResponse,
  TrackingEvent
} from './ILogisticsProvider';
import { AppError } from '../../utils/AppError';

export class DelhiveryLogisticsProvider implements ILogisticsProvider {
  public name = 'delhivery';

  private getBaseUrl(): string {
    const isSandbox = process.env.DELHIVERY_ENV === 'sandbox' || process.env.NODE_ENV === 'staging';
    return isSandbox
      ? (process.env.DELHIVERY_SANDBOX_URL || 'https://staging-express.delhivery.com')
      : (process.env.DELHIVERY_BASE_URL || 'https://track.delhivery.com');
  }

  private getToken(): string {
    const token = process.env.DELHIVERY_API_TOKEN;
    if (!token) {
      throw new AppError(
        'Delhivery API token (DELHIVERY_API_TOKEN) is not configured in server environment.',
        500,
        'LOGISTICS_CONFIG_ERROR'
      );
    }
    return token;
  }

  private getClientName(): string {
    return process.env.DELHIVERY_CLIENT_NAME || 'SAMRAT FASHION';
  }

  private getPickupLocation(): string {
    return process.env.DELHIVERY_PICKUP_LOCATION || 'Primary Warehouse';
  }

  private getHeaders() {
    const token = this.getToken();
    return {
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  private logError(operation: string, err: any) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.rmk || err.response?.data?.message || err.message || 'Unknown error';
    console.error(`[Delhivery API Error] operation=${operation} status=${status} message=${message}`);
  }

  async checkServiceability(postalCode: string): Promise<ServiceabilityResult> {
    const cleanPin = (postalCode || '').trim();
    const isValidIndianPin = /^[1-9][0-9]{5}$/.test(cleanPin);

    if (!isValidIndianPin) {
      return {
        serviceable: false,
        codAvailable: false,
        estimatedDays: undefined,
        postalCode: cleanPin
      };
    }

    try {
      const baseUrl = this.getBaseUrl();
      const client = this.getClientName();
      const url = `${baseUrl}/c/api/pin-codes/json/?cl=${encodeURIComponent(client)}&pincode=${cleanPin}`;

      const res = await axios.get(url, {
        headers: this.getHeaders(),
        timeout: 8000
      });

      const codes = res.data?.delivery_codes || [];
      const match = codes.find((c: any) => String(c.postal_code?.pin || c.postal_code) === cleanPin);

      if (match) {
        const pinData = match.postal_code || match;
        return {
          serviceable: String(pinData.is_prepaid).toUpperCase() === 'Y' || String(pinData.is_cod).toUpperCase() === 'Y',
          codAvailable: String(pinData.is_cod).toUpperCase() === 'Y',
          estimatedDays: 3,
          postalCode: cleanPin
        };
      }

      return {
        serviceable: false,
        codAvailable: false,
        estimatedDays: undefined,
        postalCode: cleanPin
      };
    } catch (err: any) {
      this.logError('checkServiceability', err);
      if (err instanceof AppError) throw err;
      throw new AppError(
        `Delhivery serviceability check failed: ${err.response?.data?.rmk || err.message}`,
        err.response?.status || 500,
        'LOGISTICS_SERVICEABILITY_UNAVAILABLE'
      );
    }
  }

  async getRates(params: RateRequest): Promise<RateResult> {
    const weightGrams = params.weightGrams || 500;
    const originPin = params.originPostalCode || process.env.ORIGIN_POSTAL_CODE || '400001';
    const destPin = params.destinationPostalCode;
    const isCod = params.cod ? 'COD' : 'Pre-Paid';

    try {
      const baseUrl = this.getBaseUrl();
      const url = `${baseUrl}/api/kpi/json/?ss=DTO&pt=${isCod}&d_pin=${destPin}&o_pin=${originPin}&c_weight=${weightGrams}`;

      const res = await axios.get(url, {
        headers: this.getHeaders(),
        timeout: 8000
      });

      if (res.data?.total_amount) {
        return {
          rate: Math.round(Number(res.data.total_amount)),
          carrier: 'Delhivery Express',
          estimatedDays: Number(res.data.expected_days) || 3
        };
      }

      throw new AppError('Delhivery API did not return rate details for destination PIN code.', 500, 'LOGISTICS_RATE_UNAVAILABLE');
    } catch (err: any) {
      this.logError('getRates', err);
      if (err instanceof AppError) throw err;
      throw new AppError(
        `Delhivery rate calculation failed: ${err.response?.data?.rmk || err.message}`,
        err.response?.status || 500,
        'LOGISTICS_RATE_UNAVAILABLE'
      );
    }
  }

  async createShipment(params: CreateShipmentParams): Promise<ShipmentResponse> {
    const baseUrl = this.getBaseUrl();
    const token = this.getToken();
    const pickupLocation = this.getPickupLocation();

    const providerShipmentId = `DELHI-${params.orderNumber}-${Date.now()}`;

    const payload = {
      shipments: [
        {
          name: params.recipient.fullName,
          add: `${params.recipient.addressLine1} ${params.recipient.addressLine2 || ''}`.trim(),
          pin: params.recipient.postalCode,
          city: params.recipient.city,
          state: params.recipient.state,
          country: params.recipient.country || 'India',
          phone: params.recipient.phone,
          order: params.orderNumber,
          payment_mode: params.codAmount && params.codAmount > 0 ? 'COD' : 'Prepaid',
          cod_amount: params.codAmount || 0,
          weight: params.packageDetails?.weightGrams || 500
        }
      ],
      pickup_location: {
        name: pickupLocation
      }
    };

    try {
      const formData = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
      const res = await axios.post(`${baseUrl}/api/cmu/create.json`, formData, {
        headers: {
          'Authorization': `Token ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      });

      const packages = res.data?.packages || [];
      if (packages.length > 0 && packages[0].waybill) {
        const assignedWaybill = packages[0].waybill;
        return {
          providerShipmentId: packages[0].refnum || providerShipmentId,
          awbNumber: assignedWaybill,
          carrier: 'Delhivery Express',
          trackingUrl: `https://track.delhivery.com/track/package/${assignedWaybill}`,
          labelUrl: `/api/admin/orders/${params.orderId}/shipment/label`,
          status: 'LABEL_CREATED'
        };
      }

      const errMsg = packages[0]?.remarks?.[0] || 'Delhivery shipment creation failed (no waybill returned).';
      throw new AppError(errMsg, 500, 'LOGISTICS_PROVIDER_ERROR');
    } catch (err: any) {
      this.logError('createShipment', err);
      if (err instanceof AppError) throw err;
      throw new AppError(
        `Delhivery shipment creation failed: ${err.response?.data?.rmk || err.message}`,
        err.response?.status || 500,
        'LOGISTICS_PROVIDER_ERROR'
      );
    }
  }

  async cancelShipment(providerShipmentId: string, awbNumber: string): Promise<{ success: boolean }> {
    try {
      const baseUrl = this.getBaseUrl();
      const payload = { waybill: awbNumber, cancellation: true };

      await axios.post(`${baseUrl}/api/p/edit`, payload, {
        headers: this.getHeaders(),
        timeout: 8000
      });
      return { success: true };
    } catch (err: any) {
      this.logError('cancelShipment', err);
      if (err instanceof AppError) throw err;
      throw new AppError(
        `Delhivery shipment cancellation failed: ${err.response?.data?.rmk || err.message}`,
        err.response?.status || 500,
        'LOGISTICS_PROVIDER_ERROR'
      );
    }
  }

  async getTracking(awbNumber: string): Promise<{ status: string; history: TrackingEvent[] }> {
    try {
      const baseUrl = this.getBaseUrl();
      const url = `${baseUrl}/api/v1/packages/json/?waybill=${awbNumber}`;

      const res = await axios.get(url, {
        headers: this.getHeaders(),
        timeout: 8000
      });

      const pkgData = res.data?.ShipmentData?.[0]?.Shipment;
      if (pkgData) {
        const rawStatus = String(pkgData.Status?.Status || 'Manifested').toUpperCase();
        let mappedStatus = 'LABEL_CREATED';
        if (['IN TRANSIT', 'DISPATCHED'].includes(rawStatus)) mappedStatus = 'IN_TRANSIT';
        if (['PICKED UP', 'ACCEPTED'].includes(rawStatus)) mappedStatus = 'PICKED_UP';
        if (['OUT FOR DELIVERY'].includes(rawStatus)) mappedStatus = 'OUT_FOR_DELIVERY';
        if (['DELIVERED'].includes(rawStatus)) mappedStatus = 'DELIVERED';
        if (['NDR'].includes(rawStatus)) mappedStatus = 'NDR';
        if (['RTO'].includes(rawStatus)) mappedStatus = 'RTO';

        const history: TrackingEvent[] = (pkgData.Scans || []).map((scan: any, idx: number) => ({
          status: mappedStatus,
          location: scan.ScanDetail?.ScannedLocation || '',
          description: scan.ScanDetail?.Instructions || scan.ScanDetail?.ScanDateTime || 'Tracking scan recorded',
          timestamp: scan.ScanDetail?.ScanDateTime ? new Date(scan.ScanDetail.ScanDateTime) : new Date(),
          providerEventId: `delhi_scan_${awbNumber}_${idx}`
        }));

        return {
          status: mappedStatus,
          history
        };
      }

      throw new AppError(`No tracking details found for AWB ${awbNumber}`, 404, 'LOGISTICS_PROVIDER_ERROR');
    } catch (err: any) {
      this.logError('getTracking', err);
      if (err instanceof AppError) throw err;
      throw new AppError(
        `Delhivery tracking lookup failed: ${err.response?.data?.rmk || err.message}`,
        err.response?.status || 500,
        'LOGISTICS_PROVIDER_ERROR'
      );
    }
  }

  async generateLabel(awbNumber: string): Promise<{ labelUrl: string }> {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
    return {
      labelUrl: `${baseUrl}/admin/orders/${awbNumber}/shipment/label`
    };
  }

  async requestPickup(awbNumber: string, pickupDate?: Date): Promise<{ pickupId: string; status: string }> {
    try {
      const baseUrl = this.getBaseUrl();
      const pickupLocation = this.getPickupLocation();
      const payload = {
        pickup_location: pickupLocation,
        expected_package_count: 1,
        pickup_date: (pickupDate || new Date()).toISOString().split('T')[0]
      };

      const res = await axios.post(`${baseUrl}/fm/request/create/`, payload, {
        headers: this.getHeaders(),
        timeout: 8000
      });

      if (res.data?.pickup_id) {
        return {
          pickupId: String(res.data.pickup_id),
          status: 'PICKUP_REQUESTED'
        };
      }

      throw new AppError('Delhivery pickup API did not return a pickup ID.', 500, 'LOGISTICS_PROVIDER_ERROR');
    } catch (err: any) {
      this.logError('requestPickup', err);
      if (err instanceof AppError) throw err;
      throw new AppError(
        `Delhivery pickup request failed: ${err.response?.data?.rmk || err.message}`,
        err.response?.status || 500,
        'LOGISTICS_PROVIDER_ERROR'
      );
    }
  }
}
