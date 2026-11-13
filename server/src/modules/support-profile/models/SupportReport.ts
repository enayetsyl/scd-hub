import { Schema, model, Document, Types } from "mongoose";
import {
  SUPPORT_ANTECEDENTS,
  SUPPORT_AUTHOR_VIA,
  SUPPORT_CHECK_SKIPPED,
  SUPPORT_CONTEXTS,
  SUPPORT_FUNCTIONS,
  SUPPORT_GOOD_NONE_REASONS,
  SUPPORT_HOW_OFTEN,
  SUPPORT_REPORT_SOURCES,
  SUPPORT_REPORT_STATUSES,
  SUPPORT_RESULTS,
  SUPPORT_SECTIONS,
  SUPPORT_SKILLS,
  SUPPORT_STARTER_KEYS,
  SUPPORT_TONES,
  type SupportAntecedent,
  type SupportAuthorVia,
  type SupportCheckSkipped,
  type SupportContext,
  type SupportFunction,
  type SupportGoodNoneReason,
  type SupportHowOften,
  type SupportReportSource,
  type SupportReportStatus,
  type SupportResult,
  type SupportTone,
} from "@scd/shared";

/**
 * SupportReport (§5.3) — one observation a teacher saved. Continuous intake (D-#1582): saved as
 * TO_PROCESS with no AI. The text lives only while it is needed: a rewrite REPLACES it (§2.4,
 * D-#1553), a NOT_USED report's text is deleted after 30 days, a SAFEGUARDING_ROUTED report's text
 * is moved to the referral and emptied here (§16.5 SG-3).
 */
export interface SupportTexts {
  situation: string;
  settingNote: string;
  behaviour: string;
  tried: string;
  resultNote: string;
  exception: string;
  whatWorked: string;
  goodThing: string;
}

export interface SupportGoodThing {
  textBn?: string | null;
  none?: boolean;
  reasonKey?: SupportGoodNoneReason | null;
  reasonBn?: string | null;
}

export interface SupportReturnQuestion {
  flagId: string;
  category: string;
  field: string;
  severity: "BLOCK" | "ASK" | "NOTE";
  quote: string;
  askBn: string;
  suggestionBn?: string | null;
  answer?: "REWRITTEN" | "USED_SUGGESTION" | "DISAGREE" | "DONT_REMEMBER" | null;
  answerReasonBn?: string | null;
}

