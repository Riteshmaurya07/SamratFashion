import { Router } from 'express';
import { getPublicStoreSettings } from '../controllers/storeSettingsController';

const router = Router();

// Public, read-only shipping configuration for storefront copy.
router.get('/', getPublicStoreSettings);

export default router;
