import SchemaBuilder from "@pothos/core";
import ScopeAuthPlugin from "@pothos/plugin-scope-auth";
import SimpleObjectsPlugin from "@pothos/plugin-simple-objects";
import type { AppContext } from "./context";
import type { Permission } from "@scd/shared";
import { callerHasPermission } from "@scd/shared";

export const builder = new SchemaBuilder<{
  Context: AppContext;
  AuthScopes: {
    authenticated: boolean;
    hasPermission: Permission;
    hasAnyPermission: Permission[];
  };
}>({
  plugins: [ScopeAuthPlugin, SimpleObjectsPlugin],
  scopeAuth: {
    authScopes: async (ctx) => ({
      authenticated: ctx.auth !== null,
      // THE single per-caller authority (AC-1, D-#193). Every `authScopes: { hasPermission }`
      // gate flows through here. `ctx.auth` (AuthPayload) satisfies AccessProfile, so per-user
      // grants/revokes + additional templates are applied; empty arrays ⇒ identical-to-today.
      hasPermission: (perm: Permission) =>
        ctx.auth !== null && callerHasPermission(ctx.auth, perm),
      // OR over the SAME scope, which `hasPermission` cannot express and Pothos's
      // `$any` cannot either (it combines DIFFERENT scopes, one entry per name).
      // Written as its own scope rather than as an `if` inside a resolver so the gate
      // stays declarative and the static resolver-gate guard can still read it — a
      // permission check hidden in a resolver body is one the guard cannot see.
      hasAnyPermission: (perms: Permission[]) =>
        ctx.auth !== null && perms.some((p) => callerHasPermission(ctx.auth!, p)),
    }),
  },
});

builder.queryType({
  description: "Root query",
});

builder.mutationType({
  description: "Root mutation",
});