export interface ISupportReport extends Document {
  _id: Types.ObjectId;
  profileId: Types.ObjectId | null;
  studentId: Types.ObjectId;
  authorId: Types.ObjectId;
  authorVia: SupportAuthorVia;
  source: SupportReportSource;
  seedCommentId: Types.ObjectId | null;
  occurredOn: string;
  groupType: "section" | "subjectgroup" | "other";
  groupId: Types.ObjectId | null;
  subject: string;
  periodNo: number | null;
  context: SupportContext | null;
  antecedentTags: SupportAntecedent[];
  situation: string;
  settingNote: string;
  behaviour: string;
  howOften: SupportHowOften | null;
  minutes: number | null;
  tried: string;
  starterKeys: string[];
  result: SupportResult | null;
  resultNote: string;
  gotOrAvoided: SupportFunction[];
  exception: string;
  whatWorked: string;
  goodThing: SupportGoodThing;
  tone: SupportTone;
  status: SupportReportStatus;
  round: number;
  batchId: Types.ObjectId | null;
  aiChecks: { runId?: Types.ObjectId; stage: "CHECK"; mode: "API" | "MANUAL"; batchId?: Types.ObjectId; producer: string; methodVersion: string; verdict: string; flagCounts: Record<string, number>; at: Date }[];
  rewriteRounds: number;
  returnQuestions: SupportReturnQuestion[];
  /** Flags left open after a batch, for the Principal (counts + quotes; the text is the report's). */
  openFlags: SupportReturnQuestion[];
  teacherDisagreements: { flagId: string; category: string; reasonBn: string }[];
  dontRememberCount: number;
  /** Deterministic ask-list hits at save time (word + field) — the batch and the Principal see them. */
  askHits: { field: string; term: string }[];
  safeguardingAsked: "NONE" | "TEACHER_SAID_NO";
  safeguardingHold: "NONE" | "OPEN" | "CLEARED";
  /** Where the hold came from: the term list at intake, or a batch (confidence). */
  safeguardingHoldSource: "TERM_LIST" | "BATCH_LOW" | "BATCH_HIGH" | null;
  checkSkipped: SupportCheckSkipped;
  compareRunId: Types.ObjectId | null;
  submittedText: SupportTexts | null;
  approvedText: SupportTexts | null;
  principalEdited: boolean;
  strategyLinks: { strategyId: Types.ObjectId; outcome: "WORKED" | "PARTLY" | "DID_NOT_WORK" }[];
  sectionHints: string[];
  skillHints: string[];
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  decisionReasonBn: string | null;
  /** First time the report left DRAFT (saving → decision timing, §7.8). */
  submittedAt: Date | null;
  /** When it last became TO_PROCESS (the oldest-waiting reminder, §6.10 B-1). */
  waitingSince: Date | null;
  returnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionSchema = new Schema<SupportReturnQuestion>(
  {
    flagId: String,
    category: String,
    field: String,
    severity: { type: String, enum: ["BLOCK", "ASK", "NOTE"] },
    quote: String,
    askBn: String,
    suggestionBn: { type: String, default: null },
    answer: { type: String, enum: ["REWRITTEN", "USED_SUGGESTION", "DISAGREE", "DONT_REMEMBER", null], default: null },
    answerReasonBn: { type: String, default: null },
  },
  { _id: false },
);

const TextsSchema = new Schema<SupportTexts>(
  { situation: String, settingNote: String, behaviour: String, tried: String, resultNote: String, exception: String, whatWorked: String, goodThing: String },
  { _id: false },
);

const SupportReportSchema = new Schema<ISupportReport>(
  {
    profileId: { type: Schema.Types.ObjectId, ref: "SupportProfile", default: null },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorVia: { type: String, enum: SUPPORT_AUTHOR_VIA, required: true },
    source: { type: String, enum: SUPPORT_REPORT_SOURCES, default: "TEACHER" },
    seedCommentId: { type: Schema.Types.ObjectId, default: null },
    occurredOn: { type: String, required: true },
    groupType: { type: String, enum: ["section", "subjectgroup", "other"], default: "section" },
    groupId: { type: Schema.Types.ObjectId, default: null },
    subject: { type: String, default: "" },
    periodNo: { type: Number, default: null },
    context: { type: String, enum: [...SUPPORT_CONTEXTS, null], default: null },
    antecedentTags: { type: [String], enum: SUPPORT_ANTECEDENTS, default: [] },
    situation: { type: String, default: "" },
    settingNote: { type: String, default: "" },
    behaviour: { type: String, default: "" },
    howOften: { type: String, enum: [...SUPPORT_HOW_OFTEN, null], default: null },
    minutes: { type: Number, default: null },
    tried: { type: String, default: "" },
    starterKeys: { type: [String], enum: SUPPORT_STARTER_KEYS as string[], default: [] },
    result: { type: String, enum: [...SUPPORT_RESULTS, null], default: null },
    resultNote: { type: String, default: "" },
    gotOrAvoided: { type: [String], enum: SUPPORT_FUNCTIONS, default: [] },
    exception: { type: String, default: "" },
    whatWorked: { type: String, default: "" },
    goodThing: {
      type: new Schema<SupportGoodThing>(
        { textBn: { type: String, default: null }, none: { type: Boolean, default: false }, reasonKey: { type: String, enum: [...SUPPORT_GOOD_NONE_REASONS, null], default: null }, reasonBn: { type: String, default: null } },
        { _id: false },
      ),
      default: () => ({}),
    },
    tone: { type: String, enum: SUPPORT_TONES, required: true },
    status: { type: String, enum: SUPPORT_REPORT_STATUSES, default: "DRAFT" },
    round: { type: Number, default: 1 },
    batchId: { type: Schema.Types.ObjectId, default: null },
    aiChecks: { type: Schema.Types.Mixed, default: () => [] },
    rewriteRounds: { type: Number, default: 0 },
    returnQuestions: { type: [QuestionSchema], default: [] },
    openFlags: { type: [QuestionSchema], default: [] },
    teacherDisagreements: { type: [new Schema({ flagId: String, category: String, reasonBn: String }, { _id: false })], default: [] },
    dontRememberCount: { type: Number, default: 0 },
    askHits: { type: [new Schema({ field: String, term: String }, { _id: false })], default: [] },
    safeguardingAsked: { type: String, enum: ["NONE", "TEACHER_SAID_NO"], default: "NONE" },
    safeguardingHold: { type: String, enum: ["NONE", "OPEN", "CLEARED"], default: "NONE" },
    safeguardingHoldSource: { type: String, enum: ["TERM_LIST", "BATCH_LOW", "BATCH_HIGH", null], default: null },
    checkSkipped: { type: String, enum: SUPPORT_CHECK_SKIPPED, default: "NONE" },
    compareRunId: { type: Schema.Types.ObjectId, default: null },
    submittedText: { type: TextsSchema, default: null },
    approvedText: { type: TextsSchema, default: null },
    principalEdited: { type: Boolean, default: false },
    strategyLinks: { type: [new Schema({ strategyId: Schema.Types.ObjectId, outcome: { type: String, enum: ["WORKED", "PARTLY", "DID_NOT_WORK"] } }, { _id: false })], default: [] },
    sectionHints: { type: [String], enum: SUPPORT_SECTIONS as unknown as string[], default: [] },
    skillHints: { type: [String], enum: SUPPORT_SKILLS as unknown as string[], default: [] },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    decisionReasonBn: { type: String, default: null },
    submittedAt: { type: Date, default: null },
    waitingSince: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

SupportReportSchema.index({ profileId: 1, status: 1, occurredOn: -1 });
SupportReportSchema.index({ authorId: 1, status: 1 });
SupportReportSchema.index({ seedCommentId: 1 }, { unique: true, partialFilterExpression: { seedCommentId: { $type: "objectId" } } });
SupportReportSchema.index({ status: 1, createdAt: 1 });

export const SupportReport = model<ISupportReport>("SupportReport", SupportReportSchema);
