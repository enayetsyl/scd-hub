/** Registry of fake-2027 scenarios. A later slice adds its `scenarios/<n>-<name>.ts` and one line here. */
import { scenario0 } from "./0-lessons-attendance";
import { scenario2 } from "./2-homework-marks";
import { scenario2b } from "./2b-assignment-test-classwork";
import { scenario3 } from "./3-engine-weak-absent";
import { scenario4 } from "./4-reteach";
import { scenario5 } from "./5-late-marking";
import { scenario6 } from "./6-behind-target";
import { scenario7 } from "./7-outside-help";
import { scenario8 } from "./8-loop-health";
import type { Scenario } from "./types";

export const SCENARIOS: Scenario[] = [scenario0, scenario2, scenario2b, scenario3, scenario4, scenario5, scenario6, scenario7, scenario8];

export type { Scenario, ScenarioCtx, SectionInfo } from "./types";
