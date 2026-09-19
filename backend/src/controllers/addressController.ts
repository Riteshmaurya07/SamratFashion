import { Request, Response } from 'express';

interface AuthRequest extends Request {
  user?: any;
}
import { Address } from '../models/Address';
import { AppError } from '../utils/AppError';
import { catchAsync } from '../utils/catchAsync';

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

  const { fullName, phone, addressLine1, addressLine2, city, state, postalCode, country, landmark, addressType } = req.body;

  if (!fullName || !phone || !addressLine1 || !city || !state || !postalCode) {
    throw new AppError('Please fill out all required address fields (Full Name, Phone, Address Line 1, City, State, PIN Code)', 400, 'VALIDATION_ERROR');
  }

  // If this is the first address, make it default regardless of input
  const addressCount = await Address.countDocuments({ userId: req.user.id });
  const isDefault = req.body.isDefault || addressCount === 0;

  if (isDefault) {
    await Address.updateMany({ userId: req.user.id }, { isDefault: false });
  }

  const address = await Address.create({
    userId: req.user.id,
    fullName: String(fullName).trim(),
    phone: String(phone).trim(),
    addressLine1: String(addressLine1).trim(),
    addressLine2: addressLine2 ? String(addressLine2).trim() : undefined,
    city: String(city).trim(),
    state: String(state).trim(),
    postalCode: String(postalCode).trim(),
    country: country ? String(country).trim() : 'India',
    landmark: landmark ? String(landmark).trim() : undefined,
    addressType: addressType || 'HOME',
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

  const updatedAddress = await Address.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: req.body, userId: req.user.id }, // ensure userId cannot be modified
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
