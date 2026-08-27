import mongoose, { Document, Schema } from "mongoose";

export enum PrintJobStatus {
  PENDING_REVIEW = "PENDING_REVIEW",
  READY_FOR_PRINT = "READY_FOR_PRINT",
  PRINTING = "PRINTING",
  QUALITY_CHECK = "QUALITY_CHECK",
  PRINTED = "PRINTED",
  COMPLETED = "COMPLETED",
  REJECTED = "REJECTED",
}

export enum PrintJobPriority {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export interface IProductionNote {
  text: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

export interface IPrintJob extends Document {
  orderId: mongoose.Types.ObjectId;
  orderItemId: string;
  customDesignId: mongoose.Types.ObjectId;
  status: PrintJobStatus;
  priority: PrintJobPriority;
  printLocations: ("FRONT" | "BACK")[];
  printMethod: string;
  notes: IProductionNote[];
  exportVersion: number;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const printJobSchema = new Schema<IPrintJob>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    orderItemId: { type: String, required: true },
    customDesignId: { type: Schema.Types.ObjectId, ref: "CustomDesign", required: true },
    status: {
      type: String,
      enum: Object.values(PrintJobStatus),
      default: PrintJobStatus.PENDING_REVIEW,
      index: true,
    },
    priority: {
      type: String,
      enum: Object.values(PrintJobPriority),
      default: PrintJobPriority.MEDIUM,
    },
    printLocations: [{ type: String, enum: ["FRONT", "BACK"], default: ["FRONT"] }],
    printMethod: { type: String, default: "DTG", trim: true },
    notes: [
      {
        text: { type: String, required: true, trim: true },
        createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    exportVersion: { type: Number, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
  }
);

printJobSchema.index({ orderId: 1, orderItemId: 1 }, { unique: true });

export const PrintJob = mongoose.model<IPrintJob>("PrintJob", printJobSchema);
