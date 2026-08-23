import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { 
  getAddresses, 
  getAddress, 
  createAddress, 
  updateAddress, 
  deleteAddress, 
  setDefaultAddress 
} from '../controllers/addressController';

const router = Router();

router.use(requireAuth); // All address routes require authentication

router.route('/')
  .get(getAddresses)
  .post(createAddress);

router.route('/:id')
  .get(getAddress)
  .put(updateAddress)
  .delete(deleteAddress);

router.patch('/:id/default', setDefaultAddress);

export default router;
