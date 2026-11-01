import { Request, Response } from 'express';

interface AuthRequest extends Request {
  user?: any;
}
import { Address } from '../models/Address';
import { AppError } from '../utils/AppError';
import { catchAsync } from '../utils/catchAsync';

export function normalizeIndianPhone(rawPhone?: string | null): string | undefined {
  if (!rawPhone || typeof rawPhone !== 'string') return undefined;
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) return digits;
  if (digits.length === 11 && digits.startsWith('0') && /^[6-9]\d{9}$/.test(digits.slice(1))) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]\d{9}$/.test(digits.slice(2))) return digits.slice(2);
  return digits.length > 0 ? digits : undefined;
}

export function isValidIndianMobile(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone);
}

export const getAddresses = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const addresses = await Address.find({ userId: req.user.id }).sort({ isDefault: -1, createdAt: -1 });
  
  res.status(200).json({
    status: 'success',
    data: addresses
  });
});

export const getAddress = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const address = await Address.findOne({ _id: req.params.id, userId: req.user.id });
  if (!address) {
    throw new AppError('Address not found', 404);
  }

  res.status(200).json({
    status: 'success',
    data: address
  });
});

export const createAddress = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const { fullName, phone, alternatePhone, addressLine1, addressLine2, city, state, postalCode, country, landmark, addressType } = req.body;

  const missingFields: string[] = [];
  if (!fullName || !String(fullName).trim()) missingFields.push('Full Name');
  if (!phone || !String(phone).trim()) missingFields.push('Phone Number');
  if (!addressLine1 || !String(addressLine1).trim()) missingFields.push('Address Line 1');
  if (!city || !String(city).trim()) missingFields.push('City');
  if (!state || !String(state).trim()) missingFields.push('State');
  if (!postalCode || !String(postalCode).trim()) missingFields.push('PIN Code');

  if (missingFields.length > 0) {
    throw new AppError(`Missing required address fields: ${missingFields.join(', ')}`, 400, 'VALIDATION_ERROR');
  }

  const normalizedPhone = normalizeIndianPhone(String(phone)) || '';
  if (!isValidIndianMobile(normalizedPhone)) {
    throw new AppError('Primary phone must be a valid 10-digit Indian mobile number', 400, 'VALIDATION_ERROR');
  }

  let normalizedAltPhone: string | undefined = undefined;
  if (alternatePhone && String(alternatePhone).trim().length > 0) {
    normalizedAltPhone = normalizeIndianPhone(String(alternatePhone));
    if (!normalizedAltPhone || !isValidIndianMobile(normalizedAltPhone)) {
      throw new AppError('Alternate phone must be a valid 10-digit Indian mobile number', 400, 'VALIDATION_ERROR');
    }
    if (normalizedAltPhone === normalizedPhone) {
      throw new AppError('Alternate phone must be different from primary phone number', 400, 'VALIDATION_ERROR');
    }
  }

  const normalizedType = String(addressType || 'HOME').toUpperCase().trim();
  const validAddressType: 'HOME' | 'WORK' | 'OTHER' = normalizedType === 'WORK' ? 'WORK' : normalizedType === 'OTHER' ? 'OTHER' : 'HOME';

  // If this is the first address, make it default regardless of input
  const addressCount = await Address.countDocuments({ userId: req.user.id });
  const isDefault = req.body.isDefault !== undefined ? Boolean(req.body.isDefault) : addressCount === 0;

  if (isDefault) {
    await Address.updateMany({ userId: req.user.id }, { isDefault: false });
  }

  const address = await Address.create({
    userId: req.user.id,
    fullName: String(fullName).trim(),
    phone: normalizedPhone,
    alternatePhone: normalizedAltPhone,
    addressLine1: String(addressLine1).trim(),
    addressLine2: addressLine2 && String(addressLine2).trim() ? String(addressLine2).trim() : undefined,
    city: String(city).trim(),
    state: String(state).trim(),
    postalCode: String(postalCode).trim(),
    country: country && String(country).trim() ? String(country).trim() : 'India',
    landmark: landmark && String(landmark).trim() ? String(landmark).trim() : undefined,
    addressType: validAddressType,
    isDefault
  });

  res.status(201).json({
    status: 'success',
    data: address
  });
});

export const updateAddress = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const existingAddress = await Address.findOne({ _id: req.params.id, userId: req.user.id });
  if (!existingAddress) {
    throw new AppError('Address not found', 404);
  }

  const isDefault = req.body.isDefault;

  if (isDefault && !existingAddress.isDefault) {
    // Unset other defaults if this one is becoming the default
    await Address.updateMany({ userId: req.user.id }, { isDefault: false });
  }

  // Prevent user from unsetting the default address if they don't have another default
  if (existingAddress.isDefault && isDefault === false) {
    // They are trying to remove default from this address
    // This is generally allowed but we could prevent it if we want them to always have a default
    // For now we allow it, or they can just set another address to default.
  }

  const updatePayload: Record<string, unknown> = { ...req.body };
  delete updatePayload.userId;
  delete updatePayload._id;

  let targetPhone = existingAddress.phone;
  if (updatePayload.phone !== undefined) {
    const normalized = normalizeIndianPhone(String(updatePayload.phone)) || '';
    if (!isValidIndianMobile(normalized)) {
      throw new AppError('Primary phone must be a valid 10-digit Indian mobile number', 400, 'VALIDATION_ERROR');
    }
    updatePayload.phone = normalized;
    targetPhone = normalized;
  }

  if (updatePayload.alternatePhone !== undefined) {
    if (!updatePayload.alternatePhone || !String(updatePayload.alternatePhone).trim()) {
      updatePayload.alternatePhone = undefined;
    } else {
      const normalizedAlt = normalizeIndianPhone(String(updatePayload.alternatePhone));
      if (!normalizedAlt || !isValidIndianMobile(normalizedAlt)) {
        throw new AppError('Alternate phone must be a valid 10-digit Indian mobile number', 400, 'VALIDATION_ERROR');
      }
      if (normalizedAlt === targetPhone) {
        throw new AppError('Alternate phone must be different from primary phone number', 400, 'VALIDATION_ERROR');
      }
      updatePayload.alternatePhone = normalizedAlt;
    }
  }

  if (updatePayload.addressType) {
    const type = String(updatePayload.addressType).toUpperCase().trim();
    updatePayload.addressType = ['HOME', 'WORK', 'OTHER'].includes(type) ? type : 'HOME';
  }
  const updatedAddress = await Address.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: updatePayload },
    { returnDocument: 'after', runValidators: true }
  );

  res.status(200).json({
    status: 'success',
    data: updatedAddress
  });
});

export const deleteAddress = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const address = await Address.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  
  if (!address) {
    throw new AppError('Address not found', 404);
  }

  // If the deleted address was the default, set the next most recently created address as default
  if (address.isDefault) {
    const nextAddress = await Address.findOne({ userId: req.user.id }).sort({ createdAt: -1 });
    if (nextAddress) {
      nextAddress.isDefault = true;
      await nextAddress.save();
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'Address deleted successfully'
  });
});

export const setDefaultAddress = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const address = await Address.findOne({ _id: req.params.id, userId: req.user.id });
  if (!address) {
    throw new AppError('Address not found', 404);
  }

  await Address.updateMany({ userId: req.user.id }, { isDefault: false });
  
  address.isDefault = true;
  await address.save();

  res.status(200).json({
    status: 'success',
    data: address
  });
});
