/**
 * useMasteryLevelLabels — THE app hook for the objective-tree level names (D-#923).
 *
 * The words (defaults: shared MASTERY_LEVEL_LABEL_DEFAULTS) live in ONE setting on the SCHOOL MasteryPolicy
 * row, edited on the পলিসি screen. Every screen that names a level reads it here — never a
 * hard-coded word — so a rename in পলিসি changes every surface without a deploy. Until the query
 * answers (or for a viewer who cannot read it) the shared defaults are used.
 */
import { useQuery } from "urql";
import { MASTERY_LEVEL_LABEL_DEFAULTS, type MasteryLevelLabels } from "@scd/shared";
import { MASTERY_LEVEL_LABELS_QUERY } from "../graphql/mastery";
import { getActiveLang } from "./labels";

export interface MasteryLevelWords {
  /** In the active language. */
  domain: string;
  objective: string;
  sub: string;
  /** Both languages, as stored. */
  raw: MasteryLevelLabels;
  ownKeys: string[];
  fetching: boolean;
  refetch: () => void;
}

export function useMasteryLevelLabels(pause = false): MasteryLevelWords {
  const [{ data, fetching }, refetch] = useQuery({ query: MASTERY_LEVEL_LABELS_QUERY, pause });
  const got = data?.masteryLevelLabels as { resolved: MasteryLevelLabels; ownKeys: string[] } | undefined;
  const raw: MasteryLevelLabels = { ...MASTERY_LEVEL_LABEL_DEFAULTS, ...(got?.resolved ?? {}) };
  const en = getActiveLang() === "en";
  return {
    domain: en ? raw.domainEn : raw.domainBn,
    objective: en ? raw.objectiveEn : raw.objectiveBn,
    sub: en ? raw.subEn : raw.subBn,
    raw,
    ownKeys: got?.ownKeys ?? [],
    fetching,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
