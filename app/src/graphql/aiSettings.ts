/**
 * AI key & model (D-#967) — mirror server/src/modules/platform/resolvers/aiSettings.ts.
 * The key is write-only: nothing here can read it back.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

export interface AiSettingsT {
  source: "SETTING" | "ENV" | "NONE";
  keyLast4: string | null;
  model: string;
  modelSaved: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

const FIELDS = "source keyLast4 model modelSaved updatedAt updatedByName";

export const AI_SETTINGS_QUERY = gql<{ aiSettings: AiSettingsT }, NoVars>`
  query AiSettings { aiSettings { ${FIELDS} } }
`;

export const SET_AI_SETTINGS = gql<{ setAiSettings: AiSettingsT }, { apiKey?: string | null; model?: string | null }>`
  mutation SetAiSettings($apiKey: String, $model: String) { setAiSettings(apiKey: $apiKey, model: $model) { ${FIELDS} } }
`;

export const CLEAR_AI_KEY = gql<{ clearAiKey: AiSettingsT }, NoVars>`
  mutation ClearAiKey { clearAiKey { ${FIELDS} } }
`;
