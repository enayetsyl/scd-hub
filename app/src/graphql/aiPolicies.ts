/**
 * AI rules (AI-3, D-#1093) — mirror server/src/modules/platform/resolvers/aiPolicies.ts.
 */
import { gql } from "urql";

export type AiPolicyKeyT = "comment_standard" | "ct_comment_standard" | "assistant_rules";

export interface AiPolicySummaryT {
  key: AiPolicyKeyT;
  labelBn: string;
  labelEn: string;
  activeVersion: number | null;
  latestVersion: number | null;
  versions: number;
}

export interface AiPolicyVersionT {
  id: string;
  key: AiPolicyKeyT;
  version: number;
  body: string;
  hash: string;
  note: string | null;
  active: boolean;
  createdAt: string;
  createdByName: string | null;
  activatedAt: string | null;
}

const SUMMARY = "key labelBn labelEn activeVersion latestVersion versions";
const VERSION = "id key version body hash note active createdAt createdByName activatedAt";

export const AI_POLICY_SUMMARIES = gql<{ aiPolicySummaries: AiPolicySummaryT[] }, Record<string, never>>`
  query AiPolicySummaries { aiPolicySummaries { ${SUMMARY} } }
`;

export const ACTIVE_AI_POLICY = gql<{ activeAiPolicy: AiPolicyVersionT | null }, { key: AiPolicyKeyT }>`
  query ActiveAiPolicy($key: String!) { activeAiPolicy(key: $key) { ${VERSION} } }
`;

export const AI_POLICY_VERSIONS_PAGE = gql<
  { aiPolicyVersionsPage: { rows: AiPolicyVersionT[]; total: number; page: number; pageSize: number } },
  { key: AiPolicyKeyT; page: number; pageSize: number }
>`
  query AiPolicyVersionsPage($key: String!, $page: Int, $pageSize: Int) {
    aiPolicyVersionsPage(key: $key, page: $page, pageSize: $pageSize) { rows { ${VERSION} } total page pageSize }
  }
`;

export const AI_POLICY_VERSION = gql<{ aiPolicyVersion: AiPolicyVersionT }, { id: string }>`
  query AiPolicyVersion($id: String!) { aiPolicyVersion(id: $id) { ${VERSION} } }
`;

export const SAVE_AI_POLICY_VERSION = gql<{ saveAiPolicyVersion: AiPolicyVersionT }, { key: AiPolicyKeyT; body: string; note?: string | null }>`
  mutation SaveAiPolicyVersion($key: String!, $body: String!, $note: String) {
    saveAiPolicyVersion(key: $key, body: $body, note: $note) { ${VERSION} }
  }
`;

export const ACTIVATE_AI_POLICY_VERSION = gql<{ activateAiPolicyVersion: AiPolicyVersionT }, { id: string }>`
  mutation ActivateAiPolicyVersion($id: String!) { activateAiPolicyVersion(id: $id) { ${VERSION} } }
`;

export const DEACTIVATE_AI_POLICY = gql<{ deactivateAiPolicy: AiPolicySummaryT }, { key: AiPolicyKeyT }>`
  mutation DeactivateAiPolicy($key: String!) { deactivateAiPolicy(key: $key) { ${SUMMARY} } }
`;
