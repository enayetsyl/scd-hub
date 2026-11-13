/**
 * The data-assistant tool-call log, read side (docs/prd-data-assistant-mcp.md §8.1, §11; D-#1538).
 * `dataToolCallsPage`: every person's calls — `data_assistant:audit` (LOCKED, Principal).
 * `myDataToolCallsPage`: one person's own calls (any staff login; shown on "Connected apps").
 * Paged from the first version (D-#761). Arguments are already swept; results were never stored.
 */
import { Types, type FilterQuery } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { User } from "../../foundation/models/User";
import { AiDataCall, DATA_CALL_OUTCOMES, DATA_SURFACES, type IAiDataCall } from "../models/AiDataCall";

export interface DataCallView {
  id: string;
  at: Date;
  userId: string;
  userName: string | null;
  role: string;
  impersonatorName: string | null;
  surface: string;
  clientName: string | null;
  tool: string;
  args: string;
  outcome: string;
  deniedNeeds: string[];
  rowCount: number;
  truncated: boolean;
  replyBytes: number;
  ms: number;
}

export interface DataCallFilter {
  userId?: string | null;
  tool?: string | null;
  surface?: string | null;
  clientName?: string | null;
  outcome?: string | null;
  /** Dhaka date keys, inclusive. */
  fromKey?: string | null;
  toKey?: string | null;
}

const KEY = /^\d{4}-\d{2}-\d{2}$/;

function mongoFilter(f: DataCallFilter): FilterQuery<IAiDataCall> {
  const q: FilterQuery<IAiDataCall> = {};
  if (f.userId) {
    if (!Types.ObjectId.isValid(f.userId)) throw new Error("ব্যক্তি সঠিক নয়");
    q.userId = new Types.ObjectId(f.userId);
  }
  if (f.tool) q.tool = String(f.tool).slice(0, 80);
  if (f.surface) {
    if (!(DATA_SURFACES as readonly string[]).includes(f.surface)) throw new Error("মাধ্যম সঠিক নয়");
    q.surface = f.surface as IAiDataCall["surface"];
  }
  if (f.clientName) q.clientName = String(f.clientName).slice(0, 200);
  if (f.outcome) {
    if (!(DATA_CALL_OUTCOMES as readonly string[]).includes(f.outcome)) throw new Error("ফলাফল সঠিক নয়");
    q.outcome = f.outcome as IAiDataCall["outcome"];
  }
  const at: Record<string, Date> = {};
  if (f.fromKey) {
    if (!KEY.test(f.fromKey)) throw new Error("তারিখ YYYY-MM-DD দিন");
    at.$gte = new Date(`${f.fromKey}T00:00:00+06:00`);
  }
  if (f.toKey) {
    if (!KEY.test(f.toKey)) throw new Error("তারিখ YYYY-MM-DD দিন");
    at.$lt = new Date(new Date(`${f.toKey}T00:00:00+06:00`).getTime() + 86_400_000);
  }
  if (Object.keys(at).length) q.at = at;
  return q;
}

async function toViews(rows: IAiDataCall[]): Promise<DataCallView[]> {
  const ids = [...new Set(rows.flatMap((r) => [String(r.userId), r.impersonatorId ? String(r.impersonatorId) : ""]).filter(Boolean))];
  const users = (await User.find({ _id: { $in: ids } }).select("name").lean()) as Array<{ _id: Types.ObjectId; name?: string }>;
  const name = new Map(users.map((u) => [String(u._id), u.name ?? null]));
  return rows.map((r) => ({
    id: String(r._id),
    at: r.at,
    userId: String(r.userId),
    userName: name.get(String(r.userId)) ?? null,
    role: r.role,
    impersonatorName: r.impersonatorId ? name.get(String(r.impersonatorId)) ?? null : null,
    surface: r.surface,
    clientName: r.clientName ?? null,
    tool: r.tool,
    args: r.args,
    outcome: r.outcome,
    deniedNeeds: r.deniedNeeds ?? [],
    rowCount: r.rowCount,
    truncated: r.truncated,
    replyBytes: r.replyBytes,
    ms: r.ms,
  }));
}

async function page(filter: FilterQuery<IAiDataCall>, args: PageArgs): Promise<Page<DataCallView>> {
  return queryPage(AiDataCall, filter, { at: -1, _id: -1 }, args, (docs) => toViews(docs as unknown as IAiDataCall[]));
}

export async function dataToolCallsPage(auth: AuthPayload | null, f: DataCallFilter, args: PageArgs): Promise<Page<DataCallView>> {
  if (!auth || auth.role === "GUARDIAN") throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "data_assistant:audit")) throw new ForbiddenError("শুধু প্রধান শিক্ষক");
  return page(mongoFilter(f), args);
}

export async function myDataToolCallsPage(auth: AuthPayload | null, f: DataCallFilter, args: PageArgs): Promise<Page<DataCallView>> {
  if (!auth || auth.role === "GUARDIAN") throw new ForbiddenError("Unauthenticated");
  return page({ ...mongoFilter({ ...f, userId: null }), userId: new Types.ObjectId(auth.userId) }, args);
}
