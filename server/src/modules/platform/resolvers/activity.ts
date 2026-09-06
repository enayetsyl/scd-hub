/**
 * Person-activity resolvers (AL-1, D-#645) — "what did this person do, and when".
 * READ-ONLY by construction, like the audit viewer it extends: no mutation is
 * exposed here, ever. Gated on `audit:read` (Principal only, verifier-proven) —
 * a timeline of one named person is a stronger read than any single screen it
 * draws from, so it takes the strongest gate the app has rather than a new one.
 */
import { builder } from "../../../schema";
import {
  activityPeople,
  activityPerson,
  activityRowDetail,
  personActivity,
  personActivityDays,
  ACTIVITY_SOURCES,
  type ActivityPersonShape,
  type ActivityRowShape,
  type ActivityDayShape,
  type ActivityRowDetailShape,
  type ActivityStudentShape,
  type PersonActivityResult,
} from "../services/ActivityService";
import { ACTIVITY_GROUPS, ACTIVITY_GROUP_LABELS, type ActivityGroup } from "../auditLabels";

const ActivityPersonRef = builder.objectRef<ActivityPersonShape>("ActivityPerson");
ActivityPersonRef.implement({
  description: "A person who can have a timeline: a staff User or a Guardian.",
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    role: t.exposeString("role"),
    kind: t.exposeString("kind"),
    active: t.exposeBoolean("active"),
  }),
});

const ActivityRowRef = builder.objectRef<ActivityRowShape>("ActivityRow");
ActivityRowRef.implement({
  description:
    "One thing a person did. `source` AUDIT is a single append-only audit event; " +
    "HOMEWORK/ASSIGNMENT is a tracker pass folded to (item × state × day), where " +
    "`count` is the number of student records touched.",
  fields: (t) => ({
    id: t.exposeString("id"),
    source: t.exposeString("source"),
    at: t.exposeString("at"),
    firstAt: t.string({ nullable: true, resolve: (r) => r.firstAt }),
    day: t.exposeString("day"),
    kind: t.exposeString("kind"),
    labelBn: t.exposeString("labelBn"),
    labelEn: t.exposeString("labelEn"),
    group: t.string({ resolve: (r) => r.group }),
    count: t.exposeInt("count"),
    targetKind: t.string({ nullable: true, resolve: (r) => r.targetKind }),
    targetId: t.string({ nullable: true, resolve: (r) => r.targetId }),
    targetLabel: t.string({ nullable: true, resolve: (r) => r.targetLabel }),
    // AL-2: where the work was, so the reader need not decode HW-C3-ENG-0020.
    subject: t.string({ nullable: true, resolve: (r) => r.subject }),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    sectionName: t.string({ nullable: true, resolve: (r) => r.sectionName }),
    itemDate: t.string({ nullable: true, resolve: (r) => r.itemDate }),
    metaJson: t.string({ nullable: true, resolve: (r) => r.metaJson }),
    viaViewAs: t.exposeBoolean("viaViewAs"),
  }),
});

const ActivityStudentRef = builder.objectRef<ActivityStudentShape>("ActivityStudent");
ActivityStudentRef.implement({
  description: "One student inside a folded tracker pass, with the exact stamp for them.",
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    rollNumber: t.string({ nullable: true, resolve: (r) => r.rollNumber }),
    at: t.exposeString("at"),
  }),
});

const ActivityRowDetailRef = builder.objectRef<ActivityRowDetailShape>("ActivityRowDetail");
ActivityRowDetailRef.implement({
  description:
    "What one timeline row is made of (AL-2). For a tracker pass: the item and the " +
    "students it touched, each with their own stamp. For an audit event: the target " +
    "resolved to a name where its kind is resolvable, plus the stored detail.",
  fields: (t) => ({
    rowId: t.exposeString("rowId"),
    source: t.string({ resolve: (r) => r.source }),
    itemCode: t.string({ nullable: true, resolve: (r) => r.itemCode }),
    subject: t.string({ nullable: true, resolve: (r) => r.subject }),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    sectionName: t.string({ nullable: true, resolve: (r) => r.sectionName }),
    itemDate: t.string({ nullable: true, resolve: (r) => r.itemDate }),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
    description: t.string({ nullable: true, resolve: (r) => r.description }),
    targetLabel: t.string({ nullable: true, resolve: (r) => r.targetLabel }),
    targetKind: t.string({ nullable: true, resolve: (r) => r.targetKind }),
    metaJson: t.string({ nullable: true, resolve: (r) => r.metaJson }),
    students: t.field({ type: [ActivityStudentRef], resolve: (r) => r.students }),
    studentsTruncated: t.exposeBoolean("studentsTruncated"),
  }),
});

