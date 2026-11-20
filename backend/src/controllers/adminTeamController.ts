import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { User, UserRole, UserStatus } from "../models/User";
import { Role, ADMIN_MODULES, AdminModule, PermissionLevel } from "../models/Role";
import { Session } from "../models/Session";
import { AuditLog } from "../models/AuditLog";
import { AppError } from "../utils/AppError";
import { isBulkOrderEnabled, isCustomDesignEnabled } from "../config/features";
import { resolveEffectivePermissions } from "../middleware/rbac";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    customRoleId?: string | null;
  };
}

/**
 * Helper to ensure the last SUPER_ADMIN cannot be demoted or locked out.
 */
async function ensureNotLastSuperAdmin(targetUserId: string): Promise<void> {
  const superAdminCount = await User.countDocuments({ role: UserRole.SUPER_ADMIN });
  if (superAdminCount <= 1) {
    const target = await User.findById(targetUserId);
    if (target && target.role === UserRole.SUPER_ADMIN) {
      throw new AppError("Cannot demote or remove the last SUPER_ADMIN of the store.", 400, "LAST_SUPER_ADMIN");
    }
  }
}

/**
 * List all staff members (users with base role ADMIN or SUPER_ADMIN, or with customRoleId assigned).
 */
export const getTeamMembers = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const staff = await User.find({
      $or: [
        { role: { $in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } },
        { customRoleId: { $ne: null } },
      ],
    })
      .populate("customRoleId", "name description")
      .select("-passwordHash")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: staff,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Search registered customers by email to add them as staff.
 */
