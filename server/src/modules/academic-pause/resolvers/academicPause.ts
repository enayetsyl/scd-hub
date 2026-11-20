/**
 * Academic pause windows (D-#1655). Office/Principal manage (`routine:edit_calendar`, the
 * same gate as holidays); every signed-in user can read, because what a window switches
 * off (a nudge, a card) affects teachers and guardians alike.
 */
import { builder } from "../../../schema";
import type { IAcademicPause } from "../models/AcademicPause";
import {
  PAUSE_KINDS,
  createPause,
  deletePause,
  listPauses,
  pausesInRange,
  updatePause,
} from "../services/AcademicPauseService";

const PauseRef = builder.objectRef<IAcademicPause>("AcademicPause").implement({
  fields: (t) => ({
    id: t.string({ resolve: (p) => p._id.toString() }),
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    label: t.exposeString("label"),
    pauses: t.stringList({ resolve: (p) => p.pauses }),
  }),
});

builder.queryField("academicPauses", (t) =>
  t.field({
    type: [PauseRef],
    description: "Every active pause window, soonest first.",
    authScopes: { authenticated: true },
    resolve: async () => listPauses(),
  }),
);

builder.queryField("academicPausesInRange", (t) =>
  t.field({
    type: [PauseRef],
    description: "Active pause windows overlapping [fromKey, toKey] (YYYY-MM-DD, Asia/Dhaka days).",
    authScopes: { authenticated: true },
    args: { fromKey: t.arg.string({ required: true }), toKey: t.arg.string({ required: true }) },
    resolve: async (_r, a) => pausesInRange(a.fromKey, a.toKey),
  }),
);

builder.queryField("academicPauseKinds", (t) =>
  t.field({
    type: ["String"],
    authScopes: { authenticated: true },
    resolve: () => [...PAUSE_KINDS],
  }),
);

builder.mutationField("createAcademicPause", (t) =>
  t.field({
    type: PauseRef,
    authScopes: { hasPermission: "routine:edit_calendar" },
    args: {
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
      label: t.arg.string({ required: true }),
      pauses: t.arg.stringList({ required: true }),
    },
    resolve: async (_r, a, ctx) =>
      createPause({ fromKey: a.fromKey, toKey: a.toKey, label: a.label, pauses: a.pauses }, ctx.auth?.userId),
  }),
);

builder.mutationField("updateAcademicPause", (t) =>
  t.field({
    type: PauseRef,
    authScopes: { hasPermission: "routine:edit_calendar" },
    args: {
      id: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
      label: t.arg.string({ required: true }),
      pauses: t.arg.stringList({ required: true }),
    },
    resolve: async (_r, a) =>
      updatePause(a.id, { fromKey: a.fromKey, toKey: a.toKey, label: a.label, pauses: a.pauses }),
  }),
);

builder.mutationField("deleteAcademicPause", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "routine:edit_calendar" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a) => deletePause(a.id),
  }),
);
