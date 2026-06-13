import { Schema, model, Document, Types } from "mongoose";
import { MESSAGE_TEMPLATE_KEYS, TEMPLATE_LANGUAGE_MODES, type MessageTemplateKey, type TemplateLanguageMode } from "@scd/shared";

/**
 * MessageTemplate (MT-1; prd-message-templates §3.3, D-#128/#130) — the admin
 * OVERRIDE row. It exists ONLY when the Principal has edited a key (the "sticky
 * note"); absent ⇒ the code default in `MESSAGE_TEMPLATE_REGISTRY` is used
 * (`isDefault: true`). No startup/seed write ever runs (D-#97/#103) — a row is
 * born only from `editMessageTemplate`, and `resetMessageTemplate` deletes it.
 *
 * `key` is globally unique (single-school live-repo convention — VC/HR/library/
 * chat models carry no `schoolId`; AGENTS rule 3, live repo wins over the §3.3
 * "unique per school" sketch — recorded as D-#140).
 *
 * Identity/operational plane, behind the ADR-005 firewall (a template body is
 * shared operational content, but the module stays corpus-isolated). The prior
 * body is retained in the append-only audit (MESSAGE_TEMPLATE_EDITED), never here.
 */
export interface IMessageTemplate extends Document {
  _id: Types.ObjectId;
  key: MessageTemplateKey;
  /** Admin Bangla body (overrides the code default's bnDefault). */
  bnBody?: string;
  /** Admin English body (required before langMode can be EN/BOTH — D-#130). */
  enBody?: string;
  langMode: TemplateLanguageMode;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MessageTemplateSchema = new Schema<IMessageTemplate>(
  {
    key: { type: String, enum: MESSAGE_TEMPLATE_KEYS as unknown as string[], required: true, unique: true },
    bnBody: { type: String },
    enBody: { type: String },
    langMode: { type: String, enum: TEMPLATE_LANGUAGE_MODES as unknown as string[], required: true, default: "BN" },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  {
    timestamps: true,
    // The override read is BEST-EFFORT (D-#75): with no live connection a read
    // throws IMMEDIATELY (never buffers/hangs) so the renderer falls back to the
    // code default — production stays connected, and DB-free unit tests resolve
    // the byte-identical default without a 15s buffering timeout.
    bufferCommands: false,
  },
);

export const MessageTemplate = model<IMessageTemplate>("MessageTemplate", MessageTemplateSchema);
