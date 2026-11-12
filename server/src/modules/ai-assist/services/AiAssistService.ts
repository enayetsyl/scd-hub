/**
 * AiAssistService (AI-6, D-#1096 / D-#1104 / D-#1105) — the teacher's AI assistant.
 *
 * A teacher opens a conversation about one class level × subject × chapter (optionally one
 * session); each question is answered from that chapter's plans (session plans + chapter
 * plan, `ContentArtifact.renderedMarkdown`) and the active `assistant_rules`.
 *
 *   Prompt (cache order, D-#1090): fixed instructions + assistant rules (stable) → chapter
 *   plans (stable within the conversation) → earlier turns → the new question. Questions and
 *   earlier turns are DE-IDENTIFIED against every active child, guardian and staff name, with
 *   the fail-closed gate (D-#1094); the answer comes back with names restored.
 *   Every turn goes through `aiSend("assistant")`: switch, caps (incl. turns per session),
 *   metering with refId = the conversation.
 *
 * Who reads what (D-#1104): a teacher sees only their own conversations; the Principal
 * (`ai_assist:read_all_chats`, LOCKED) can read every one; nobody else.
 */
import { Types } from "mongoose";
import type { AuthPayload } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { sessionPlansFor } from "../../lesson-progress/services/LessonDeliveryService";
import { AiAssistSession, type IAiAssistSession } from "../models/AiAssistSession";
import { AiAssistMessage, type IAiAssistMessage } from "../models/AiAssistMessage";
import { aiSend, AiFeatureOffError } from "../../platform/ai/aiRouter";
import { AiProviderError } from "../../platform/ai/provider";
import { assertDeidentified, deidentify, DeidentifyError, reidentify, type DeidScope } from "../../platform/ai/deidentify";
import { scopeForSections } from "../../platform/services/DeidScopeService";
import { activeAiPolicy } from "../../platform/services/AiPolicyService";
import { aiFeatureConfig } from "../../platform/services/AiSettingService";
import { AiCapError } from "../../platform/services/AiUsageService";
import { currentYearSectionFilter } from "../../foundation/services/currentYear";

export class AiAssistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiAssistError";
  }
}

/** Fixed instructions — part of the stable prefix. */
export const ASSISTANT_INSTRUCTIONS = `You are the teaching assistant of a Bangladeshi Islamic school. Teachers ask you about the lesson they will teach. Follow THE RULES below. ALWAYS answer in Bangla — even when the question is written in English (D-#1178); English subject terms and English-medium content (an English lesson's words, sentences) may stay in English.

- The chapter material that follows the rules is the school's own lesson plan. Prefer it over anything else.
- Tokens like [S1], [G1], [T1], [PHONE], [NUM], [ID] stand for hidden names and numbers. Keep them exactly; never invent a name.
- Keep answers short and practical; use lists and steps where they help.

THE RULES:
`;

const MAX_QUESTION = 4000;
const MAX_CONTEXT_CHARS = 30_000;
const HISTORY_TURNS = 10;

function assertChat(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "ai_assist:chat")) throw new ForbiddenError("এআই সহকারী ব্যবহারের অনুমতি নেই");
  return auth;
}

const canReadAll = (auth: AuthPayload) => callerHasPermission(auth, "ai_assist:read_all_chats");

export interface AssistSessionView {
  id: string;
  teacherId: string;
  teacherName: string | null;
  classLevel: number;
  subject: string;
  chapter: string | null;
  sessionIndex: number | null;
  title: string;
  turns: number;
  lastAt: Date;
  createdAt: Date;
}

export interface AssistMessageView {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: Date;
}

