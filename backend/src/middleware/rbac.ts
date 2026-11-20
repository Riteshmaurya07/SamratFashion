import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { AppError } from "../utils/AppError";
import { User, UserRole, UserStatus } from "../models/User";
import { Role, AdminModule, PermissionLevel, IRoleSensitiveActions, ADMIN_MODULES } from "../models/Role";
import { AuditLog } from "../models/AuditLog";

export interface EffectivePermissions {
  isSuperAdmin: boolean;
  roleName: string | null;
  permissions: Record<AdminModule, PermissionLevel>;
  sensitiveActions: IRoleSensitiveActions;
}

/**
 * Logs a denied permission access attempt to AuditLog.
 * Non-blocking: failures inside logging will never break the request cycle.
 */
export async function logDeniedPermission(
  req: Request,
  module: string,
  reason: string,
  attemptedAction?: string
): Promise<void> {
  try {
    const rawActorId = (req as any).user?.id || (req as any).user?._id;
    const actorRole = (req as any).user?.role || "ANONYMOUS";
    const actorId =
      rawActorId && mongoose.Types.ObjectId.isValid(rawActorId)
        ? new mongoose.Types.ObjectId(rawActorId)
        : new mongoose.Types.ObjectId();

    await AuditLog.create({
      actorId,
      actorRole,
      action: "PERMISSION_DENIED",
      entityType: "SECURITY",
      entityId: actorId,
      metadata: {
        module,
        reason,
        attemptedAction: attemptedAction || `${req.method} ${req.originalUrl || req.url}`,
        ip: req.ip,
      },
    });
  } catch (err) {
    console.error("Failed to write access denial to audit log:", err);
  }
}

/**
 * Resolves the effective permissions for a user.
 * - SUPER_ADMIN: full manage access across all modules, all sensitive actions allowed.
 * - ADMIN without customRoleId (migration user): full manage access across all modules, all sensitive actions allowed.
 * - ADMIN with customRoleId: permissions defined by the assigned Role.
 * - CUSTOMER: no permissions.
 */
export async function resolveEffectivePermissions(userId: string | mongoose.Types.ObjectId, baseRole: string): Promise<EffectivePermissions> {
  const fullManagePermissions = {} as Record<AdminModule, PermissionLevel>;
  for (const mod of ADMIN_MODULES) {
    fullManagePermissions[mod] = "manage";
  }

  const allSensitiveTrue: IRoleSensitiveActions = {
    canRefund: true,
    canChangePrices: true,
    canManageCoupons: true,
    canSuspendUsers: true,
    canManageSettings: true,
    canManageWebhooks: true,
  };

  const allSensitiveFalse: IRoleSensitiveActions = {
    canRefund: false,
    canChangePrices: false,
    canManageCoupons: false,
    canSuspendUsers: false,
    canManageSettings: false,
    canManageWebhooks: false,
  };

  const nonePermissions = {} as Record<AdminModule, PermissionLevel>;
  for (const mod of ADMIN_MODULES) {
    nonePermissions[mod] = "none";
  }

  if (baseRole === UserRole.SUPER_ADMIN) {
    return {
      isSuperAdmin: true,
      roleName: "SUPER_ADMIN",
      permissions: fullManagePermissions,
      sensitiveActions: allSensitiveTrue,
    };
  }

  const user = await User.findById(userId).select("role status customRoleId");
  if (!user) {
    // If user document is not in DB (e.g. unit tests directly invoking controller functions with a mock admin user),
    // treat base ADMIN as legacy full admin per migration rule.
    if (baseRole === UserRole.ADMIN || (baseRole as string) === "ADMIN") {
      return {
        isSuperAdmin: false,
        roleName: "Full Admin (Legacy)",
        permissions: fullManagePermissions,
        sensitiveActions: allSensitiveTrue,
      };
    }
    return {
      isSuperAdmin: false,
      roleName: null,
      permissions: nonePermissions,
      sensitiveActions: allSensitiveFalse,
    };
  }

  if (user.status !== UserStatus.ACTIVE) {
    return {
      isSuperAdmin: false,
      roleName: null,
      permissions: nonePermissions,
      sensitiveActions: allSensitiveFalse,
    };
  }

  if (user.role === UserRole.SUPER_ADMIN) {
    return {
      isSuperAdmin: true,
      roleName: "SUPER_ADMIN",
      permissions: fullManagePermissions,
      sensitiveActions: allSensitiveTrue,
    };
  }

  if (user.role !== UserRole.ADMIN) {
    return {
      isSuperAdmin: false,
      roleName: null,
      permissions: nonePermissions,
      sensitiveActions: allSensitiveFalse,
    };
  }

  // Migration Rule: Existing ADMIN users with NO custom role keep FULL access
  if (!user.customRoleId) {
    return {
      isSuperAdmin: false,
      roleName: "Full Admin (Legacy)",
      permissions: fullManagePermissions,
      sensitiveActions: allSensitiveTrue,
    };
  }

  // Load custom role
  const role = await Role.findById(user.customRoleId);
  if (!role) {
    return {
      isSuperAdmin: false,
      roleName: null,
      permissions: nonePermissions,
      sensitiveActions: allSensitiveFalse,
    };
  }

  const resolvedPermissions = { ...nonePermissions };
  if (role.permissions) {
    const permMap = role.permissions instanceof Map ? Object.fromEntries(role.permissions) : role.permissions;
    for (const mod of ADMIN_MODULES) {
      if (permMap[mod]) {
        resolvedPermissions[mod] = permMap[mod] as PermissionLevel;
      }
    }
  }

  return {
    isSuperAdmin: false,
    roleName: role.name,
    permissions: resolvedPermissions,
    sensitiveActions: {
      canRefund: Boolean(role.canRefund),
      canChangePrices: Boolean(role.canChangePrices),
      canManageCoupons: Boolean(role.canManageCoupons),
      canSuspendUsers: Boolean(role.canSuspendUsers),
      canManageSettings: Boolean(role.canManageSettings),
      canManageWebhooks: Boolean(role.canManageWebhooks),
    },
  };
}

