import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { SupportTicket, SupportCategory, SupportPriority, SupportStatus } from "../models/SupportTicket";
import { Order } from "../models/Order";
import { AppError } from "../utils/AppError";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

const ticketInputSchema = z.object({
  subject: z.string().min(5).max(120),
  category: z.nativeEnum(SupportCategory),
  description: z.string().min(10).max(2000),
  orderId: z.string().optional(),
});

// Helper: Generate unique human-friendly ticket number (e.g. SF-TKT-2026-104928)
async function generateTicketNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const randomDigits = Math.floor(100000 + Math.random() * 900000);
  const ticketNum = `SF-TKT-${year}-${randomDigits}`;

  const exists = await SupportTicket.findOne({ ticketNumber: ticketNum });
  if (exists) return generateTicketNumber();
  return ticketNum;
}

// 1. Create Support Ticket (Customer)
export const createTicket = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const parseResult = ticketInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return next(new AppError(parseResult.error.issues[0]?.message || "Invalid support ticket data", 400));
    }

    const { subject, category, description, orderId } = parseResult.data;

    let verifiedOrderId: mongoose.Types.ObjectId | undefined = undefined;
    if (orderId) {
      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return next(new AppError("Invalid Order ID format", 400));
      }
      const order = await Order.findOne({ _id: orderId, userId: req.user.id });
      if (!order) {
        return next(new AppError("Order reference not found or does not belong to your account", 400));
      }
      verifiedOrderId = order._id as mongoose.Types.ObjectId;
    }

    const ticketNumber = await generateTicketNumber();

    const ticket = await SupportTicket.create({
      ticketNumber,
      userId: req.user.id,
      subject: subject.trim(),
      category,
      priority: SupportPriority.MEDIUM,
      status: SupportStatus.OPEN,
      orderId: verifiedOrderId,
      messages: [
        {
          senderId: new mongoose.Types.ObjectId(req.user.id),
          senderRole: "CUSTOMER",
          body: description.trim(),
          createdAt: new Date(),
        },
      ],
    });

    res.status(201).json({
      success: true,
      message: "Support ticket created successfully.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get Customer's Support Tickets & Recent Orders
export const getMyTickets = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const tickets = await SupportTicket.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .populate("orderId", "orderNumber status total");

    const recentOrders = await Order.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("orderNumber items status total createdAt");

    res.status(200).json({
      success: true,
      data: {
        tickets,
        recentOrders,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 3. Get Single Ticket Detail Scoped to Customer
export const getTicketById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return next(new AppError("Invalid Ticket ID", 400));
    }

    const ticket = await SupportTicket.findOne({ _id: id, userId: req.user.id })
      .populate("orderId", "orderNumber status items total")
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

// 4. Add Reply Message to Ticket (Customer)
export const addCustomerMessage = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const { id } = req.params;
    const { body } = req.body;

    if (!body || !body.trim()) {
      return next(new AppError("Message body cannot be empty", 400));
    }

    const ticket = await SupportTicket.findOne({ _id: id, userId: req.user.id });
    if (!ticket) {
      return next(new AppError("Support ticket not found", 404));
    }

    if (ticket.status === SupportStatus.CLOSED) {
      return next(new AppError("Cannot send messages to a closed support ticket", 400));
    }

    ticket.messages.push({
      senderId: new mongoose.Types.ObjectId(req.user.id),
      senderRole: "CUSTOMER",
      body: body.trim(),
      createdAt: new Date(),
    });

    if (ticket.status === SupportStatus.WAITING_FOR_CUSTOMER) {
      ticket.status = SupportStatus.IN_PROGRESS;
    }

    await ticket.save();

    res.status(200).json({
      success: true,
      message: "Message added to ticket conversation.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// 5. Close Ticket (Customer)
export const closeTicket = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const { id } = req.params;
    const ticket = await SupportTicket.findOne({ _id: id, userId: req.user.id });
    if (!ticket) {
      return next(new AppError("Support ticket not found", 404));
    }

    ticket.status = SupportStatus.CLOSED;
    await ticket.save();

    res.status(200).json({
      success: true,
      message: "Ticket marked as closed.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};
