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
