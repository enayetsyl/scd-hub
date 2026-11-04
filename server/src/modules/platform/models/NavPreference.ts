/**
 * NavPreference (D-#920) — one person's own sidebar arrangement.
 *
 * Owner ask 2026-11-04: each person organises their own sidebar — the items they use
 * most go up, the rest go down — by hand, or (their choice) automatically by use.
 * One row per account: `ownerKind` + `ownerId` (a staff User or a portal Guardian —
 * the two id spaces are separate collections, so the kind is part of the key).
 *
 * Keys are the drawer's own: a section is `g:<titleKey>` (a group) or
 * `<route>:<screen>` (a top-level item); a leaf is `<route>:<screen>`. They are UI
 * addresses, not permissions — the drawer still shows only what the person can open,
 * so a saved key for an item they lost simply never renders.
 */
import { Schema, model, Document, Types } from "mongoose";

export const NAV_MODES = ["manual", "auto"] as const;
export type NavMode = (typeof NAV_MODES)[number];

export interface INavPreference extends Document {
  _id: Types.ObjectId;
  ownerKind: "USER" | "GUARDIAN";
  ownerId: Types.ObjectId;
  mode: NavMode;
  /** Top-level section keys in the person's order (manual mode). */
  order: string[];
  /** Favourite leaf keys, in the order shown under আমার পছন্দ. */
  pinned: string[];
  /** Taps per leaf key — what auto mode sorts by. */
  usage: Map<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

const NavPreferenceSchema = new Schema<INavPreference>(
  {
    ownerKind: { type: String, enum: ["USER", "GUARDIAN"], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    mode: { type: String, enum: NAV_MODES, default: "manual" },
    order: { type: [String], default: [] },
    pinned: { type: [String], default: [] },
    usage: { type: Map, of: Number, default: {} },
  },
  { timestamps: true },
);

NavPreferenceSchema.index({ ownerKind: 1, ownerId: 1 }, { unique: true });

export const NavPreference = model<INavPreference>("NavPreference", NavPreferenceSchema);
