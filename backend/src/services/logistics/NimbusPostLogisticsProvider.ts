import {
  ILogisticsProvider,
  ServiceabilityResult,
  RateRequest,
  RateResult,
  CreateShipmentParams,
  ShipmentResponse,
  TrackingEvent
} from './ILogisticsProvider';
import {
  IMultiCourierProvider,
  MultiCourierRateRequest,
  MultiCourierRateResult,
  CourierOption,
  ExcludedCourierOption,
  ReverseRateRequest,
  CreateReverseShipmentParams,
  ReverseShipmentResponse
} from './IMultiCourierProvider';
import { nimbusPostClient, NimbusPostServiceabilityRequest, NimbusPostCreateShipmentRequest } from './NimbusPostClient';
import { Shipment } from '../../models/Shipment';
import { AppError } from '../../utils/AppError';

export class NimbusPostLogisticsProvider implements IMultiCourierProvider, ILogisticsProvider {
  public name = 'nimbuspost';

  async getMultiCourierRates(params: MultiCourierRateRequest): Promise<MultiCourierRateResult> {
    const originPin = (params.originPostalCode || process.env.ORIGIN_POSTAL_CODE || '229402').trim();
    const destPin = (params.destinationPostalCode || '').trim();

    if (!/^[1-9][0-9]{5}$/.test(originPin)) {
      throw new AppError('Invalid origin PIN code configured for warehouse.', 400, 'INVALID_ORIGIN_PIN');
    }
    if (!/^[1-9][0-9]{5}$/.test(destPin)) {
      throw new AppError('Invalid destination postal code on customer order.', 400, 'INVALID_DESTINATION_PIN');
    }

    const weightGrams = Math.round(Number(params.weightGrams) || 0);
    const lengthCm = Math.round((Number(params.lengthCm) || 0) * 10) / 10;
    const widthCm = Math.round((Number(params.widthCm) || 0) * 10) / 10;
    const heightCm = Math.round((Number(params.heightCm) || 0) * 10) / 10;
    const orderValuePaise = Math.round(Number(params.orderValuePaise) || 0);

    if (weightGrams <= 0) {
      throw new AppError('Package weight must be greater than 0 grams.', 400, 'INVALID_PACKAGE_DETAILS');
    }
    if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) {
      throw new AppError('Package dimensions (length, width, height) must be greater than 0 cm.', 400, 'INVALID_PACKAGE_DETAILS');
    }

    const payload: NimbusPostServiceabilityRequest = {
      pickupPincode: originPin,
      deliveryPincode: destPin,
      paymentMode: params.paymentMode === 'cod' ? 'cod' : 'prepaid',
      packages: [
        {
          weight: weightGrams,
          length: lengthCm,
          width: widthCm,
          height: heightCm
        }
      ],
      orderValuePaise
    };

    const res = await nimbusPostClient.checkServiceability(payload);
    const data = res.data || {};
    const rawAvailable = Array.isArray(data.available) ? data.available : [];
    const rawExcluded = Array.isArray(data.excluded) ? data.excluded : [];

    const available: CourierOption[] = rawAvailable.map((item) => {
      const resultObj = item.result || {};
      const totalPaise = typeof resultObj.totalPaise === 'number'
        ? resultObj.totalPaise
        : Math.round(((resultObj.shippingChargesPaise || 0) + (resultObj.codChargesPaise || 0) + (resultObj.surchargesPaise || 0)));

      return {
        courierId: String(item.courierId || ''),
        courierCode: String(item.courierCode || ''),
        courierName: String(item.courierName || 'Courier Partner'),
        courierDisplayName: item.courierDisplayName || item.courierName,
        courierType: item.courierType || 'surface',
        tatDays: typeof item.tatDays === 'number' ? item.tatDays : undefined,
        zone: item.zone,
        zoneLabel: item.zoneLabel,
        chargeableWeightGrams: resultObj.chargeableGrams || weightGrams,
        forwardRatePaise: resultObj.shippingChargesPaise || 0,
        codChargesPaise: resultObj.codChargesPaise || 0,
        surchargesPaise: resultObj.surchargesPaise || 0,
        totalRatePaise: totalPaise,
        totalRateRupees: totalPaise / 100,
        autoPickup: Boolean(item.autoPickup)
      };
    });

