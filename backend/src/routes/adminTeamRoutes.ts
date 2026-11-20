import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { UserRole } from "../models/User";
import {
  getTeamMembers,
  searchStaffCandidates,
  assignStaffRole,
  removeStaffRole,
  updateStaffStatus,
  getRoles,
  createRole,
  updateRole,
  deleteRole,
} from "../controllers/adminTeamController";

const router = Router();

// Protect ALL team management endpoints: SUPER_ADMIN ONLY
router.use(requireAuth);
router.use(requireRole(UserRole.SUPER_ADMIN));

// Staff members
router.get("/members", getTeamMembers);
router.get("/search-candidates", searchStaffCandidates);
router.post("/members/:userId/role", assignStaffRole);
router.delete("/members/:userId/role", removeStaffRole);
router.patch("/members/:userId/status", updateStaffStatus);

// Roles
router.get("/roles", getRoles);
router.post("/roles", createRole);
router.put("/roles/:roleId", updateRole);
router.delete("/roles/:roleId", deleteRole);

export default router;