export const searchStaffCandidates = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = typeof req.query.email === "string" ? req.query.email.trim() : "";
    if (!query || query.length < 2) {
      return res.status(200).json({ success: true, data: [] });
    }

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const candidates = await User.find({
      email: { $regex: escapedQuery, $options: "i" },
    })
      .select("_id name email role status emailVerified customRoleId")
      .limit(10);

    res.status(200).json({
      success: true,
      data: candidates,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Assign or change a custom role on a user. Also flips base role to ADMIN.
 */
export const assignStaffRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId);
    const { roleId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError("Invalid user ID", 400);
    }
    if (!roleId || !mongoose.Types.ObjectId.isValid(roleId)) {
      throw new AppError("A valid roleId is required", 400);
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      throw new AppError("User not found", 404, "NOT_FOUND");
    }

    // Safety: if target is SUPER_ADMIN and someone tries to change their role
    if (targetUser.role === UserRole.SUPER_ADMIN) {
      if (req.user?.id === targetUser._id.toString()) {
        throw new AppError("The store owner cannot alter or demote their own SUPER_ADMIN role.", 403, "CANNOT_DEMOTE_SELF");
      }
      await ensureNotLastSuperAdmin(userId);
    }

    const role = await Role.findById(roleId);
    if (!role) {
      throw new AppError("Custom role not found", 404, "ROLE_NOT_FOUND");
    }

    const previousRole = targetUser.role;
    const previousCustomRoleId = targetUser.customRoleId;

    targetUser.customRoleId = role._id as mongoose.Types.ObjectId;
    targetUser.role = UserRole.ADMIN;
    targetUser.tokenVersion = (targetUser.tokenVersion || 0) + 1;
    await targetUser.save();

    await AuditLog.create({
      actorId: new mongoose.Types.ObjectId(req.user!.id),
      actorRole: req.user!.role,
      action: "STAFF_ROLE_ASSIGNED",
      entityType: "USER",
      entityId: targetUser._id,
      metadata: {
        roleId: role._id,
        roleName: role.name,
        targetEmail: targetUser.email,
        previousRole,
        previousCustomRoleId,
      },
    });

    res.status(200).json({
      success: true,
      message: `Successfully assigned role "${role.name}" to ${targetUser.email}`,
      data: {
        userId: targetUser._id,
        role: targetUser.role,
        customRoleId: targetUser.customRoleId,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Remove staff access from a user (flips base role to CUSTOMER, removes customRoleId, revokes all sessions).
 */
export const removeStaffRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId);

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError("Invalid user ID", 400);
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      throw new AppError("User not found", 404, "NOT_FOUND");
    }

    // Safety checks
    if (req.user?.id === targetUser._id.toString()) {
      throw new AppError("You cannot remove your own admin access.", 403, "CANNOT_DEMOTE_SELF");
    }
    if (targetUser.role === UserRole.SUPER_ADMIN) {
      await ensureNotLastSuperAdmin(userId);
    }

    const previousRole = targetUser.role;
    const previousCustomRoleId = targetUser.customRoleId;

    targetUser.customRoleId = null;
    targetUser.role = UserRole.CUSTOMER;
    targetUser.tokenVersion = (targetUser.tokenVersion || 0) + 1;
    await targetUser.save();

    // Revoke all active sessions immediately
    await Session.updateMany(
      { userId: targetUser._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } }
    );

    await AuditLog.create({
      actorId: new mongoose.Types.ObjectId(req.user!.id),
      actorRole: req.user!.role,
      action: "STAFF_ROLE_REMOVED",
      entityType: "USER",
      entityId: targetUser._id,
      metadata: {
        targetEmail: targetUser.email,
        previousRole,
        previousCustomRoleId,
      },
    });

    res.status(200).json({
      success: true,
      message: `Staff access revoked for ${targetUser.email}. Base role reverted to CUSTOMER and all sessions terminated.`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Suspend or reactivate staff member account.
 */
export const updateStaffStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId);
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError("Invalid user ID", 400);
    }
    if (!status || ![UserStatus.ACTIVE, UserStatus.SUSPENDED].includes(status)) {
      throw new AppError("Valid status (ACTIVE or SUSPENDED) is required", 400);
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      throw new AppError("User not found", 404, "NOT_FOUND");
    }

    // Safety: Cannot suspend self or last SUPER_ADMIN
    if (req.user?.id === targetUser._id.toString()) {
      throw new AppError("You cannot suspend your own account.", 403, "CANNOT_SUSPEND_SELF");
    }
    if (targetUser.role === UserRole.SUPER_ADMIN) {
      await ensureNotLastSuperAdmin(userId);
    }

    targetUser.status = status;
    if (status === UserStatus.SUSPENDED) {
      targetUser.tokenVersion = (targetUser.tokenVersion || 0) + 1;
      await Session.updateMany(
        { userId: targetUser._id, revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date() } }
      );
    }
    await targetUser.save();

    await AuditLog.create({
      actorId: new mongoose.Types.ObjectId(req.user!.id),
      actorRole: req.user!.role,
      action: status === UserStatus.SUSPENDED ? "STAFF_SUSPENDED" : "STAFF_REACTIVATED",
      entityType: "USER",
      entityId: targetUser._id,
      metadata: {
        targetEmail: targetUser.email,
        newStatus: status,
      },
    });

    res.status(200).json({
      success: true,
      message: `Staff account status updated to ${status}`,
      data: {
        userId: targetUser._id,
        status: targetUser.status,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all custom roles with user count.
 */
export const getRoles = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const roles = await Role.find().sort({ createdAt: -1 });

    const rolesWithCounts = await Promise.all(
      roles.map(async (role) => {
        const userCount = await User.countDocuments({ customRoleId: role._id });
        const obj = role.toObject();
        if (role.permissions instanceof Map) {
          obj.permissions = Object.fromEntries(role.permissions);
        }
        return {
          ...obj,
          userCount,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: rolesWithCounts,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new custom role.
 */
export const createRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      name,
      description,
      permissions,
      canRefund,
      canChangePrices,
      canManageCoupons,
      canSuspendUsers,
      canManageSettings,
      canManageWebhooks,
    } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      throw new AppError("Role name is required", 400);
    }

    const trimmedName = name.trim();
    const existing = await Role.findOne({ name: { $regex: new RegExp(`^${trimmedName}$`, "i") } });
    if (existing) {
      throw new AppError(`A role named "${trimmedName}" already exists`, 409, "DUPLICATE_ROLE_NAME");
    }

    // Validate and sanitize permissions map
    const cleanPermissions = {} as Record<AdminModule, PermissionLevel>;
    for (const mod of ADMIN_MODULES) {
      const level = permissions && permissions[mod] ? permissions[mod] : "none";
      if (!["none", "view", "manage"].includes(level)) {
        throw new AppError(`Invalid permission level '${level}' for module '${mod}'`, 400);
      }
      cleanPermissions[mod] = level as PermissionLevel;
    }

    const role = await Role.create({
      name: trimmedName,
      description: typeof description === "string" ? description.trim() : "",
      permissions: cleanPermissions,
      canRefund: Boolean(canRefund),
      canChangePrices: Boolean(canChangePrices),
      canManageCoupons: Boolean(canManageCoupons),
      canSuspendUsers: Boolean(canSuspendUsers),
      canManageSettings: Boolean(canManageSettings),
      canManageWebhooks: Boolean(canManageWebhooks),
      createdBy: new mongoose.Types.ObjectId(req.user!.id),
    });

    await AuditLog.create({
      actorId: new mongoose.Types.ObjectId(req.user!.id),
      actorRole: req.user!.role,
      action: "ROLE_CREATED",
      entityType: "ROLE",
      entityId: role._id,
      metadata: {
        name: role.name,
        canRefund: role.canRefund,
        canChangePrices: role.canChangePrices,
        canManageCoupons: role.canManageCoupons,
        canSuspendUsers: role.canSuspendUsers,
        canManageSettings: role.canManageSettings,
        canManageWebhooks: role.canManageWebhooks,
      },
    });

    res.status(201).json({
      success: true,
      message: `Role "${role.name}" created successfully`,
      data: role,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update an existing custom role.
 */
export const updateRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const roleId = String(req.params.roleId);
    const {
      name,
      description,
      permissions,
      canRefund,
      canChangePrices,
      canManageCoupons,
      canSuspendUsers,
      canManageSettings,
      canManageWebhooks,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(roleId)) {
      throw new AppError("Invalid role ID", 400);
    }

    const role = await Role.findById(roleId);
    if (!role) {
      throw new AppError("Role not found", 404, "NOT_FOUND");
    }

    if (name && typeof name === "string" && name.trim() !== role.name) {
      const trimmedName = name.trim();
      const existing = await Role.findOne({
        name: { $regex: new RegExp(`^${trimmedName}$`, "i") },
        _id: { $ne: role._id },
      });
      if (existing) {
        throw new AppError(`A role named "${trimmedName}" already exists`, 409, "DUPLICATE_ROLE_NAME");
      }
      role.name = trimmedName;
    }

    if (description !== undefined) {
      role.description = typeof description === "string" ? description.trim() : "";
    }

    if (permissions && typeof permissions === "object") {
      const cleanPermissions = {} as Record<AdminModule, PermissionLevel>;
      for (const mod of ADMIN_MODULES) {
        const level = permissions[mod] !== undefined ? permissions[mod] : "none";
        if (!["none", "view", "manage"].includes(level)) {
          throw new AppError(`Invalid permission level '${level}' for module '${mod}'`, 400);
        }
        cleanPermissions[mod] = level as PermissionLevel;
      }
      role.permissions = cleanPermissions;
    }

    if (canRefund !== undefined) role.canRefund = Boolean(canRefund);
    if (canChangePrices !== undefined) role.canChangePrices = Boolean(canChangePrices);
    if (canManageCoupons !== undefined) role.canManageCoupons = Boolean(canManageCoupons);
    if (canSuspendUsers !== undefined) role.canSuspendUsers = Boolean(canSuspendUsers);
    if (canManageSettings !== undefined) role.canManageSettings = Boolean(canManageSettings);
    if (canManageWebhooks !== undefined) role.canManageWebhooks = Boolean(canManageWebhooks);

    await role.save();

    await AuditLog.create({
      actorId: new mongoose.Types.ObjectId(req.user!.id),
      actorRole: req.user!.role,
      action: "ROLE_UPDATED",
      entityType: "ROLE",
      entityId: role._id,
      metadata: {
        name: role.name,
      },
    });

    res.status(200).json({
      success: true,
      message: `Role "${role.name}" updated successfully`,
      data: role,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a custom role.
 * Safety: Refused if any users are currently assigned to this role, or if caller is currently using it.
 */
export const deleteRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const roleId = String(req.params.roleId);

    if (!mongoose.Types.ObjectId.isValid(roleId)) {
      throw new AppError("Invalid role ID", 400);
    }

    const role = await Role.findById(roleId);
    if (!role) {
      throw new AppError("Role not found", 404, "NOT_FOUND");
    }

    // Safety: Check if caller is using this role
    if (req.user?.customRoleId && req.user.customRoleId.toString() === roleId) {
      throw new AppError("You cannot delete a role you are currently using.", 400, "CANNOT_DELETE_OWN_ROLE");
    }

    // Safety: Refuse if users are assigned
    const assignedCount = await User.countDocuments({ customRoleId: role._id });
    if (assignedCount > 0) {
      throw new AppError(
        `Cannot delete role "${role.name}": ${assignedCount} user(s) are currently assigned to this role. Please reassign or remove their roles before deleting.`,
        400,
        "ROLE_IN_USE"
      );
    }

    await Role.findByIdAndDelete(role._id);

    await AuditLog.create({
      actorId: new mongoose.Types.ObjectId(req.user!.id),
      actorRole: req.user!.role,
      action: "ROLE_DELETED",
      entityType: "ROLE",
      entityId: role._id,
      metadata: {
        name: role.name,
      },
    });

    res.status(200).json({
      success: true,
      message: `Role "${role.name}" deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Fetch the authenticated admin user's effective permissions and feature flags.
 * Used once per session by frontend to render the sidebar and guard routes.
 */
export const getMyPermissions = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.id) {
      throw new AppError("Not authenticated", 401, "UNAUTHORIZED");
    }

    const effective = await resolveEffectivePermissions(req.user.id, req.user.role);

    res.status(200).json({
      success: true,
      data: {
        ...effective,
        features: {
          customDesign: isCustomDesignEnabled(),
          bulkOrders: isBulkOrderEnabled(),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
