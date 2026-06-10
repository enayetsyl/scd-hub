/**
 * urql error helpers. The server throws ForbiddenError ("Forbidden") for
 * row-scope denials and the Pothos scope-auth plugin throws "Not authorized"
 * for RBAC denials — both surface as graphQLErrors. We map those to the
 * required Bangla write-permission message (PRD §8 RBAC rules); everything else
 * falls back to the server message or a generic Bangla error.
 */
import type { CombinedError } from "urql";
import { STR } from "./labels";

const FORBIDDEN_RE = /forbidden|not authori[sz]ed|unauthenticated|permission|scope/i;

export function isForbidden(error?: CombinedError | null): boolean {
  if (!error) return false;
  if (error.networkError) return false;
  return error.graphQLErrors.some((e) => FORBIDDEN_RE.test(e.message));
}

/** A user-facing Bangla message for any urql error. */
export function friendlyError(error?: CombinedError | null): string {
  if (!error) return STR.errGeneric;
  if (isForbidden(error)) return STR.errForbiddenWrite;
  if (error.networkError) return STR.errNetwork;
  const first = error.graphQLErrors[0]?.message;
  return first ? first : STR.errGeneric;
}
