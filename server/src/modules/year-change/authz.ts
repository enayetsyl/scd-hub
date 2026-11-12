import { callerHasPermission, type Permission } from "@scd/shared";
import { ForbiddenError } from "../../middleware/authz";
import type { YearChangeActor } from "./types";

export type YearChangeAction = "view" | "prepare" | "undo" | "cut_over";

const PERMISSION_OF: Record<YearChangeAction, Permission> = {
  view: "year_change:view",
  prepare: "year_change:prepare",
  undo: "year_change:undo",
  cut_over: "year_change:cut_over",
};

/** The Principal-only `year_change:*` rights (LOCKED in the permission catalogue). */
export function assertYearChangeRight(actor: YearChangeActor | undefined, action: YearChangeAction): void {
  const perm = PERMISSION_OF[action];
  if (!actor || !callerHasPermission({ role: actor.role, additionalTemplates: actor.additionalTemplates }, perm)) {
    throw new ForbiddenError("শুধু প্রধান শিক্ষক শিক্ষাবর্ষ পরিবর্তন করতে পারেন।");
  }
}
