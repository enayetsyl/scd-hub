/**
 * AI key & model (D-#967) — the Principal sets the Gemini key + model in the app instead
 * of the VM's .env. `system_health:ai_key` (LOCKED). The key is write-only: reads return
 * its last 4 characters and where it comes from, never the key.
 */
import { builder } from "../../../schema";
import { aiSettingsView, clearAiKey, setAiSettings, type AiSettingsView } from "../services/AiSettingService";

const AiSettingsRef = builder.objectRef<AiSettingsView>("AiSettings").implement({
  fields: (t) => ({
    source: t.string({ description: "SETTING (saved here) | ENV (server .env) | NONE", resolve: (v) => v.source }),
    keyLast4: t.string({ nullable: true, resolve: (v) => v.keyLast4 }),
    model: t.string({ description: "The model in use (saved → GEMINI_MODEL → the alias).", resolve: (v) => v.model }),
    modelSaved: t.string({ nullable: true, resolve: (v) => v.modelSaved }),
    updatedAt: t.string({ nullable: true, resolve: (v) => (v.updatedAt ? new Date(v.updatedAt).toISOString() : null) }),
    updatedByName: t.string({ nullable: true, resolve: (v) => v.updatedByName }),
  }),
});

builder.queryField("aiSettings", (t) =>
  t.field({
    type: AiSettingsRef,
    description: "Where the Gemini key comes from, its last 4 characters, and the model. system_health:ai_key.",
    authScopes: { hasPermission: "system_health:ai_key" },
    resolve: (_root, _args, ctx) => aiSettingsView(ctx.auth),
  }),
);

builder.mutationField("setAiSettings", (t) =>
  t.field({
    type: AiSettingsRef,
    description: "Save a new Gemini key and/or model (empty model = the default alias). Tested with Google first; audited without the key.",
    authScopes: { hasPermission: "system_health:ai_key" },
    args: { apiKey: t.arg.string({ required: false }), model: t.arg.string({ required: false }) },
    resolve: (_root, args, ctx) => setAiSettings(ctx.auth, { apiKey: args.apiKey, model: args.model }),
  }),
);

builder.mutationField("clearAiKey", (t) =>
  t.field({
    type: AiSettingsRef,
    description: "Forget the key saved in the app — the server's .env key is used again. Audited.",
    authScopes: { hasPermission: "system_health:ai_key" },
    resolve: (_root, _args, ctx) => clearAiKey(ctx.auth),
  }),
);
