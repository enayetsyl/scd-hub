/** Registry of fake-2027 scenarios. A later slice adds its `scenarios/<n>-<name>.ts` and one line here. */
import { scenario0 } from "./0-lessons-attendance";
import { scenario2 } from "./2-homework-marks";
import type { Scenario } from "./types";

export const SCENARIOS: Scenario[] = [scenario0, scenario2];

export type { Scenario, ScenarioCtx, SectionInfo } from "./types";
