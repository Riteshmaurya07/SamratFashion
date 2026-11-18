import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Shared-secret gate for operational endpoints (health probes and cron).
 *
 * These endpoints intentionally do not use the admin JWT flow: external cron
 * providers and uptime monitors cannot complete a login. The secret is
 * compared in constant time and is never echoed in the response.
 *
 * If OPS_SECRET is missing or too short, the endpoints fail closed with 503
 * rather than becoming publicly accessible.
 */
export const requireOpsSecret = (req: Request, res: Response, next: NextFunction): void => {
  const configured = process.env.OPS_SECRET || '';
  if (configured.length < 16) {
    res.status(503).json({
      success: false,
      code: 'OPS_SECRET_NOT_CONFIGURED',
      message: 'Set OPS_SECRET (minimum 16 characters) to enable /api/ops endpoints.',
    });
    return;
  }

  const header = req.header('x-ops-secret');
  const authorization = req.header('authorization') || '';
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  // The secret is accepted only from headers. Query parameters are never read.
  const provided = typeof header === 'string' && header.length > 0 ? header : bearer;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const configuredBuffer = Buffer.from(configured, 'utf8');

  // Compare in constant time regardless of lengths by padding both buffers to
  // the same size. Length equality is still required to accept the secret.
  const comparisonLength = Math.max(providedBuffer.length, configuredBuffer.length, 1);
  const providedPadded = Buffer.alloc(comparisonLength);
  const configuredPadded = Buffer.alloc(comparisonLength);
  providedBuffer.copy(providedPadded);
  configuredBuffer.copy(configuredPadded);
  const secretsMatch = crypto.timingSafeEqual(providedPadded, configuredPadded);

  if (providedBuffer.length !== configuredBuffer.length || !secretsMatch) {
    res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Invalid or missing x-ops-secret header.',
    });
    return;
  }

  next();
};
