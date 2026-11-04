/**
 * Own sidebar arrangement (D-#920) — server: modules/platform/resolvers/navPreference.ts.
 */
import { gql } from "urql";

export interface NavPreferenceT {
  mode: string;
  order: string[];
  pinned: string[];
  usage: Array<{ key: string; count: number }>;
}

const NAV_PREFERENCE_FIELDS = `mode order pinned usage { key count }`;

export const MY_NAV_PREFERENCE = gql<{ myNavPreference: NavPreferenceT }, Record<string, never>>`
  query MyNavPreference {
    myNavPreference { ${NAV_PREFERENCE_FIELDS} }
  }
`;

export const SAVE_NAV_PREFERENCE = gql<
  { saveNavPreference: NavPreferenceT },
  { mode: string; order: string[]; pinned: string[] }
>`
  mutation SaveNavPreference($mode: String!, $order: [String!]!, $pinned: [String!]!) {
    saveNavPreference(mode: $mode, order: $order, pinned: $pinned) { ${NAV_PREFERENCE_FIELDS} }
  }
`;

export const RESET_NAV_PREFERENCE = gql<{ resetNavPreference: NavPreferenceT }, Record<string, never>>`
  mutation ResetNavPreference {
    resetNavPreference { ${NAV_PREFERENCE_FIELDS} }
  }
`;

export const RECORD_NAV_USE = gql<{ recordNavUse: boolean }, { key: string }>`
  mutation RecordNavUse($key: String!) {
    recordNavUse(key: $key)
  }
`;
