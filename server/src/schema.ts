import SchemaBuilder from "@pothos/core";
import ScopeAuthPlugin from "@pothos/plugin-scope-auth";
import SimpleObjectsPlugin from "@pothos/plugin-simple-objects";
import type { AppContext } from "./context";
import type { Role, Permission } from "@scd/shared";
import { roleHasPermission } from "@scd/shared";

export const builder = new SchemaBuilder<{
  Context: AppContext;
  AuthScopes: {
    authenticated: boolean;
    hasPermission: Permission;
  };
}>({
  plugins: [ScopeAuthPlugin, SimpleObjectsPlugin],
  scopeAuth: {
    authScopes: async (ctx) => ({
      authenticated: ctx.auth !== null,
      hasPermission: (perm: Permission) =>
        ctx.auth !== null && roleHasPermission(ctx.auth.role as Role, perm),
    }),
  },
});

builder.queryType({
  description: "Root query",
});

builder.mutationType({
  description: "Root mutation",
});
