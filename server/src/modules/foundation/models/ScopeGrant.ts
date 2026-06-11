import { Schema, model, Document, Types } from "mongoose";

/** Three grant kinds per ADR-017 / D-#17/#18/#20. */
export type GrantKind = "teaching" | "supervisory" | "proxy";

/** Supervisory extent options (D-#17). */
export type SupervisoryExtent =
  | "whole_school"
  | "grade_class"    // all subjects, specific class level
  | "subject_dept"   // all classes, specific subject
  | "explicit_set";  // an explicitly assigned set of (class,subject) pairs

/** Proxy/cover grant lifecycle status. */
export type ProxyStatus = "active" | "revoked" | "expired";

/** What created the grant (D-#49). "routine" grants are auto-synced by the routine
 *  slot binding (created/revoked with the slot); "manual" grants (the default, incl.
 *  absent) are admin-added and the routine sync never touches them. */
export type GrantSource = "manual" | "routine";

/** Base fields all grants share. */
interface BaseGrant {
  teacherId: Types.ObjectId;
  kind: GrantKind;
  active: boolean;
  /** Provenance for idempotent routine sync (D-#49); absent = manual. */
  source?: GrantSource;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** Teaching grant — own class→section assignment. */
interface TeachingGrant extends BaseGrant {
  kind: "teaching";
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  subjectId: Types.ObjectId;
}

/** Supervisory grant — read-only oversight extent (D-#17). */
interface SupervisoryGrant extends BaseGrant {
  kind: "supervisory";
  extent: SupervisoryExtent;
  /** Relevant when extent = grade_class */
  classId?: Types.ObjectId;
  /** Relevant when extent = subject_dept */
  subjectId?: Types.ObjectId;
  /** Relevant when extent = explicit_set */
  explicitSet?: Array<{ classId: Types.ObjectId; subjectId: Types.ObjectId }>;
}

/** Proxy/cover grant — duration-bounded write overlay (D-#18/#20). */
interface ProxyGrant extends BaseGrant {
  kind: "proxy";
  coveringTeacherId: Types.ObjectId;
  absentTeacherId?: Types.ObjectId;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  /** Asia/Dhaka day-start. */
  startDate: Date;
  /** Window = [startDate, startDate + durationDays). Enforced at request time — no cron. */
  durationDays: number;
  proxyStatus: ProxyStatus;
}

export type IScopeGrant = (TeachingGrant | SupervisoryGrant | ProxyGrant) & Document & { _id: Types.ObjectId };

const ScopeGrantSchema = new Schema<IScopeGrant>(
  {
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["teaching", "supervisory", "proxy"], required: true },
    active: { type: Boolean, default: true },
    source: { type: String, enum: ["manual", "routine"], default: "manual" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // teaching + proxy
    classId: { type: Schema.Types.ObjectId, ref: "Class" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject" },

    // supervisory
    extent: {
      type: String,
      enum: ["whole_school", "grade_class", "subject_dept", "explicit_set"],
    },
    explicitSet: [
      {
        classId: { type: Schema.Types.ObjectId, ref: "Class" },
        subjectId: { type: Schema.Types.ObjectId, ref: "Subject" },
      },
    ],

    // proxy
    coveringTeacherId: { type: Schema.Types.ObjectId, ref: "User" },
    absentTeacherId: { type: Schema.Types.ObjectId, ref: "User" },
    startDate: { type: Date },
    durationDays: { type: Number, min: 1 },
    proxyStatus: { type: String, enum: ["active", "revoked", "expired"] },
  },
  { timestamps: true },
);

ScopeGrantSchema.index({ teacherId: 1, kind: 1, active: 1 });
ScopeGrantSchema.index({ coveringTeacherId: 1, proxyStatus: 1 });

export const ScopeGrant = model<IScopeGrant>("ScopeGrant", ScopeGrantSchema);
