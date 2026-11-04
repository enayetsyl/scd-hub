/**
 * Own sidebar arrangement (D-#920) — read, save, reset, and the tap counter for auto
 * mode. SELF for staff and guardians alike; see NavPreferenceService.
 */
import { builder } from "../../../schema";
import {
  getNavPreference,
  recordNavUse,
  resetNavPreference,
  saveNavPreference,
  type NavPreferenceView,
} from "../services/NavPreferenceService";

const NavUsageRef = builder.objectRef<{ key: string; count: number }>("NavUsage").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    count: t.exposeInt("count"),
  }),
});

const NavPreferenceRef = builder.objectRef<NavPreferenceView>("NavPreference").implement({
  description: "The caller's own sidebar arrangement (D-#920).",
  fields: (t) => ({
    mode: t.exposeString("mode", { description: "manual | auto (most-used first)" }),
    order: t.exposeStringList("order", { description: "Top-level section keys, in order (manual mode)." }),
    pinned: t.exposeStringList("pinned", { description: "Favourite leaf keys, in order." }),
    usage: t.field({ type: [NavUsageRef], resolve: (r) => r.usage }),
  }),
});

builder.queryField("myNavPreference", (t) =>
  t.field({
    type: NavPreferenceRef,
    description: "The caller's own sidebar arrangement (D-#920); defaults when never saved.",
    authScopes: { authenticated: true },
    resolve: (_root, _args, ctx) => getNavPreference(ctx),
  }),
);

builder.mutationField("saveNavPreference", (t) =>
  t.field({
    type: NavPreferenceRef,
    description: "Save the caller's own sidebar mode, section order and favourites (D-#920).",
    authScopes: { authenticated: true },
    args: {
      mode: t.arg.string({ required: true }),
      order: t.arg.stringList({ required: true }),
      pinned: t.arg.stringList({ required: true }),
    },
    resolve: (_root, args, ctx) => saveNavPreference(ctx, args),
  }),
);

builder.mutationField("resetNavPreference", (t) =>
  t.field({
    type: NavPreferenceRef,
    description: "Back to the default sidebar: forgets the order, favourites and use counts (D-#920).",
    authScopes: { authenticated: true },
    resolve: (_root, _args, ctx) => resetNavPreference(ctx),
  }),
);

builder.mutationField("recordNavUse", (t) =>
  t.boolean({
    description: "Count one tap on a sidebar item, for auto mode (D-#920).",
    authScopes: { authenticated: true },
    args: { key: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) => recordNavUse(ctx, args.key),
  }),
);