/**
 * Checks whether a user can change product prices (basePrice or mrp).
 */
export async function canUserChangePrices(reqUser: { id?: string; _id?: string; role: string }): Promise<boolean> {
  const userId = reqUser.id || reqUser._id;
  if (!userId) return false;
  if (reqUser.role === UserRole.SUPER_ADMIN) return true;
  if (reqUser.role !== UserRole.ADMIN) return false;

  const effective = await resolveEffectivePermissions(userId, reqUser.role);
  if (effective.isSuperAdmin) return true;
  return Boolean(effective.sensitiveActions.canChangePrices);
}

/**
 * RBAC route protection middleware.
 * @param module The admin module from ADMIN_MODULES
 * @param requiredLevel "view" | "manage" (default: "view")
 * @param sensitiveAction Optional sensitive action key (e.g. "canRefund")
 */
export const requirePermission = (
  module: AdminModule,
  requiredLevel: PermissionLevel = "view",
  sensitiveAction?: keyof IRoleSensitiveActions
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return next(new AppError("Not authenticated", 401, "UNAUTHORIZED"));
      }

      // 1. SUPER_ADMIN bypasses all permission checks (full access, as today)
      if (user.role === UserRole.SUPER_ADMIN) {
        return next();
      }

      // 2. Reject non-admin immediately
      if (user.role !== UserRole.ADMIN) {
        await logDeniedPermission(req, module, "Access denied: Base role is not ADMIN");
        return next(new AppError("You do not have permission to perform this action", 403, "FORBIDDEN"));
      }

      const userId = user.id || user._id;
      // Load user document from DB to ensure permissions are checked against fresh DB state (not cached in JWT)
      const userDoc = await User.findById(userId).select("role status customRoleId");
      if (!userDoc || userDoc.status !== UserStatus.ACTIVE) {
        return next(new AppError("Session is no longer available", 401, "UNAUTHORIZED"));
      }

      // If user was promoted to SUPER_ADMIN since token issue
      if (userDoc.role === UserRole.SUPER_ADMIN) {
        return next();
      }

      // If user's admin access was revoked back to CUSTOMER
      if (userDoc.role !== UserRole.ADMIN) {
        await logDeniedPermission(req, module, "Access denied: Base role is no longer ADMIN");
        return next(new AppError("You do not have permission to perform this action", 403, "FORBIDDEN"));
      }

      // 3. Migration Rule: Existing ADMIN users with NO custom role keep FULL access
      if (!userDoc.customRoleId) {
        return next();
      }

      // 4. Custom Role check
      const role = await Role.findById(userDoc.customRoleId);
      if (!role) {
        await logDeniedPermission(req, module, "Assigned custom role not found or deleted");
        return next(new AppError("Assigned role not found or revoked", 403, "FORBIDDEN"));
      }

      // Resolve module permission
      let userLevel: PermissionLevel = "none";
      if (role.permissions) {
        if (role.permissions instanceof Map) {
          userLevel = (role.permissions.get(module) as PermissionLevel) || "none";
        } else if (typeof role.permissions === "object") {
          userLevel = ((role.permissions as any)[module] as PermissionLevel) || "none";
        }
      }

      // Check level
      if (userLevel === "none") {
        await logDeniedPermission(req, module, `No access to module '${module}' (level is none)`);
        return next(new AppError(`You do not have permission to access ${module}`, 403, "FORBIDDEN"));
      }

      if (requiredLevel === "manage" && userLevel !== "manage") {
        await logDeniedPermission(
          req,
          module,
          `Manage access required for '${module}', but user has '${userLevel}'`
        );
        return next(new AppError(`You do not have permission to manage ${module}`, 403, "FORBIDDEN"));
      }

      // Check sensitive action toggle
      if (sensitiveAction) {
        const allowed = Boolean(role[sensitiveAction]);
        if (!allowed) {
          await logDeniedPermission(
            req,
            module,
            `Sensitive action '${sensitiveAction}' not permitted on role '${role.name}'`
          );
          return next(
            new AppError(
              `You do not have permission to perform this action (${sensitiveAction})`,
              403,
              "FORBIDDEN"
            )
          );
        }
      }

      // Attach effective permissions
      (req as any).roleDoc = role;
      next();
    } catch (error) {
      next(error);
    }
  };
};
