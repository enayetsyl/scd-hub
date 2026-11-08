/**
 * AI keys, models and feature settings (D-#967, D-#1090) — the Principal sets each AI
 * provider's key + model in the app instead of the VM's .env, and chooses which provider
 * answers each AI feature. `system_health:ai_key` (LOCKED). Keys are write-only: reads
 * return the last 4 characters and where the key comes from, never the key.
 *
 * `provider` is optional everywhere and means Gemini when absent, so the D-#967 screen on
 * phones still running the previous bundle keeps working unchanged.
 */
import { builder } from "../../../schema";
import {
  aiBudgetView,
  aiFeatureSettings,
  aiSettingsView,
  clearAiKey,
  setAiBudget,
  setAiFeatureSetting,
  setAiSettings,
  type AiBudgetView,
  type AiFeatureView,
  type AiSettingsView,
} from "../services/AiSettingService";

const AiSettingsRef = builder.objectRef<AiSettingsView>("AiSettings").implement({
  fields: (t) => ({
    provider: t.string({ description: "gemini | deepseek", resolve: (v) => v.provider }),
    source: t.string({ description: "SETTING (saved here) | ENV (server .env) | NONE", resolve: (v) => v.source }),
    keyLast4: t.string({ nullable: true, resolve: (v) => v.keyLast4 }),
    model: t.string({ description: "The model in use (saved → .env → the default).", resolve: (v) => v.model }),
    modelSaved: t.string({ nullable: true, resolve: (v) => v.modelSaved }),
    defaultModel: t.string({ description: "The model used when none is saved.", resolve: (v) => v.defaultModel }),
    updatedAt: t.string({ nullable: true, resolve: (v) => (v.updatedAt ? new Date(v.updatedAt).toISOString() : null) }),
    updatedByName: t.string({ nullable: true, resolve: (v) => v.updatedByName }),
  }),
});

const AiFeatureRef = builder.objectRef<AiFeatureView>("AiFeatureSetting").implement({
  fields: (t) => ({
    feature: t.string({ resolve: (v) => v.feature }),
    labelBn: t.string({ resolve: (v) => v.labelBn }),
    labelEn: t.string({ resolve: (v) => v.labelEn }),
    enabled: t.boolean({ description: "Switched on (default OFF, D-#1101).", resolve: (v) => v.enabled }),
    provider: t.string({ description: "deepseek | gemini", resolve: (v) => v.provider }),
    modelSaved: t.string({ nullable: true, resolve: (v) => v.modelSaved }),
    model: t.string({ description: "The model that will answer.", resolve: (v) => v.model }),
    fallback: t.boolean({ description: "May try the other provider once.", resolve: (v) => v.fallback }),
    providerReady: t.boolean({ description: "The chosen provider has a key.", resolve: (v) => v.providerReady }),
    dailyPerUser: t.int({ description: "Calls one person may make per Dhaka day (AI-2).", resolve: (v) => v.dailyPerUser }),
    monthlyUsd: t.float({ description: "USD this feature may spend per Dhaka month (AI-2).", resolve: (v) => v.monthlyUsd }),
    perSessionTurns: t.int({ nullable: true, description: "Turns per assistant session; null = none.", resolve: (v) => v.perSessionTurns }),
    updatedAt: t.string({ nullable: true, resolve: (v) => (v.updatedAt ? new Date(v.updatedAt).toISOString() : null) }),
  }),
});

const AiBudgetRef = builder.objectRef<AiBudgetView>("AiBudget").implement({
  fields: (t) => ({
    monthlyUsd: t.float({ description: "USD per Dhaka month across the capped AI features.", resolve: (v) => v.monthlyUsd }),
    alertPct: t.int({ description: "Alert the Principal when a monthly cap reaches this percent.", resolve: (v) => v.alertPct }),
    updatedAt: t.string({ nullable: true, resolve: (v) => (v.updatedAt ? new Date(v.updatedAt).toISOString() : null) }),
  }),
});

builder.queryField("aiBudget", (t) =>
  t.field({
    type: AiBudgetRef,
    description: "The school-wide AI budget and alert percent (AI-2). system_health:ai_key.",
    authScopes: { hasPermission: "system_health:ai_key" },
    resolve: (_root, _args, ctx) => aiBudgetView(ctx.auth),
  }),
);

builder.mutationField("setAiBudget", (t) =>
  t.field({
    type: AiBudgetRef,
    description: "Change the school-wide AI budget and/or the alert percent. Audited.",
    authScopes: { hasPermission: "system_health:ai_key" },
    args: { monthlyUsd: t.arg.float({ required: false }), alertPct: t.arg.int({ required: false }) },
    resolve: (_root, args, ctx) => setAiBudget(ctx.auth, { monthlyUsd: args.monthlyUsd, alertPct: args.alertPct }),
  }),
);

builder.queryField("aiSettings", (t) =>
  t.field({
    type: AiSettingsRef,
    description: "Where a provider's key comes from, its last 4 characters, and the model. No provider = Gemini. system_health:ai_key.",
    authScopes: { hasPermission: "system_health:ai_key" },
    args: { provider: t.arg.string({ required: false }) },
    resolve: (_root, args, ctx) => aiSettingsView(ctx.auth, args.provider),
  }),
);

builder.mutationField("setAiSettings", (t) =>
  t.field({
    type: AiSettingsRef,
    description: "Save a new key and/or model for one provider (empty model = the default). Tested first; audited without the key.",
    authScopes: { hasPermission: "system_health:ai_key" },
    args: {
      apiKey: t.arg.string({ required: false }),
      model: t.arg.string({ required: false }),
      provider: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => setAiSettings(ctx.auth, { apiKey: args.apiKey, model: args.model, provider: args.provider }),
  }),
);

builder.mutationField("clearAiKey", (t) =>
  t.field({
    type: AiSettingsRef,
    description: "Forget the key saved in the app for one provider — the server's .env key is used again. Audited.",
    authScopes: { hasPermission: "system_health:ai_key" },
    args: { provider: t.arg.string({ required: false }) },
    resolve: (_root, args, ctx) => clearAiKey(ctx.auth, args.provider),
  }),
);

builder.queryField("aiFeatureSettings", (t) =>
  t.field({
    type: [AiFeatureRef],
    description: "Each AI feature: switched on, provider + model, fallback (AI-1). system_health:ai_key.",
    authScopes: { hasPermission: "system_health:ai_key" },
    resolve: (_root, _args, ctx) => aiFeatureSettings(ctx.auth),
  }),
);

builder.mutationField("setAiFeatureSetting", (t) =>
  t.field({
    type: AiFeatureRef,
    description: "Change one AI feature's switch, provider, model or fallback. Switching on tests the provider first. Audited.",
    authScopes: { hasPermission: "system_health:ai_key" },
    args: {
      feature: t.arg.string({ required: true }),
      enabled: t.arg.boolean({ required: false }),
      provider: t.arg.string({ required: false }),
      model: t.arg.string({ required: false }),
      fallback: t.arg.boolean({ required: false }),
      dailyPerUser: t.arg.int({ required: false }),
      monthlyUsd: t.arg.float({ required: false }),
      perSessionTurns: t.arg.int({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      setAiFeatureSetting(ctx.auth, {
        feature: args.feature,
        enabled: args.enabled,
        provider: args.provider,
        model: args.model,
        fallback: args.fallback,
        dailyPerUser: args.dailyPerUser,
        monthlyUsd: args.monthlyUsd,
        perSessionTurns: args.perSessionTurns,
      }),
  }),
);
