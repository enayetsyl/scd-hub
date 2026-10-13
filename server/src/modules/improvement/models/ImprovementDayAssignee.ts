import { Schema, model, Document, Types } from "mongoose";

/**
 * ImprovementDayAssignee (SP-3, D-#736) — Office/Principal's per-day override of WHO does
 * an action's teacher task, set on the leave cover screen. It wins over the derived
 * default (the period cover teacher, else the assigned teacher). A missing row means
 * "use the default". Only the teacher part has an assignee; guardians are never assigned.
 */
export interface IImprovementDayAssignee extends Document {
  _id: Types.ObjectId;
  actionId: Types.ObjectId;
  dayKey: string;
  userId: Types.ObjectId;
  setBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ImprovementDayAssigneeSchema = new Schema<IImprovementDayAssignee>(
  {
    actionId: { type: Schema.Types.ObjectId, ref: "ImprovementAction", required: true },
    dayKey: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    setBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ImprovementDayAssigneeSchema.index({ actionId: 1, dayKey: 1 }, { unique: true });
ImprovementDayAssigneeSchema.index({ dayKey: 1, userId: 1 });

export const ImprovementDayAssignee = model<IImprovementDayAssignee>(
  "ImprovementDayAssignee",
  ImprovementDayAssigneeSchema,
);
