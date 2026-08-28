/**
 * Restore Guard & Production Protection Utility
 * Enforces strict environment checks to prevent accidental restore or drop operations on production databases.
 */

export interface RestoreTargetConfig {
  targetEnv?: string;
  targetDbUri?: string;
  targetDbName?: string;
  allowProductionOverride?: boolean;
}

export function assertRestoreTargetSafe(config: RestoreTargetConfig): void {
  const currentEnv = process.env.NODE_ENV || 'development';
  const targetEnv = (config.targetEnv || process.env.RESTORE_TARGET || currentEnv).toLowerCase();
  const dbUri = config.targetDbUri || process.env.MONGODB_URI || '';
  const dbName = config.targetDbName || '';

  // 1. Strict Environment Guard
  if (currentEnv === 'production' || targetEnv === 'production') {
    if (!config.allowProductionOverride) {
      throw new Error(
        'FATAL RESTORE GUARD ERROR: Destructive restore operation is STRICTLY PROHIBITED on PRODUCTION environment.'
      );
    }
  }

  // 2. Database Target Guard
  if (targetEnv !== 'staging' && targetEnv !== 'test' && targetEnv !== 'isolated' && targetEnv !== 'development') {
    throw new Error(
      `FATAL RESTORE GUARD ERROR: Invalid restore target environment '${targetEnv}'. Target environment must be 'staging', 'test', or 'isolated'.`
    );
  }

  // 3. Name Guard
  if (dbName.toLowerCase().includes('prod') || dbUri.toLowerCase().includes('samrat_fashion_prod')) {
    if (!config.allowProductionOverride) {
      throw new Error(
        `FATAL RESTORE GUARD ERROR: Target database '${dbName || dbUri}' appears to be a production database!`
      );
    }
  }
}

export function isRestoreOperationAllowed(): boolean {
  try {
    assertRestoreTargetSafe({});
    return true;
  } catch {
    return false;
  }
}
