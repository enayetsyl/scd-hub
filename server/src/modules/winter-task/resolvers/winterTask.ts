/**
 * Winter-task booklet review resolvers (D-#1620). Import is a server script; everything a
 * person does on screen is here.
 *
 *   winterBooklets / winterBooklet / winterChanges  — winter_task:review | manage (a reviewer
 *       sees only her own suggestions; the Principal sees all).
 *   suggestWinterChange / editWinterChange / deleteWinterChange — review | manage; the service
 *       lets a person touch only her own OPEN suggestions.
 *   decideWinterChange / setWinterBookletStatus / exportWinterBooklet — winter_task:manage.
 */
import type { Permission } from "@scd/shared";
import { builder } from "../../../schema";
import {
  decideWinterChange,
  deleteWinterChange,
  editWinterChange,
  exportAcceptedWinterBooklet,
  getWinterBooklet,
  listWinterBooklets,
  setWinterBookletStatus,
  suggestWinterChange,
  winterChanges,
  type WinterBookletDetail,
  type WinterBookletRow,
  type WinterChangeRow,
} from "../services/WinterBookletService";

const BookletRowRef = builder.objectRef<WinterBookletRow>("WinterBookletRow");
BookletRowRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    code: t.exposeString("code"),
    classLevel: t.exposeInt("classLevel"),
    classLabelBn: t.exposeString("classLabelBn"),
    titleBn: t.exposeString("titleBn"),
    version: t.exposeInt("version"),
    // DRAFT | IN_REVIEW | APPROVED
    status: t.exposeString("status"),
    pageCount: t.exposeInt("pageCount"),
    openChanges: t.exposeInt("openChanges"),
    acceptedChanges: t.exposeInt("acceptedChanges"),
  }),
});

const BookletDetailRef = builder.objectRef<WinterBookletDetail>("WinterBookletDetail");
BookletDetailRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    code: t.exposeString("code"),
    classLevel: t.exposeInt("classLevel"),
    classLabelBn: t.exposeString("classLabelBn"),
    titleBn: t.exposeString("titleBn"),
    version: t.exposeInt("version"),
    status: t.exposeString("status"),
    pagesJson: t.exposeString("pagesJson"),
  }),
});

const ChangeRef = builder.objectRef<WinterChangeRow>("WinterChange");
ChangeRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    bookletId: t.exposeString("bookletId"),
    pageN: t.exposeInt("pageN"),
    blockId: t.string({ nullable: true, resolve: (r) => r.blockId }),
    before: t.exposeString("before"),
    after: t.exposeString("after"),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
    byName: t.exposeString("byName"),
    mine: t.exposeBoolean("mine"),
    // OPEN | ACCEPTED | REJECTED
    status: t.exposeString("status"),
    stale: t.exposeBoolean("stale"),
    createdAt: t.exposeString("createdAt"),
    editedAt: t.string({ nullable: true, resolve: (r) => r.editedAt }),
  }),
});

const ANY = { hasAnyPermission: ["winter_task:review", "winter_task:manage"] as Permission[] };
const MANAGE = { hasPermission: "winter_task:manage" as Permission };

builder.queryField("winterBooklets", (t) =>
  t.field({ type: [BookletRowRef], authScopes: ANY, resolve: (_r, _a, ctx) => listWinterBooklets(ctx) }),
);

builder.queryField("winterBooklet", (t) =>
  t.field({
    type: BookletDetailRef,
    authScopes: ANY,
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => getWinterBooklet(ctx, a.id),
  }),
);

builder.queryField("winterChanges", (t) =>
  t.field({
    type: [ChangeRef],
    authScopes: ANY,
    args: { bookletId: t.arg.string({ required: true }), pageN: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => winterChanges(ctx, a.bookletId, a.pageN ?? null),
  }),
);

builder.mutationField("suggestWinterChange", (t) =>
  t.field({
    type: ChangeRef,
    authScopes: ANY,
    args: {
      bookletId: t.arg.string({ required: true }),
      pageN: t.arg.int({ required: true }),
      blockId: t.arg.string({ required: false }),
      after: t.arg.string({ required: false }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_r, a, ctx) =>
      suggestWinterChange(ctx, { bookletId: a.bookletId, pageN: a.pageN, blockId: a.blockId, after: a.after, note: a.note }),
  }),
);

builder.mutationField("editWinterChange", (t) =>
  t.field({
    type: ChangeRef,
    authScopes: ANY,
    args: { id: t.arg.string({ required: true }), after: t.arg.string({ required: false }), note: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => editWinterChange(ctx, a.id, { after: a.after, note: a.note }),
  }),
);

builder.mutationField("deleteWinterChange", (t) =>
  t.field({
    type: "Boolean",
    authScopes: ANY,
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => deleteWinterChange(ctx, a.id),
  }),
);

builder.mutationField("decideWinterChange", (t) =>
  t.field({
    type: ChangeRef,
    authScopes: MANAGE,
    args: { id: t.arg.string({ required: true }), accept: t.arg.boolean({ required: true }) },
    resolve: (_r, a, ctx) => decideWinterChange(ctx, a.id, a.accept),
  }),
);

builder.mutationField("setWinterBookletStatus", (t) =>
  t.field({
    type: BookletRowRef,
    authScopes: MANAGE,
    args: { id: t.arg.string({ required: true }), status: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => setWinterBookletStatus(ctx, a.id, a.status),
  }),
);

builder.queryField("exportWinterBooklet", (t) =>
  t.field({
    type: "String",
    authScopes: MANAGE,
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => exportAcceptedWinterBooklet(ctx, a.id),
  }),
);