async function sessionViews(docs: IAiAssistSession[]): Promise<AssistSessionView[]> {
  const ids = [...new Set(docs.map((d) => d.teacherId.toString()))];
  const names = new Map((await User.find({ _id: { $in: ids } }).select("name").lean()).map((u) => [u._id.toString(), u.name]));
  return docs.map((d) => ({
    id: d._id.toString(),
    teacherId: d.teacherId.toString(),
    teacherName: names.get(d.teacherId.toString()) ?? null,
    classLevel: d.classLevel ?? 0,
    subject: d.subject ?? "",
    chapter: d.chapter ?? null,
    sessionIndex: d.sessionIndex ?? null,
    title: d.title,
    turns: d.turns,
    lastAt: d.lastAt,
    createdAt: d.createdAt,
  }));
}

/** Is the assistant usable right now (feature on + rules on)? */
export async function assistantAvailable(auth: AuthPayload | null): Promise<boolean> {
  if (!auth || !callerHasPermission(auth, "ai_assist:chat")) return false;
  const [cfg, rules] = await Promise.all([aiFeatureConfig("assistant"), activeAiPolicy("assistant_rules")]);
  return cfg.enabled && !!rules;
}

export interface AssistTopic {
  classLevel: number;
  subject: string;
  chapters: Array<{ chapter: string; title: string | null; sessions: Array<{ sessionIndex: number; titleBn: string }> }>;
}

/** Class level × subject pairs that have current session plans, with their chapters. */
export async function assistantTopics(authIn: AuthPayload | null): Promise<AssistTopic[]> {
  assertChat(authIn);
  const pairs = (await ContentArtifact.aggregate<{ _id: { classLevel: number; subject: string } }>([
    { $match: { docType: "session_plan", current: true, retiredAt: null } },
    { $group: { _id: { classLevel: "$classLevel", subject: "$subject" } } },
    { $sort: { "_id.classLevel": 1, "_id.subject": 1 } },
  ])).map((p) => p._id);
  const out: AssistTopic[] = [];
  for (const p of pairs) {
    const plans = await sessionPlansFor(p.classLevel, p.subject);
    const chapters = new Map<string, AssistTopic["chapters"][number]>();
    for (const s of plans) {
      const c = chapters.get(s.chapter) ?? { chapter: s.chapter, title: s.chapterTitle, sessions: [] };
      c.sessions.push({ sessionIndex: s.sessionIndex, titleBn: s.titleBn });
      chapters.set(s.chapter, c);
    }
    out.push({ classLevel: p.classLevel, subject: p.subject, chapters: [...chapters.values()] });
  }
  return out;
}

export async function startAssistSession(
  authIn: AuthPayload | null,
  input: { classLevel: number; subject: string; chapter?: string | null; sessionIndex?: number | null },
): Promise<AssistSessionView> {
  const auth = assertChat(authIn);
  if (!Number.isInteger(input.classLevel) || input.classLevel < -1 || input.classLevel > 12) throw new AiAssistError("শ্রেণি সঠিক নয়");
  const subject = (input.subject ?? "").trim().toUpperCase();
  if (!/^[A-Z_]{2,20}$/.test(subject)) throw new AiAssistError("বিষয় সঠিক নয়");
  const chapter = input.chapter?.trim() || undefined;
  const sessionIndex = chapter && input.sessionIndex && input.sessionIndex >= 1 ? Math.floor(input.sessionIndex) : undefined;
  const title = [`C${input.classLevel}`, subject, chapter ? `অধ্যায় ${chapter}` : null, sessionIndex ? `সেশন ${sessionIndex}` : null].filter(Boolean).join(" · ");
  const now = new Date();
  const doc = await AiAssistSession.create({ teacherId: new Types.ObjectId(auth.userId), classLevel: input.classLevel, subject, chapter, sessionIndex, title, turns: 0, lastAt: now });
  return (await sessionViews([doc]))[0];
}

