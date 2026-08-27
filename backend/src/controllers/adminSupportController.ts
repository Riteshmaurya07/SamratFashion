import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { SupportTicket, SupportPriority, SupportStatus } from "../models/SupportTicket";
import { User } from "../models/User";
import { AuditLog } from "../models/AuditLog";
import { AppError } from "../utils/AppError";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

// 1. Get Paginated Admin Support Tickets
export const getAdminTickets = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;

    const status = req.query.status as string;
    const priority = req.query.priority as string;
    const category = req.query.category as string;
    const q = req.query.q as string;

    const filter: any = {};
    if (status && status !== "All") filter.status = status;
    if (priority && priority !== "All") filter.priority = priority;
    if (category && category !== "All") filter.category = category;

    const totalTickets = await SupportTicket.countDocuments(filter);
    const tickets = await SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name email")
      .populate("assignedAdmin", "name email")
      .populate("orderId", "orderNumber status total");

    let results = tickets;
    if (q) {
      const lower = q.toLowerCase();
      results = results.filter(
        (t: any) =>
          t.ticketNumber.toLowerCase().includes(lower) ||
          t.subject.toLowerCase().includes(lower) ||
          t.userId?.name?.toLowerCase().includes(lower) ||
          t.orderId?.orderNumber?.toLowerCase().includes(lower)
      );
    }

    res.status(200).json({
      success: true,
      data: results,
      pagination: {
        page,
        limit,
        total: totalTickets,
        pages: Math.ceil(totalTickets / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get Single Admin Support Ticket Detail
export const getAdminTicketById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return next(new AppError("Invalid Ticket ID", 400));
    }

    const ticket = await SupportTicket.findById(id)
      .populate("userId", "name email phone")
      .populate("assignedAdmin", "name email")
      .populate("orderId")
      .populate("messages.senderId", "name email role");

    if (!ticket) {
      return next(new AppError("Support ticket not found", 404));
    }

    res.status(200).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Update Support Ticket Status State Machine
export const updateTicketStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!Object.values(SupportStatus).includes(status)) {
      return next(new AppError("Invalid ticket status value", 400));
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return next(new AppError("Support ticket not found", 404));
    }

    const prevStatus = ticket.status;
    ticket.status = status as SupportStatus;
    if (status === SupportStatus.RESOLVED && !ticket.resolvedAt) {
      ticket.resolvedAt = new Date();
    }

    await ticket.save();

    // Log Action
    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_SUPPORT_STATUS_CHANGED",
        entityType: "SUPPORT_TICKET",
        entityId: ticket._id.toString(),
        metadata: { prevStatus, newStatus: status },
      });
    }

    res.status(200).json({
      success: true,
      message: `Support ticket status updated to ${status}`,
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Update Priority
export const updateTicketPriority = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { priority } = req.body;

    if (!Object.values(SupportPriority).includes(priority)) {
      return next(new AppError("Invalid priority value", 400));
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return next(new AppError("Support ticket not found", 404));
    }

    ticket.priority = priority as SupportPriority;
    await ticket.save();

    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_SUPPORT_PRIORITY_CHANGED",
        entityType: "SUPPORT_TICKET",
        entityId: ticket._id.toString(),
        metadata: { newPriority: priority },
      });
    }

    res.status(200).json({
      success: true,
      message: `Ticket priority updated to ${priority}`,
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// 5. Add Admin Reply Message
export const addAdminReply = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const { id } = req.params;
    const { body } = req.body;

    if (!body || !body.trim()) {
      return next(new AppError("Reply body cannot be empty", 400));
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return next(new AppError("Support ticket not found", 404));
    }

    ticket.messages.push({
      senderId: new mongoose.Types.ObjectId(req.user.id),
      senderRole: (req.user.role as any) || "ADMIN",
      body: body.trim(),
      createdAt: new Date(),
    });

    if (ticket.status === SupportStatus.OPEN || ticket.status === SupportStatus.IN_PROGRESS) {
      ticket.status = SupportStatus.WAITING_FOR_CUSTOMER;
    }

    await ticket.save();

    await AuditLog.create({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "ADMIN_SUPPORT_REPLIED",
      entityType: "SUPPORT_TICKET",
      entityId: ticket._id.toString(),
    });

    res.status(200).json({
      success: true,
      message: "Admin reply added to ticket conversation.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// 6. Assign Ticket to Admin
export const assignAdminTicket = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { adminId } = req.body;

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return next(new AppError("Support ticket not found", 404));
    }

    if (adminId) {
      const adminUser = await User.findById(adminId);
      if (!adminUser || (adminUser.role !== "ADMIN" && adminUser.role !== "SUPER_ADMIN")) {
        return next(new AppError("Assigned user must be an ADMIN or SUPER_ADMIN", 400));
      }
      ticket.assignedAdmin = adminUser._id as mongoose.Types.ObjectId;
    } else {
      ticket.assignedAdmin = undefined;
    }

    await ticket.save();

    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_SUPPORT_ASSIGNED",
        entityType: "SUPPORT_TICKET",
        entityId: ticket._id.toString(),
        metadata: { assignedAdmin: adminId },
      });
    }

    res.status(200).json({
      success: true,
      message: "Ticket assignment updated.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};
