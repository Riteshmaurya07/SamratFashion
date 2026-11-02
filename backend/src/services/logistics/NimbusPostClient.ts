import axios, { AxiosInstance } from 'axios';
import { AppError } from '../../utils/AppError';

export interface NimbusPostPackageItem {
  weight: number; // in grams
  length: number; // in cm
  width: number;  // in cm
  height: number; // in cm
  weight_kg?: number;
}

export interface NimbusPostServiceabilityRequest {
  pickupPincode: string;
  deliveryPincode: string;
  paymentMode: 'prepaid' | 'cod' | 'reverse' | 'reverseqc';
  packages: NimbusPostPackageItem[];
  orderValuePaise: number;
}

export interface NimbusPostCourierQuote {
  courierId: string;
  courierCode: string;
  courierName: string;
  courierDisplayName?: string;
  courierType?: string;
  zone?: string;
  zoneLabel?: string;
  tatDays?: number;
  autoPickup?: boolean;
  reversePickup?: boolean;
  reverseQcPickup?: boolean;
  ewaybillRequired?: boolean;
  result?: {
    zoneCode?: string;
    chargeableGrams?: number;
    chargedGrams?: number;
    shippingChargesPaise?: number;
    codChargesPaise?: number;
    surchargesPaise?: number;
    insurancePaise?: number;
    rtoChargesPaise?: number;
    totalPaise?: number;
    taxableBasePaise?: number;
  };
}

export interface NimbusPostExcludedCourier {
  courierId?: string;
  courierCode?: string;
  courierName?: string;
  courierDisplayName?: string;
  reason: string;
  detail?: string;
}

export interface NimbusPostServiceabilityResponse {
  success: boolean;
  data: {
    pickupPincode: string;
    deliveryPincode: string;
    paymentMode: string;
    totalChargeableGrams?: number | null;
    available?: NimbusPostCourierQuote[];
    excluded?: NimbusPostExcludedCourier[];
  };
  meta?: {
    requestId?: string;
  };
}

export interface NimbusPostCreateShipmentRequest {
  order_number: string;
  order_type: 'b2c' | 'reverse' | 'document';
  payment_mode: 'prepaid' | 'cod';
  parent_order_id?: string;
  return_reason?: string;
  return_reason_note?: string;
  courier_id?: string;
  warehouse_id?: string;
  shipping_address: {
    name: string;
    phone: number;
    address: string;
    address_opt?: string;
    city: string;
    state: string;
    pincode: number;
    country?: string;
  };
  items: Array<{
    name: string;
    qty: number;
    price: number;
    tax_rate?: number;
    sku?: string;
  }>;
  package: {
    weight: number; // in kilograms
    length: number; // in cm
    width: number;  // in cm
    height: number; // in cm
  };
  order_amount?: number;
}

export interface NimbusPostCreateShipmentResponse {
  success: boolean;
  data: {
    order?: {
      order_id?: string;
      order_status?: string;
    };
    booking?: {
      order_id?: string;
      awb?: string;
      courier_id?: string;
      courier_code?: string;
      courier_name?: string;
      pickup_id?: string;
      order_status?: string;
      price?: {
        forward?: number;
        rto?: number;
        cod_charge?: number;
        surcharges?: number;
        total?: number;
      };
      label_url?: string;
    };
  };
  meta?: {
    requestId?: string;
  };
}

export interface NimbusPostLabelResponse {
  success: boolean;
  data: {
    url: string;
    pageCount?: number;
    expiresAt?: string;
    documentType?: string;
  };
  meta?: {
    requestId?: string;
  };
}

export interface NimbusPostPickupResponse {
  success: boolean;
  data: {
    order_id?: string;
    awb?: string;
    pickup_id?: string;
    pickup_date?: string;
    status?: string;
  };
  meta?: {
    requestId?: string;
  };
}