async function loadSession(auth: AuthPayload, sessionId: string, forWrite: boolean): Promise<IAiAssistSession> {
  if (!Types.ObjectId.isValid(sessionId)) throw new AiAssistError("আলাপটি পাওয়া যায়নি");
  const s = await AiAssistSession.findById(sessionId);
  // AI Workspace chats (W-2) share the collection but are never the assistant's.
  if (!s || s.projectId) throw new AiAssistError("আলাপটি পাওয়া যায়নি");
  const own = s.teacherId.toString() === auth.userId;
  if (!own && (forWrite || !canReadAll(auth))) throw new ForbiddenError("এই আলাপ আপনার নয়");
  return s;
}

/** The chapter's plans as one markdown block (session first if one was picked), capped. */
export async function chapterContext(s: Pick<IAiAssistSession, "classLevel" | "subject" | "chapter" | "sessionIndex">): Promise<string> {
  if (!s.chapter || s.classLevel === undefined || !s.subject) return "";
  const plans = (await sessionPlansFor(s.classLevel, s.subject)).filter((p) => p.chapter === s.chapter);
  plans.sort((a, b) => (a.sessionIndex === s.sessionIndex ? -1 : b.sessionIndex === s.sessionIndex ? 1 : a.sessionIndex - b.sessionIndex));
  const ids = plans.map((p) => new Types.ObjectId(p.artifactId));
  const [sessionDocs, chapterDoc] = await Promise.all([
    ContentArtifact.find({ _id: { $in: ids } }).select("renderedMarkdown").lean(),
    ContentArtifact.findOne({ docType: "chapter_plan", classLevel: s.classLevel, subject: s.subject, current: true, retiredAt: null, "address.number": { $in: [s.chapter, Number(s.chapter)] } })
      .select("renderedMarkdown")
      .lean(),
  ]);
  const md = new Map(sessionDocs.map((d) => [d._id.toString(), (d as { renderedMarkdown?: string }).renderedMarkdown ?? ""]));
  const parts = [
    `CHAPTER ${s.chapter} (class ${s.classLevel}, ${s.subject})`,
    (chapterDoc as { renderedMarkdown?: string } | null)?.renderedMarkdown ? `## Chapter plan\n\n${(chapterDoc as { renderedMarkdown?: string }).renderedMarkdown}` : "",
    ...plans.map((p) => `## Session ${p.sessionIndex}: ${p.titleBn}\n\n${md.get(p.artifactId) ?? ""}`),
  ].filter(Boolean);
  const all = parts.join("\n\n");
  return all.length > MAX_CONTEXT_CHARS ? `${all.slice(0, MAX_CONTEXT_CHARS)}\n\n[…the rest of the chapter plan is not included]` : all;
}

async function schoolScope(): Promise<DeidScope> {
  const sections = await Section.find({ active: { $ne: false }, ...(await currentYearSectionFilter()) }).select("_id").lean();
  return scopeForSections(sections.map((s) => s._id.toString()));
}

