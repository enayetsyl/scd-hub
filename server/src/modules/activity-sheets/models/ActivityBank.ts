import { Schema, model, Document, Types } from "mongoose";
import { ACTIVITY_BANK_STATUSES, ACTIVITY_SKILL_AREAS, type ActivityBankStatus, type ActivitySkillArea } from "@scd/shared";

/**
 * One activity bank (AS-1, D-#988/#989) — e.g. Spot the Difference, code SD. Its sheets are
 * `ActivitySheet` rows; the printable pages live in the bank's PDF(s) in Drive (never served
 * whole — pages are copied out at print time). Levels map to class levels (`levelClasses`),
 * read from the school's index CSV and editable by Office.
 */
export interface IActivityBank extends Document {
  _id: Types.ObjectId;
  /** Two capital letters — the sheet-id prefix (SD in SD-E-001). Unique. */
  code: string;
  bankNo?: number;
  nameBn: string;
  nameEn?: string;
  skillArea: ActivitySkillArea;
  /** Class levels each level suits (-1 Nursery, 0 KG, 1..5). */
  levelClasses: { E: number[]; M: number[]; H: number[] };
  /** The "Classes" text the CSV gave each level, kept for display ("Nursery – KG"). */
  levelClassText: { E?: string; M?: string; H?: string };
  /** The bank's sheet PDF (StoredFile `activity_bank_pdf`) — absent for an indexed bank with no pages yet. */
  sheetFileId?: Types.ObjectId;
  answerFileId?: Types.ObjectId;
  /** Rendered sample pages per level (StoredFile `activity_page`) — what a guardian previews. */
  sampleFileIds: { E: Types.ObjectId[]; M: Types.ObjectId[]; H: Types.ObjectId[] };
  /** Next sheet (index into the level's sheets, sorted) the tray restock prints. */
  rotation: { E: number; M: number; H: number };
  sortOrder: number;
  status: ActivityBankStatus;
  createdAt: Date;
  updatedAt: Date;
}

const LevelNums = new Schema({ E: { type: [Number], default: [] }, M: { type: [Number], default: [] }, H: { type: [Number], default: [] } }, { _id: false });

const ActivityBankSchema = new Schema<IActivityBank>(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    bankNo: { type: Number },
    nameBn: { type: String, required: true, trim: true },
    nameEn: { type: String, trim: true },
    skillArea: { type: String, enum: ACTIVITY_SKILL_AREAS, required: true },
    levelClasses: { type: LevelNums, default: () => ({ E: [], M: [], H: [] }) },
    levelClassText: { E: { type: String }, M: { type: String }, H: { type: String } },
    sheetFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    answerFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    sampleFileIds: {
      E: { type: [Schema.Types.ObjectId], default: [] },
      M: { type: [Schema.Types.ObjectId], default: [] },
      H: { type: [Schema.Types.ObjectId], default: [] },
    },
    rotation: { E: { type: Number, default: 0 }, M: { type: Number, default: 0 }, H: { type: Number, default: 0 } },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: ACTIVITY_BANK_STATUSES, required: true, default: "DRAFT" },
  },
  { timestamps: true },
);

ActivityBankSchema.index({ code: 1 }, { unique: true });

export const ActivityBank = model<IActivityBank>("ActivityBank", ActivityBankSchema);
