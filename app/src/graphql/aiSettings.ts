/**
 * AI keys & models (D-#967, D-#1090) — mirror server/src/modules/platform/resolvers/aiSettings.ts.
 * Keys are write-only: nothing here can read one back. `provider` absent = Gemini.
 */
import { gql } from "urql";

export type AiProviderT = "gemini" | "deepseek";

export interface AiSettingsT {
  provider: AiProviderT;
  source: "SETTING" | "ENV" | "NONE";
  keyLast4: string | null;
  model: string;
  modelSaved: string | null;
  defaultModel: string;
  updatedAt: string | null;
  updatedByName: string | null;
}

const FIELDS = "provider source keyLast4 model modelSaved defaultModel updatedAt updatedByName";

export const AI_SETTINGS_QUERY = gql<{ aiSettings: AiSettingsT }, { provider: AiProviderT }>`
  query AiSettings($provider: String) { aiSettings(provider: $provider) { ${FIELDS} } }
`;

export const SET_AI_SETTINGS = gql<
  { setAiSettings: AiSettingsT },
  { apiKey?: string | null; model?: string | null; provider: AiProviderT }
>`
  mutation SetAiSettings($apiKey: String, $model: String, $provider: String) {
    setAiSettings(apiKey: $apiKey, model: $model, provider: $provider) { ${FIELDS} }
  }
`;

export const CLEAR_AI_KEY = gql<{ clearAiKey: AiSettingsT }, { provider: AiProviderT }>`
  mutation ClearAiKey($provider: String) { clearAiKey(provider: $provider) { ${FIELDS} } }
`;

// AI-1/AI-2 (D-#1122, D-#1126): per-feature switch, provider, model, fallback and caps; the school budget.
export interface AiFeatureSettingT {
  feature: "comment_check" | "assistant";
  labelBn: string;
  labelEn: string;
  enabled: boolean;
  provider: AiProviderT;
  modelSaved: string | null;
  model: string;
  fallback: boolean;
  providerReady: boolean;
  dailyPerUser: number;
  monthlyUsd: number;
  perSessionTurns: number | null;
  updatedAt: string | null;
}

const FEATURE_FIELDS = "feature labelBn labelEn enabled provider modelSaved model fallback providerReady dailyPerUser monthlyUsd perSessionTurns updatedAt";

export const AI_FEATURE_SETTINGS = gql<{ aiFeatureSettings: AiFeatureSettingT[] }, Record<string, never>>`
  query AiFeatureSettings { aiFeatureSettings { ${FEATURE_FIELDS} } }
`;

export const SET_AI_FEATURE_SETTING = gql<
  { setAiFeatureSetting: AiFeatureSettingT },
  {
    feature: string;
    enabled?: boolean | null;
    provider?: AiProviderT | null;
    model?: string | null;
    fallback?: boolean | null;
    dailyPerUser?: number | null;
    monthlyUsd?: number | null;
    perSessionTurns?: number | null;
  }
>`
  mutation SetAiFeatureSetting(
    $feature: String!, $enabled: Boolean, $provider: String, $model: String, $fallback: Boolean,
    $dailyPerUser: Int, $monthlyUsd: Float, $perSessionTurns: Int
  ) {
    setAiFeatureSetting(
      feature: $feature, enabled: $enabled, provider: $provider, model: $model, fallback: $fallback,
      dailyPerUser: $dailyPerUser, monthlyUsd: $monthlyUsd, perSessionTurns: $perSessionTurns
    ) { ${FEATURE_FIELDS} }
  }
`;

export const AI_BUDGET = gql<{ aiBudget: { monthlyUsd: number; alertPct: number; updatedAt: string | null } }, Record<string, never>>`
  query AiBudget { aiBudget { monthlyUsd alertPct updatedAt } }
`;

export const SET_AI_BUDGET = gql<{ setAiBudget: { monthlyUsd: number; alertPct: number; updatedAt: string | null } }, { monthlyUsd?: number | null; alertPct?: number | null }>`
  mutation SetAiBudget($monthlyUsd: Float, $alertPct: Int) { setAiBudget(monthlyUsd: $monthlyUsd, alertPct: $alertPct) { monthlyUsd alertPct updatedAt } }
`;
