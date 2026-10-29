import { WebhookEvent } from '../models/WebhookEvent';
import { LogisticsEventLog } from '../models/LogisticsEventLog';
import { NotificationLog } from '../models/NotificationLog';
import { AuditLog } from '../models/AuditLog';

export const DEFAULT_LOG_RETENTION_DAYS = 120; // 4 months
export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 365; // 1 year
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // Run once every 24 hours

export interface LogCleanupReport {
  webhooksDeleted: number;
  logisticsDeleted: number;
  notificationsDeleted: number;
  auditLogsDeleted: number;
  totalDeleted: number;
  cutoffDate: Date;
  auditCutoffDate: Date;
}

/**
 * Purges operational and transient logs older than retention window.
 *
 * NOTE ON DATA INTEGRITY:
 * - InventoryTransaction (accounting stock ledger) is NEVER deleted.
 * - PaymentAttempt (payment & audit records) is NEVER deleted.
 */
export async function cleanupExpiredLogs(options?: {
  retentionDays?: number;
  auditRetentionDays?: number;
}): Promise<LogCleanupReport> {
  const retentionDays = options?.retentionDays ?? DEFAULT_LOG_RETENTION_DAYS;
  const auditRetentionDays = options?.auditRetentionDays ?? DEFAULT_AUDIT_LOG_RETENTION_DAYS;

  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const auditCutoffDate = new Date(Date.now() - auditRetentionDays * 24 * 60 * 60 * 1000);

  const [webhooksRes, logisticsRes, notificationsRes, auditRes] = await Promise.all([
    WebhookEvent.deleteMany({ createdAt: { $lt: cutoffDate } }),
    LogisticsEventLog.deleteMany({ createdAt: { $lt: cutoffDate } }),
    NotificationLog.deleteMany({ createdAt: { $lt: cutoffDate } }),
    AuditLog.deleteMany({ createdAt: { $lt: auditCutoffDate } }),
  ]);

  const webhooksDeleted = webhooksRes.deletedCount || 0;
  const logisticsDeleted = logisticsRes.deletedCount || 0;
  const notificationsDeleted = notificationsRes.deletedCount || 0;
  const auditLogsDeleted = auditRes.deletedCount || 0;
  const totalDeleted = webhooksDeleted + logisticsDeleted + notificationsDeleted + auditLogsDeleted;

  return {
    webhooksDeleted,
    logisticsDeleted,
    notificationsDeleted,
    auditLogsDeleted,
    totalDeleted,
    cutoffDate,
    auditCutoffDate,
  };
}

let cleanupTimer: NodeJS.Timeout | null = null;

export function startLogCleanupScheduler(): void {
  if (cleanupTimer) return;
  if (process.env.NODE_ENV === 'test') return;

  const run = async (): Promise<void> => {
    try {
      const report = await cleanupExpiredLogs();
      if (report.totalDeleted > 0) {
        console.log(
          `[LOG_CLEANUP] Purged ${report.totalDeleted} expired logs ` +
          `(${report.webhooksDeleted} webhooks, ${report.logisticsDeleted} logistics, ` +
          `${report.notificationsDeleted} notifications, ${report.auditLogsDeleted} audit logs)`
        );
      }
    } catch (err) {
      console.error('[LOG_CLEANUP] Scheduled cleanup failed:', err);
    }
  };

  // Run initial pass after 30 seconds of server boot
  const initialTimeout = setTimeout(() => {
    run();
  }, 30000);
  initialTimeout.unref();

  cleanupTimer = setInterval(run, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

export function stopLogCleanupScheduler(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
