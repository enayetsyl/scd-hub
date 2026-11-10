import { Schema, model, Document, Types } from "mongoose";

/**
 * AiProject (AI Workspace W-1, docs/prd-ai-workspace.md §3) — a Claude-style project: a name,
 * versioned instructions (kept in AiPolicy under `project:<id>`, D-#1202), knowledge files
 * (AiProjectFile), members and defaults.
 *
 *   members        owner | editor | viewer. The creator is the first owner. Holders of
 *                  `ai_workspace:admin` (the Principal) reach every project as an owner.
 *   defaultModel / defaultThinking  start from the workspace defaults (AiBudgetSetting,
 *                  D-#1206: thinking high) and can be changed per project; the chat pickers
 *                  (W-2) override them per message.
 *   nameProtection ON = the de-identification + fail-closed roster gate runs on every turn;
 *                  OFF (content projects) = no gate, only a soft warning (D-#1207).
 *   monthlyCapUsd  the project's own cap, inside the workspace cap; null = none (D-#1225).
 *
 * Platform plane, not the corpus plane: the only identity it holds is user ids for
 * authorship and membership (ADR-005).
 */
export const AI_PROJECT_ROLES = ["owner", "editor", "viewer"] as const;
export type AiProjectRole = (typeof AI_PROJECT_ROLES)[number];

export interface IAiProjectMember {
  userId: Types.ObjectId;
  role: AiProjectRole;
}

export interface IAiProject extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  /** From SCHOOL_BRANCH (default "sylhet"), as on AiUsage. */
  branch: string;
  ownerId: Types.ObjectId;
  members: IAiProjectMember[];
  defaultModel: string;
  defaultThinking: "off" | "low" | "high";
  nameProtection: boolean;
  monthlyCapUsd?: number | null;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MemberSchema = new Schema<IAiProjectMember>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, required: true, enum: AI_PROJECT_ROLES },
  },
  { _id: false },
);

const AiProjectSchema = new Schema<IAiProject>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 2000 },
    branch: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    members: { type: [MemberSchema], default: [] },
    defaultModel: { type: String, required: true },
    defaultThinking: { type: String, required: true, enum: ["off", "low", "high"] },
    nameProtection: { type: Boolean, required: true },
    monthlyCapUsd: { type: Number, min: 0, default: null },
    archived: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

AiProjectSchema.index({ "members.userId": 1, archived: 1, updatedAt: -1 });
AiProjectSchema.index({ archived: 1, updatedAt: -1 });

export const AiProject = model<IAiProject>("AiProject", AiProjectSchema);
