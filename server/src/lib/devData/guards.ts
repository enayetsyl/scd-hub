/**
 * Dev-data guards (AL-2, docs/prd-academic-loop-2027.md section 9.2 / 9.3, D-#1677).
 *
 * Every dev script (mask, fake-2027 generator, dev copy) refuses unless:
 *   1. the connected database name ends in `_dev`,
 *   2. the AL-1 outgoing guard says outgoing is CLOSED (`outgoingState().state === "OFF"`),
 *   3. the connection is not the prod one (`PROD_MONGODB_URI` host + DB equal to `MONGODB_URI`, when that env exists).
 *
 * URIs are only ever compared by "host list + db name"; credentials and options are dropped and
 * nothing here logs a URI.
 */
import { currentDbName, outgoingState } from "../outgoing";

export class DevGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevGuardError";
  }
}

/** `host1:port,host2:port/db` (lower-cased) from a mongodb URI, or null when it cannot be read. */
export function uriIdentity(uri: string | undefined | null): string | null {
  if (!uri) return null;
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/.exec(uri.trim());
  if (!m) return null;
  let db = m[2] ?? "";
  try {
    db = decodeURIComponent(db);
  } catch {
    /* keep raw */
  }
  return `${m[1].toLowerCase()}/${db}`;
}

export interface GuardInput {
  /** Override the connected DB name (tests). Default: the live connection / MONGODB_URI. */
  dbName?: string | null;
  /** Override the env (tests). Default: process.env. */
  env?: NodeJS.ProcessEnv;
  /** Override the outgoing guard result (tests). Default: `outgoingState()`. */
  outgoingOff?: boolean;
}

/** Throws `DevGuardError` unless the target is a closed-outgoing dev database that is not prod. */
export function assertDevTarget(input: GuardInput = {}): void {
  const env = input.env ?? process.env;
  const name = input.dbName !== undefined ? input.dbName : currentDbName();
  if (!name || !name.endsWith("_dev")) {
    throw new DevGuardError("refused: the connected database name does not end in `_dev`");
  }
  const off = input.outgoingOff !== undefined ? input.outgoingOff : outgoingState().state === "OFF";
  if (!off) {
    throw new DevGuardError("refused: the outgoing guard is open (OUTGOING_NOTIFICATIONS=on); close it first");
  }
  const prod = uriIdentity(env.PROD_MONGODB_URI);
  const here = uriIdentity(env.MONGODB_URI);
  if (prod && here && prod === here) {
    throw new DevGuardError("refused: MONGODB_URI points at the same host + database as PROD_MONGODB_URI");
  }
}
