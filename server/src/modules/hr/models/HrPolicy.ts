import { Schema, model, Document, Types } from "mongoose";

/**
 * HrPolicy — the school-wide HR numbers, as admin-edited DATA with READ-TIME
 * DEFAULTS (SH-3; docs/prd-staff-hub.md §4, D-#539/#541).
 *
 * The D-#97 / `LibraryPolicy` posture, and it matters here for the same reason:
 * this repo shares ONE live Atlas across every worktree and the deployed app, so a
 * seed or a startup upsert would be a write against real payroll inputs the moment
 * the code lands. Instead there is AT MOST ONE row, it may not exist, and
 * `HR_POLICY_DEFAULTS` in /shared is what an absent row reads as.
 *
 * Singleton enforcement is the `key` field: a fixed literal with a unique index, so
 * a second row is a duplicate-key error rather than a silently-ignored second policy.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IHrPolicy extends Document {
  _id: Types.ObjectId;
  /** Always "default" — the singleton key (unique). */
  key: string;
  /** The ONE annual pool casual + sick + bereavement draw from (D-#539). */
  annualLeaveDays: number;
  /** How many LATE days cost one charged day (D-#541). */
  lateDaysPerCharge: number;
  /** Master switch for the lateness rule. Ships FALSE (prd-hr H4.3 made it opt-in). */
  latenessRuleEnabled: boolean;
  /**
   * How long probation runs, in months (D-#586). Six here; the Dhaka branch uses three,
   * which is exactly why it is policy DATA and not a constant. It never decides whether
   * someone is on probation — only when theirs was due to end.
   */
  probationMonths: number;
  /** Master switch for the probation held-debt ledger (D-#540). */
  probationDebtEnabled: boolean;
  /** Letter defaults (SH-1) — the signatory is DATA so it changes without a deploy. */
  signatoryName: string;
  signatoryTitle: string;
  weeklyHoursText: string;
  /** The Bangla support-staff contract block (D-#586). */
  employerNameBn: string;
  employerAddressBn: string;
  signatoryNameBn: string;
  signatoryTitleBn: string;
  letterRefPrefix: string;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const HrPolicySchema = new Schema<IHrPolicy>(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    annualLeaveDays: { type: Number, required: true, min: 0 },
    lateDaysPerCharge: { type: Number, required: true, min: 1 },
    latenessRuleEnabled: { type: Boolean, required: true, default: false },
    probationMonths: { type: Number, min: 0 },
    probationDebtEnabled: { type: Boolean, required: true, default: true },
    signatoryName: { type: String, trim: true },
    signatoryTitle: { type: String, trim: true },
    weeklyHoursText: { type: String, trim: true },
    employerNameBn: { type: String, trim: true },
    employerAddressBn: { type: String, trim: true },
    signatoryNameBn: { type: String, trim: true },
    signatoryTitleBn: { type: String, trim: true },
    letterRefPrefix: { type: String, trim: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export const HrPolicy = model<IHrPolicy>("HrPolicy", HrPolicySchema);