const ActivityDayRef = builder.objectRef<ActivityDayShape>("ActivityDay");
ActivityDayRef.implement({
  description: "Per-day totals for a person across the window, newest day first.",
  fields: (t) => ({
    day: t.exposeString("day"),
    audit: t.exposeInt("audit"),
    homework: t.exposeInt("homework"),
    assignment: t.exposeInt("assignment"),
    total: t.exposeInt("total"),
  }),
});

const ActivityFeedRef = builder.objectRef<PersonActivityResult>("ActivityFeed");
ActivityFeedRef.implement({
  description:
    "A window of one person's activity. `truncated` is true when a source hit its " +
    "cap — the window is hiding rows and the reader should narrow the range.",
  fields: (t) => ({
    rows: t.field({ type: [ActivityRowRef], resolve: (r) => r.rows }),
    truncated: t.exposeBoolean("truncated"),
  }),
});

interface ActivityGroupOption {
  value: ActivityGroup;
  labelBn: string;
  labelEn: string;
}
const ActivityGroupRef = builder.objectRef<ActivityGroupOption>("ActivityGroupOption");
ActivityGroupRef.implement({
  description: "An event family — the filter axis, since 219 kinds is not a picker.",
  fields: (t) => ({
    value: t.string({ resolve: (r) => r.value }),
    labelBn: t.exposeString("labelBn"),
    labelEn: t.exposeString("labelEn"),
  }),
});

builder.queryField("activityPeople", (t) =>
  t.field({
    type: [ActivityPersonRef],
    description: "Staff and guardians matching `search`, for the person picker. Requires audit:read.",
    authScopes: { hasPermission: "audit:read" },
    args: {
      search: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args) => activityPeople({ search: args.search, limit: args.limit }),
  }),
);

builder.queryField("activityPerson", (t) =>
  t.field({
    type: ActivityPersonRef,
    nullable: true,
    description: "One person's display identity (name/role), or null. Requires audit:read.",
    authScopes: { hasPermission: "audit:read" },
    args: { personId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => activityPerson(args.personId),
  }),
);

builder.queryField("personActivity", (t) =>
  t.field({
    type: ActivityFeedRef,
    description:
      "Everything one person did between two Dhaka calendar days (inclusive), newest " +
      "first: audit events plus folded homework/assignment tracker passes. Requires audit:read.",
    authScopes: { hasPermission: "audit:read" },
    args: {
      personId: t.arg.string({ required: true }),
      from: t.arg.string({ required: true }),
      to: t.arg.string({ required: true }),
      group: t.arg.string({ required: false }),
      kind: t.arg.string({ required: false }),
      source: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args) =>
      personActivity({
        personId: args.personId,
        from: args.from,
        to: args.to,
        group: args.group,
        kind: args.kind,
        source: args.source,
        limit: args.limit,
      }),
  }),
);

builder.queryField("personActivityDays", (t) =>
  t.field({
    type: [ActivityDayRef],
    description:
      "Per-day activity counts for a person over the window — the map used to pick a " +
      "day before narrowing the range. Requires audit:read.",
    authScopes: { hasPermission: "audit:read" },
    args: {
      personId: t.arg.string({ required: true }),
      from: t.arg.string({ required: true }),
      to: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) =>
      personActivityDays({ personId: args.personId, from: args.from, to: args.to }),
  }),
);

builder.queryField("activityRowDetail", (t) =>
  t.field({
    type: ActivityRowDetailRef,
    nullable: true,
    description:
      "The detail behind one timeline row — `rowId` is the id that row already carries. " +
      "Null when the row is not on this person's timeline. Requires audit:read.",
    authScopes: { hasPermission: "audit:read" },
    args: {
      personId: t.arg.string({ required: true }),
      rowId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) =>
      activityRowDetail({ personId: args.personId, rowId: args.rowId }),
  }),
);

builder.queryField("activityGroups", (t) =>
  t.field({
    type: [ActivityGroupRef],
    description: "The event families, for the filter picker. Requires audit:read.",
    authScopes: { hasPermission: "audit:read" },
    resolve: () =>
      ACTIVITY_GROUPS.map((g) => ({
        value: g,
        labelBn: ACTIVITY_GROUP_LABELS[g].bn,
        labelEn: ACTIVITY_GROUP_LABELS[g].en,
      })),
  }),
);

builder.queryField("activitySources", (t) =>
  t.field({
    type: ["String"],
    description: "The activity sources a row can come from. Requires audit:read.",
    authScopes: { hasPermission: "audit:read" },
    resolve: () => [...ACTIVITY_SOURCES],
  }),
);