export async function askAssistant(authIn: AuthPayload | null, sessionId: string, questionIn: string): Promise<AssistMessageView[]> {
  const auth = assertChat(authIn);
  const s = await loadSession(auth, sessionId, true);
  const question = (questionIn ?? "").trim();
  if (question.length < 2) throw new AiAssistError("প্রশ্ন লিখুন");
  if (question.length > MAX_QUESTION) throw new AiAssistError("প্রশ্ন খুব বড় (৪,০০০ অক্ষরের বেশি)");

  const rules = await activeAiPolicy("assistant_rules");
  if (!rules) throw new AiAssistError("সহকারীর নিয়ম এখনো চালু হয়নি — প্রধান শিক্ষক চালু করলে ব্যবহার করা যাবে");

  const scope = await schoolScope();
  const earlier = (await AiAssistMessage.find({ sessionId: s._id }).sort({ at: -1 }).limit(HISTORY_TURNS * 2).lean()).reverse() as unknown as IAiAssistMessage[];
  const q = deidentify(question, scope);
  const history = earlier.map((m) => ({ role: m.role, ...deidentify(m.text, scope) }));
  try {
    assertDeidentified(q.text, scope);
  } catch (e) {
    if (e instanceof DeidentifyError) throw new AiAssistError(e.message);
    throw e;
  }
  const map: Record<string, string> = Object.assign({}, ...history.map((h) => h.map), q.map);

  let out;
  try {
    out = await aiSend(
      "assistant",
      {
        stablePrefix: ASSISTANT_INSTRUCTIONS + rules.body,
        context: await chapterContext(s),
        history: history.map((h) => ({ role: h.role, text: h.text })),
        variablePart: q.text,
        maxOutputTokens: 1000,
        reasoning: "low",
      },
      { userId: auth.userId, role: auth.role, refType: "AiAssistSession", sessionId: s._id.toString(), policyHash: rules.hash },
    );
  } catch (e) {
    if (e instanceof AiFeatureOffError) throw new AiAssistError("এআই সহকারী এখন বন্ধ আছে");
    if (e instanceof AiCapError) throw new AiAssistError(e.message);
    if (e instanceof AiProviderError) throw new AiAssistError("এআই এখন সাড়া দিচ্ছে না — একটু পরে আবার চেষ্টা করুন");
    throw e;
  }

  const answer = reidentify(out.result.text, map);
  const now = new Date();
  const [u, a] = await AiAssistMessage.insertMany([
    { sessionId: s._id, teacherId: s.teacherId, role: "user", text: question, at: now },
    { sessionId: s._id, teacherId: s.teacherId, role: "assistant", text: answer, at: new Date(now.getTime() + 1), modelName: out.result.resolvedModel || out.result.model, policyHash: rules.hash },
  ]);
  await AiAssistSession.updateOne({ _id: s._id }, { $inc: { turns: 1 }, $set: { lastAt: now } });
  return [u, a].map((m) => ({ id: m._id.toString(), role: m.role, text: m.text, at: m.at }));
}

export async function myAssistSessionsPage(authIn: AuthPayload | null, args: PageArgs): Promise<Page<AssistSessionView>> {
  const auth = assertChat(authIn);
  return queryPage(AiAssistSession, { teacherId: new Types.ObjectId(auth.userId), projectId: null }, { lastAt: -1 }, args, (docs) => sessionViews(docs as unknown as IAiAssistSession[]), 20);
}

/** Every teacher's conversations — the Principal only (D-#1104). */
export async function allAssistSessionsPage(authIn: AuthPayload | null, args: PageArgs & { teacherId?: string | null }): Promise<Page<AssistSessionView>> {
  if (!authIn) throw new ForbiddenError("Unauthenticated");
  if (!canReadAll(authIn)) throw new ForbiddenError("সব শিক্ষকের আলাপ দেখার অনুমতি নেই");
  const filter: Record<string, unknown> = { projectId: null };
  if (args.teacherId && Types.ObjectId.isValid(args.teacherId)) filter.teacherId = new Types.ObjectId(args.teacherId);
  return queryPage(AiAssistSession, filter, { lastAt: -1 }, args, (docs) => sessionViews(docs as unknown as IAiAssistSession[]), 20);
}

/** One conversation's turns, oldest first. Own conversation, or the Principal. */
export async function assistMessagesPage(authIn: AuthPayload | null, sessionId: string, args: PageArgs): Promise<Page<AssistMessageView> & { session: AssistSessionView }> {
  if (!authIn) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(authIn, "ai_assist:chat") && !canReadAll(authIn)) throw new ForbiddenError("এআই সহকারী ব্যবহারের অনুমতি নেই");
  const s = await loadSession(authIn, sessionId, false);
  const page = await queryPage(AiAssistMessage, { sessionId: s._id }, { at: 1 }, args, (docs) =>
    (docs as unknown as IAiAssistMessage[]).map((m) => ({ id: m._id.toString(), role: m.role, text: m.text, at: m.at })),
    100,
  );
  return { ...page, session: (await sessionViews([s]))[0] };
}