export interface NimbusPostTrackingResponse {
  success: boolean;
  data: {
    orderId?: string;
    orderNumber?: string;
    orderStatus?: string;
    shipment?: {
      awb?: string;
      courierName?: string;
      edd?: string;
      pickedAt?: string;
    };
    latest?: {
      shipStatus?: string;
      statusCode?: string;
      location?: string;
      message?: string;
      eventTime?: string;
    };
    scans?: Array<{
      timestamp?: string;
      status?: string;
      status_code?: string;
      location?: string;
      remark?: string;
    }>;
    tracking_url?: string;
    tracking_short_url?: string;
  };
  meta?: {
    requestId?: string;
  };
}

export interface NimbusPostCancelResponse {
  success: boolean;
  data: {
    awb?: string;
    cancelled?: boolean;
    order_status?: string;
    refunded_amount?: number;
  };
  meta?: {
    requestId?: string;
  };
}

export class NimbusPostClient {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 10000,
    });
  }

  private getBaseUrl(): string {
    return process.env.NIMBUSPOST_BASE_URL || 'https://api-v2.nimbuspost.com';
  }

  private getCredentials(): { apiKey: string; apiSecret: string } {
    const apiKey = (process.env.NIMBUSPOST_API_KEY || '').trim();
    const apiSecret = (process.env.NIMBUSPOST_API_SECRET || '').trim();

    if (!apiKey || !apiSecret) {
      throw new AppError(
        'NimbusPost API credentials (NIMBUSPOST_API_KEY, NIMBUSPOST_API_SECRET) are missing from server environment.',
        500,
        'LOGISTICS_CONFIG_ERROR'
      );
    }

    return { apiKey, apiSecret };
  }

  public getHeaders(): Record<string, string> {
    const { apiKey, apiSecret } = this.getCredentials();
    return {
      'x-api-key': apiKey,
      'x-api-secret': apiSecret,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  }

  private primaryWarehouseIdCache?: string;

  async getPrimaryWarehouseId(): Promise<string | undefined> {
    if (process.env.NIMBUSPOST_WAREHOUSE_ID) {
      return process.env.NIMBUSPOST_WAREHOUSE_ID.trim();
    }
    if (this.primaryWarehouseIdCache) {
      return this.primaryWarehouseIdCache;
    }

    try {
      const baseUrl = this.getBaseUrl();
      const res = await this.axiosInstance.get(`${baseUrl}/v2/warehouses`, {
        headers: this.getHeaders(),
      });
      const items = Array.isArray(res.data?.data) ? res.data.data : [];
      const primary = items.find((w: any) => w.is_primary && w.status === 'active') || items[0];
      if (primary?.warehouse_id) {
        this.primaryWarehouseIdCache = String(primary.warehouse_id).trim();
        return this.primaryWarehouseIdCache;
      }
    } catch (err: unknown) {
      console.warn('[NimbusPost] Failed to auto-resolve primary warehouse from API:', err);
    }

    return undefined;
  }

  private normalizeError(operation: string, err: unknown): AppError {
    const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : {};
    const response = errObj.response && typeof errObj.response === 'object' ? (errObj.response as Record<string, unknown>) : undefined;
    const status = typeof response?.status === 'number' ? response.status : 500;
    const errData = response?.data && typeof response.data === 'object' ? (response.data as Record<string, unknown>) : undefined;
    const errorObj = errData?.error && typeof errData.error === 'object' ? (errData.error as Record<string, unknown>) : undefined;

    // Redact/prevent credential logging: only log operation and sanitized status/message
    const message = (typeof errorObj?.detail === 'string' && errorObj.detail) ||
      (typeof errorObj?.title === 'string' && errorObj.title) ||
      (typeof errData?.message === 'string' && errData.message) ||
      (typeof errObj.message === 'string' && errObj.message) ||
      'Unknown NimbusPost error';
    const code = (typeof errorObj?.code === 'string' && errorObj.code) || 'NIMBUSPOST_API_ERROR';

    console.error(`[NimbusPost API Error] operation=${operation} status=${status} code=${code} message=${message}`);

    const errCode = typeof errObj.code === 'string' ? errObj.code : '';
    const errMessage = typeof errObj.message === 'string' ? errObj.message : '';
    if (errCode === 'ECONNABORTED' || errMessage.includes('timeout')) {
      return new AppError('NimbusPost API request timed out. Please try again.', 504, 'GATEWAY_TIMEOUT');
    }

    if (status === 401) {
      return new AppError('NimbusPost authentication failed. Check API key and secret.', 401, 'UNAUTHORIZED');
    }

    if (status === 403) {
      return new AppError('NimbusPost permission denied. Admin role required.', 403, 'FORBIDDEN');
    }

    return new AppError(
      `NimbusPost ${operation} failed: ${message}`,
      status >= 400 && status < 500 ? status : 502,
      code
    );
  }

  async checkServiceability(payload: NimbusPostServiceabilityRequest): Promise<NimbusPostServiceabilityResponse> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/v2/serviceability`;

    try {
      const response = await this.axiosInstance.post<NimbusPostServiceabilityResponse>(url, payload, {
        headers: this.getHeaders(),
      });

      if (!response.data || typeof response.data !== 'object') {
        throw new AppError('Invalid response received from NimbusPost API', 502, 'INVALID_PROVIDER_RESPONSE');
      }

      return response.data;
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw this.normalizeError('checkServiceability', err);
    }
  }

  async createShipment(payload: NimbusPostCreateShipmentRequest): Promise<NimbusPostCreateShipmentResponse> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/v2/shipments`;

    try {
      const response = await this.axiosInstance.post<NimbusPostCreateShipmentResponse>(url, payload, {
        headers: this.getHeaders(),
      });

      if (!response.data || typeof response.data !== 'object') {
        throw new AppError('Invalid response received from NimbusPost shipment API', 502, 'INVALID_PROVIDER_RESPONSE');
      }

      return response.data;
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw this.normalizeError('createShipment', err);
    }
  }

  async getShippingLabels(orderIds: string[]): Promise<NimbusPostLabelResponse> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/v2/shipments/labels`;

    try {
      const response = await this.axiosInstance.post<NimbusPostLabelResponse>(url, { order_ids: orderIds }, {
        headers: this.getHeaders(),
      });

      if (!response.data || typeof response.data !== 'object') {
        throw new AppError('Invalid response received from NimbusPost labels API', 502, 'INVALID_PROVIDER_RESPONSE');
      }

      return response.data;
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw this.normalizeError('getShippingLabels', err);
    }
  }

  async schedulePickup(orderIds: string[], pickupDate?: string): Promise<NimbusPostPickupResponse> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/v2/shipments/pickup`;

    try {
      const payload: Record<string, unknown> = { order_ids: orderIds };
      if (pickupDate) payload.pickup_date = pickupDate;

      const response = await this.axiosInstance.post<NimbusPostPickupResponse>(url, payload, {
        headers: this.getHeaders(),
      });

      if (!response.data || typeof response.data !== 'object') {
        throw new AppError('Invalid response received from NimbusPost pickup API', 502, 'INVALID_PROVIDER_RESPONSE');
      }

      return response.data;
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw this.normalizeError('schedulePickup', err);
    }
  }

  async getTracking(awb: string): Promise<NimbusPostTrackingResponse> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/v2/tracking/${encodeURIComponent(awb)}`;

    try {
      const response = await this.axiosInstance.get<NimbusPostTrackingResponse>(url, {
        headers: this.getHeaders(),
      });

      if (!response.data || typeof response.data !== 'object') {
        throw new AppError('Invalid response received from NimbusPost tracking API', 502, 'INVALID_PROVIDER_RESPONSE');
      }

      return response.data;
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw this.normalizeError('getTracking', err);
    }
  }

  async cancelShipment(awb: string, reason?: string): Promise<NimbusPostCancelResponse> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/v2/shipments/cancel`;

    try {
      const response = await this.axiosInstance.post<NimbusPostCancelResponse>(url, { awb, reason }, {
        headers: this.getHeaders(),
      });

      if (!response.data || typeof response.data !== 'object') {
        throw new AppError('Invalid response received from NimbusPost cancel API', 502, 'INVALID_PROVIDER_RESPONSE');
      }

      return response.data;
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw this.normalizeError('cancelShipment', err);
    }
  }
}

export const nimbusPostClient = new NimbusPostClient();
