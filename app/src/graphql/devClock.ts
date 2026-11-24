/** AL-14: is the dev-site clock on? Public query; `active: false` on every site but the dev one. */
import { gql } from "urql";

export const DEV_CLOCK = gql<{ devClock: { active: boolean; todayKey: string | null; offsetMs: number | null } | null }, Record<string, never>>`
  query DevClock {
    devClock {
      active
      todayKey
      offsetMs
    }
  }
`;