    const excluded: ExcludedCourierOption[] = rawExcluded.map((item) => ({
      courierId: item.courierId ? String(item.courierId) : undefined,
      courierCode: item.courierCode ? String(item.courierCode) : undefined,
      courierName: String(item.courierName || item.courierDisplayName || 'Courier Partner'),
      courierDisplayName: item.courierDisplayName,
      reason: String(item.reason || 'SERVICE_UNAVAILABLE'),
      detail: item.detail ? String(item.detail) : undefined
    }));

    return {
      provider: this.name,
      originPostalCode: originPin,
      destinationPostalCode: destPin,
      paymentMode: params.paymentMode,
      totalChargeableGrams: data.totalChargeableGrams ?? weightGrams,
      available,
      excluded
    };
  }

  async getReverseRates(params: ReverseRateRequest): Promise<MultiCourierRateResult> {
    const customerPin = (params.customerPostalCode || '').trim();
    const warehousePin = (params.warehousePostalCode || process.env.ORIGIN_POSTAL_CODE || '229402').trim();

    if (!/^[1-9][0-9]{5}$/.test(customerPin)) {
      throw new AppError('Invalid customer pickup PIN code for return.', 400, 'INVALID_CUSTOMER_PIN');
    }
    if (!/^[1-9][0-9]{5}$/.test(warehousePin)) {
      throw new AppError('Invalid warehouse return destination PIN code.', 400, 'INVALID_WAREHOUSE_PIN');
    }

    const weightGrams = Math.round(Number(params.weightGrams) || 0);
    const lengthCm = Math.round((Number(params.lengthCm) || 0) * 10) / 10;
    const widthCm = Math.round((Number(params.widthCm) || 0) * 10) / 10;
    const heightCm = Math.round((Number(params.heightCm) || 0) * 10) / 10;
    const orderValuePaise = Math.round(Number(params.orderValuePaise) || 0);

    if (weightGrams <= 0) {
      throw new AppError('Return package weight must be greater than 0 grams.', 400, 'INVALID_PACKAGE_DETAILS');
    }
    if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) {
      throw new AppError('Return package dimensions must all be greater than 0 cm.', 400, 'INVALID_PACKAGE_DETAILS');
    }

    const payload: NimbusPostServiceabilityRequest = {
      pickupPincode: customerPin,
      deliveryPincode: warehousePin,
      paymentMode: 'reverse',
      packages: [
        {
          weight: weightGrams,
          length: lengthCm,
          width: widthCm,
          height: heightCm
        }
      ],
      orderValuePaise
    };

    const res = await nimbusPostClient.checkServiceability(payload);
    const data = res.data || {};
    const rawAvailable = Array.isArray(data.available) ? data.available : [];
    const rawExcluded = Array.isArray(data.excluded) ? data.excluded : [];

    const available: CourierOption[] = rawAvailable.map((item) => {
      const resultObj = item.result || {};
      const totalPaise = typeof resultObj.totalPaise === 'number'
        ? resultObj.totalPaise
        : Math.round(((resultObj.shippingChargesPaise || 0) + (resultObj.codChargesPaise || 0) + (resultObj.surchargesPaise || 0)));

      return {
        courierId: String(item.courierId || ''),
        courierCode: String(item.courierCode || ''),
        courierName: String(item.courierName || 'Reverse Courier'),
        courierDisplayName: item.courierDisplayName || item.courierName,
        courierType: item.courierType || 'surface',
        tatDays: typeof item.tatDays === 'number' ? item.tatDays : undefined,
        zone: item.zone,
        zoneLabel: item.zoneLabel,
        chargeableWeightGrams: resultObj.chargeableGrams || weightGrams,
        forwardRatePaise: resultObj.shippingChargesPaise || 0,
        codChargesPaise: resultObj.codChargesPaise || 0,
        surchargesPaise: resultObj.surchargesPaise || 0,
        totalRatePaise: totalPaise,
        totalRateRupees: totalPaise / 100,
        autoPickup: Boolean(item.autoPickup)
      };
    });

    const excluded: ExcludedCourierOption[] = rawExcluded.map((item) => ({
      courierId: item.courierId ? String(item.courierId) : undefined,
      courierCode: item.courierCode ? String(item.courierCode) : undefined,
      courierName: String(item.courierName || item.courierDisplayName || 'Reverse Courier'),
      courierDisplayName: item.courierDisplayName,
      reason: String(item.reason || 'REVERSE_SERVICE_UNAVAILABLE'),
      detail: item.detail ? String(item.detail) : undefined
    }));

    return {
      provider: this.name,
      originPostalCode: customerPin,
      destinationPostalCode: warehousePin,
      paymentMode: 'prepaid',
      totalChargeableGrams: data.totalChargeableGrams ?? weightGrams,
      available,
      excluded
    };
  }

  async createReverseShipment(params: CreateReverseShipmentParams): Promise<ReverseShipmentResponse> {
    const customerPin = Number(String(params.pickupAddress.postalCode).replace(/\D/g, ''));
    const customerPhone = Number(String(params.pickupAddress.phone).replace(/\D/g, ''));

    if (!customerPin || !/^[1-9][0-9]{5}$/.test(String(customerPin))) {
      throw new AppError('Valid 6-digit customer pickup PIN code is required for reverse booking.', 400, 'INVALID_CUSTOMER_PIN');
    }
    if (!customerPhone || String(customerPhone).length !== 10) {
      throw new AppError('Valid 10-digit customer pickup phone number is required for reverse booking.', 400, 'INVALID_CUSTOMER_PHONE');
    }
    if (!params.pickupAddress.addressLine1?.trim() || !params.pickupAddress.city?.trim() || !params.pickupAddress.state?.trim()) {
      throw new AppError('Complete customer pickup address (addressLine1, city, state) is required for reverse booking.', 400, 'INVALID_CUSTOMER_ADDRESS');
    }

    const weightGrams = Math.round(Number(params.packageDetails.weightGrams) || 0);
    const lengthCm = Math.round((Number(params.packageDetails.lengthCm) || 0) * 10) / 10;
    const widthCm = Math.round((Number(params.packageDetails.widthCm) || 0) * 10) / 10;
    const heightCm = Math.round((Number(params.packageDetails.heightCm) || 0) * 10) / 10;

    if (weightGrams <= 0) {
      throw new AppError('Return parcel weight must be greater than 0 grams.', 400, 'INVALID_PACKAGE_DETAILS');
    }
    if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) {
      throw new AppError('Return parcel dimensions (length, width, height) must be greater than 0 cm.', 400, 'INVALID_PACKAGE_DETAILS');
    }

    const weightKg = Math.max(0.05, Math.round((weightGrams / 1000) * 1000) / 1000);
    const warehouseId = params.warehouseAddress?.warehouseId || await nimbusPostClient.getPrimaryWarehouseId();

    const reverseOrderNumber = `REV-${params.orderNumber}-${params.returnRequestId.slice(-4)}`;

    const payload: NimbusPostCreateShipmentRequest = {
      order_number: reverseOrderNumber,
      order_type: 'reverse',
      payment_mode: 'prepaid',
      parent_order_id: params.parentNimbusOrderId || undefined,
      return_reason: (params.returnReason || 'other').toLowerCase(),
      return_reason_note: params.returnReasonNote || 'Customer return',
      courier_id: params.courierId || undefined,
      warehouse_id: warehouseId || undefined,
      shipping_address: {
        name: params.pickupAddress.fullName,
        phone: customerPhone,
        address: params.pickupAddress.addressLine1,
        address_opt: params.pickupAddress.addressLine2 || '',
        city: params.pickupAddress.city,
        state: params.pickupAddress.state,
        pincode: customerPin,
        country: params.pickupAddress.country || 'India'
      },
      items: params.items.map(item => ({
        name: item.productName,
        qty: item.quantity,
        price: item.unitPrice,
        tax_rate: 0,
        sku: item.sku || 'SKU-RETURN'
      })),
      package: {
        weight: weightKg,
        length: lengthCm,
        width: widthCm,
        height: heightCm
      }
    };

    const res = await nimbusPostClient.createShipment(payload);
    const booking = res.data?.booking;
    const orderData = res.data?.order;
    const awb = booking?.awb;
    const providerOrderId = booking?.order_id || orderData?.order_id || reverseOrderNumber;

    if (!awb) {
      throw new AppError('NimbusPost reverse shipment creation did not return an AWB tracking code.', 502, 'LOGISTICS_PROVIDER_ERROR');
    }

    const carrierName = booking?.courier_name || 'NimbusPost Reverse Express';
    const trackingUrl = `https://track.nimbuspost.com/${awb}`;
    const labelUrl = booking?.label_url;

    return {
      providerOrderId,
      awbNumber: awb,
      carrier: carrierName,
      courierId: booking?.courier_id,
      trackingUrl,
      labelUrl,
      status: 'REVERSE_REQUESTED'
    };
  }

  async checkServiceability(postalCode: string): Promise<ServiceabilityResult> {
    const cleanPin = (postalCode || '').trim();
    if (!/^[1-9][0-9]{5}$/.test(cleanPin)) {
      return { serviceable: false, codAvailable: false, postalCode: cleanPin };
    }

    try {
      const multi = await this.getMultiCourierRates({
        originPostalCode: process.env.ORIGIN_POSTAL_CODE || '229402',
        destinationPostalCode: cleanPin,
        weightGrams: 500,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 10,
        paymentMode: 'prepaid',
        orderValuePaise: 100000
      });

      const serviceable = multi.available.length > 0;
      const minTat = multi.available.reduce<number | undefined>((min, c) => {
        if (typeof c.tatDays === 'number') {
          return min === undefined ? c.tatDays : Math.min(min, c.tatDays);
        }
        return min;
      }, undefined);

      return {
        serviceable,
        codAvailable: serviceable,
        estimatedDays: minTat ?? 3,
        postalCode: cleanPin
      };
    } catch {
      return { serviceable: false, codAvailable: false, postalCode: cleanPin };
    }
  }

  async getRates(params: RateRequest): Promise<RateResult> {
    const multi = await this.getMultiCourierRates({
      originPostalCode: params.originPostalCode || process.env.ORIGIN_POSTAL_CODE || '229402',
      destinationPostalCode: params.destinationPostalCode,
      weightGrams: params.weightGrams || 500,
      lengthCm: 15,
      widthCm: 10,
      heightCm: 5,
      paymentMode: params.cod ? 'cod' : 'prepaid',
      orderValuePaise: 100000
    });

    if (multi.available.length === 0) {
      throw new AppError('No NimbusPost couriers available for destination PIN code.', 404, 'LOGISTICS_RATE_UNAVAILABLE');
    }

    // Pick lowest rate option
    const sorted = [...multi.available].sort((a, b) => a.totalRatePaise - b.totalRatePaise);
    const chosen = sorted[0];

    return {
      rate: chosen.totalRateRupees,
      carrier: chosen.courierName,
      estimatedDays: chosen.tatDays || 3
    };
  }

  async createShipment(params: CreateShipmentParams): Promise<ShipmentResponse> {
    const weightGrams = params.packageDetails?.weightGrams || 500;
    const lengthCm = params.packageDetails?.lengthCm || 30;
    const widthCm = params.packageDetails?.widthCm || 25;
    const heightCm = params.packageDetails?.heightCm || 5;

    // NimbusPost V2 POST /v2/shipments dead weight must be in kilograms (e.g. 0.5 for 500g)
    const weightKg = Math.max(0.05, Math.round((weightGrams / 1000) * 1000) / 1000);

    const cleanPhone = Number(String(params.recipient.phone).replace(/\D/g, '')) || 9999999999;
    const cleanPincode = Number(String(params.recipient.postalCode).replace(/\D/g, '')) || 110001;

    const warehouseId = await nimbusPostClient.getPrimaryWarehouseId();

    const payload: NimbusPostCreateShipmentRequest = {
      order_number: params.orderNumber,
      order_type: 'b2c',
      payment_mode: params.codAmount && params.codAmount > 0 ? 'cod' : 'prepaid',
      courier_id: params.courierId || undefined,
      warehouse_id: warehouseId || undefined,
      shipping_address: {
        name: params.recipient.fullName,
        phone: cleanPhone,
        address: params.recipient.addressLine1,
        address_opt: params.recipient.addressLine2 || '',
        city: params.recipient.city,
        state: params.recipient.state,
        pincode: cleanPincode,
        country: params.recipient.country || 'India'
      },
      items: params.items.map(item => ({
        name: item.productName,
        qty: item.quantity,
        price: item.unitPrice,
        tax_rate: 0
      })),
      package: {
        weight: weightKg,
        length: lengthCm,
        width: widthCm,
        height: heightCm
      }
    };

    const res = await nimbusPostClient.createShipment(payload);
    const booking = res.data?.booking;
    const orderData = res.data?.order;
    const awb = booking?.awb;
    const nimbusOrderId = booking?.order_id || orderData?.order_id || `NIMBUS-${params.orderNumber}`;

    if (!awb) {
      throw new AppError('NimbusPost shipment creation did not return an AWB tracking code.', 502, 'LOGISTICS_PROVIDER_ERROR');
    }

    const carrierName = booking?.courier_name || 'NimbusPost Express';
    const trackingUrl = `https://track.nimbuspost.com/${awb}`;
    const labelUrl = booking?.label_url || `/api/admin/orders/${params.orderId}/shipment/label`;

    return {
      providerShipmentId: nimbusOrderId,
      awbNumber: awb,
      carrier: carrierName,
      trackingUrl,
      labelUrl,
      status: 'LABEL_CREATED'
    };
  }

  async generateLabel(awbNumber: string): Promise<{ labelUrl: string }> {
    const shipment = await Shipment.findOne({ awbNumber });
    const nimbusOrderId = shipment?.providerShipmentId;

    if (nimbusOrderId) {
      try {
        const labelRes = await nimbusPostClient.getShippingLabels([nimbusOrderId]);
        if (labelRes.data?.url) {
          return { labelUrl: labelRes.data.url };
        }
      } catch (err: unknown) {
        console.warn(`[NimbusPost] Failed to fetch remote label PDF for AWB ${awbNumber}:`, err);
      }
    }

    const baseUrl = process.env.BACKEND_URL || 'http://localhost:5000';
    return {
      labelUrl: `${baseUrl}/api/admin/orders/${shipment?.orderId || awbNumber}/shipment/label`
    };
  }

  async requestPickup(awbNumber: string, pickupDate?: Date): Promise<{ pickupId: string; status: string }> {
    const shipment = await Shipment.findOne({ awbNumber });
    const nimbusOrderId = shipment?.providerShipmentId;

    if (!nimbusOrderId) {
      throw new AppError(`Cannot schedule pickup: no NimbusPost order found for AWB ${awbNumber}`, 404, 'SHIPMENT_NOT_FOUND');
    }

    const dateStr = pickupDate ? pickupDate.toISOString().split('T')[0] : undefined;
    const res = await nimbusPostClient.schedulePickup([nimbusOrderId], dateStr);

    return {
      pickupId: res.data?.pickup_id || `PKP-${Date.now()}`,
      status: 'PICKUP_REQUESTED'
    };
  }

  async getTracking(awbNumber: string): Promise<{ status: string; history: TrackingEvent[] }> {
    const res = await nimbusPostClient.getTracking(awbNumber);
    const trackData = res.data;
    const scans = trackData?.scans || [];
    const rawStatus = (trackData?.latest?.shipStatus || trackData?.orderStatus || 'in transit').toLowerCase();

    let mappedStatus = 'LABEL_CREATED';
    if (rawStatus.includes('delivered')) mappedStatus = 'DELIVERED';
    else if (rawStatus.includes('out for delivery')) mappedStatus = 'OUT_FOR_DELIVERY';
    else if (rawStatus.includes('in transit') || rawStatus.includes('reached') || rawStatus.includes('dispatched')) mappedStatus = 'IN_TRANSIT';
    else if (rawStatus.includes('pickup') || rawStatus.includes('picked')) mappedStatus = 'PICKED_UP';
    else if (rawStatus.includes('rto')) mappedStatus = 'RTO';
    else if (rawStatus.includes('ndr') || rawStatus.includes('failed')) mappedStatus = 'NDR';

    const history: TrackingEvent[] = scans.map((s, idx) => ({
      status: (s.status || mappedStatus).toUpperCase(),
      location: s.location || '',
      description: s.remark || s.status || 'Tracking scan recorded',
      timestamp: s.timestamp ? new Date(s.timestamp) : new Date(),
      providerEventId: `nimbus_scan_${awbNumber}_${idx}`
    }));

    return {
      status: mappedStatus,
      history
    };
  }

  async cancelShipment(_providerShipmentId: string, awbNumber: string): Promise<{ success: boolean }> {
    const res = await nimbusPostClient.cancelShipment(awbNumber, 'Cancelled by admin');
    return { success: Boolean(res.data?.cancelled ?? true) };
  }
}

export const nimbusPostLogisticsProvider = new NimbusPostLogisticsProvider();
