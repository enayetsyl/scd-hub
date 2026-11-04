/**
 * Voice tasks (VT-1, D-#960–#965) — the I/O half: who the caller may assign to, the
 * Gemini call (audio as inline_data + the strict JSON schema), then the pure
 * `buildDraft`. It WRITES NOTHING: the app saves the reviewed cards through the
 * existing createTask / createTaskTemplate, so every rule, audit row and notification
 * stays exactly where it already is.
 *
 * Provider: Gemini over REST (no SDK), the same seam and key as MonthlyCommentService —
 * GEMINI_API_KEY, optional GEMINI_MODEL; the alias default resolves to the current Flash.
 */
import { callerHasPermission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { dateKeyOf } from "../../attendance/dates";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { User } from "../../foundation/models/User";
import { normalizePhone } from "../../foundation/services/credentials";
import { allStaffUsers, type BoardUser } from "../services/WorkBoardService";
import { buildDraft, buildVoicePrompt, VOICE_TASK_SCHEMA, type RawVoiceReply, type VoiceStaff, type VoiceTaskDraft } from "./voiceTaskDraft";

/** 90 s of 16 kHz mono 16-bit WAV is ~2.9 MB → ~3.9 MB base64; room for other formats. */
export const MAX_AUDIO_BASE64 = 6_000_000;
const MAX_PRIOR_DRAFT = 20_000;
const MAX_TYPED = 2_000;
const AUDIO_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/mp3", "audio/mpeg", "audio/aac", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/ogg", "audio/flac", "audio/webm"]);

export interface VoiceTaskInput {
  audioBase64?: string | null;
  mimeType?: string | null;
  text?: string | null;
  priorDraftJson?: string | null;
}

/** The transport seam — tests replace it; production posts to Gemini. */
export interface VoiceModel {
  run(prompt: string, audio: { mimeType: string; data: string } | null): Promise<RawVoiceReply>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GeminiVoiceModel implements VoiceModel {
  constructor(
    private readonly apiKey: string,
    private readonly model = "gemini-flash-latest",
  ) {}

  async run(prompt: string, audio: { mimeType: string; data: string } | null): Promise<RawVoiceReply> {
    const parts: unknown[] = [{ text: prompt }];
    if (audio) parts.push({ inline_data: { mime_type: audio.mimeType, data: audio.data } });
    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        // Thinking cannot be switched off on Flash; the budget covers it AND the JSON.
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: VOICE_TASK_SCHEMA,
      },
    });
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body,
      });
      if (![429, 500, 503].includes(res.status)) break;
      await sleep(1500);
    }
    if (!res || !res.ok) {
      console.error(`[voice-tasks] Gemini returned ${res?.status}`);
      throw new Error("কণ্ঠ বোঝার সেবা এখন সাড়া দিচ্ছে না — একটু পরে আবার চেষ্টা করুন");
    }
    const json = (await res.json()) as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
    const candidate = json.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      console.error(`[voice-tasks] Gemini stopped early: ${candidate.finishReason}`);
    }
    try {
      return JSON.parse(text) as RawVoiceReply;
    } catch {
      throw new Error("কথাটি বোঝা যায়নি — আবার বলুন");
    }
  }
}

/** Null when no key is configured — the resolver then refuses with a clear message. */
export function voiceModelFromEnv(): VoiceModel | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GeminiVoiceModel(key, process.env.GEMINI_MODEL || undefined);
}

/** Bangla name + designation per user, joined by the staffMatch rule (D-#788): phone
 *  first, then e-mail; an ambiguous key resolves nobody. */
async function profilesFor(users: BoardUser[]): Promise<Map<string, { nameBn: string | null; designation: string | null }>> {
  const out = new Map<string, { nameBn: string | null; designation: string | null }>();
  const profiles = (await StaffProfile.find({ active: true })
    .select("phone email nameBn designation")
    .lean()) as unknown as Array<{ phone?: string; email?: string; nameBn?: string; designation?: string }>;
  const normEmail = (e?: string | null): string => (e ?? "").trim().toLowerCase();
  const byPhone = new Map<string, typeof profiles>();
  const byEmail = new Map<string, typeof profiles>();
  for (const p of profiles) {
    if (p.phone) {
      const k = normalizePhone(p.phone);
      byPhone.set(k, [...(byPhone.get(k) ?? []), p]);
    }
    const e = normEmail(p.email);
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), p]);
  }
  for (const u of users) {
    const viaPhone = u.phone ? byPhone.get(normalizePhone(u.phone)) ?? [] : [];
    const hits = viaPhone.length > 0 ? viaPhone : byEmail.get(normEmail(u.email)) ?? [];
    if (hits.length === 1) out.set(u._id.toString(), { nameBn: hits[0].nameBn?.trim() || null, designation: hits[0].designation?.trim() || null });
  }
  return out;
}

/** The people this caller may give a task to: every active staff login with
 *  work_board:assign, otherwise the caller alone (D-#961). */
export async function voiceStaffFor(auth: AuthPayload): Promise<{ staff: VoiceStaff[]; selfOnly: boolean }> {
  const selfOnly = !callerHasPermission(auth, "work_board:assign");
  const users: BoardUser[] = selfOnly
    ? ((await User.find({ _id: auth.userId }).select("name role phone email").lean()) as unknown as BoardUser[])
    : await allStaffUsers();
  const prof = await profilesFor(users);
  const staff = users.map((u) => {
    const p = prof.get(u._id.toString());
    return { userId: u._id.toString(), name: u.name, nameBn: p?.nameBn ?? null, designation: p?.designation ?? null };
  });
  return { staff, selfOnly };
}

function validate(input: VoiceTaskInput): { audio: { mimeType: string; data: string } | null; text: string | null; prior: string | null } {
  const data = input.audioBase64?.trim() || null;
  const text = input.text?.trim() || null;
  if (!data && !text) throw new Error("কিছু বলা বা লেখা হয়নি");
  if (text && text.length > MAX_TYPED) throw new Error("লেখাটি খুব বড়");
  let audio: { mimeType: string; data: string } | null = null;
  if (data) {
    if (data.length > MAX_AUDIO_BASE64) throw new Error("রেকর্ডিং খুব লম্বা — ৯০ সেকেন্ডের মধ্যে বলুন");
    const mimeType = (input.mimeType ?? "").split(";")[0].trim().toLowerCase();
    if (!AUDIO_TYPES.has(mimeType)) throw new Error("এই ধরনের রেকর্ডিং পড়া যায় না");
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) throw new Error("রেকর্ডিংটি পড়া যায়নি — আবার রেকর্ড করুন");
    audio = { mimeType, data };
  }
  let prior: string | null = null;
  if (input.priorDraftJson) {
    if (input.priorDraftJson.length > MAX_PRIOR_DRAFT) throw new Error("আগের খসড়াটি খুব বড়");
    try {
      prior = JSON.stringify(JSON.parse(input.priorDraftJson));
    } catch {
      throw new Error("আগের খসড়াটি পড়া যায়নি");
    }
  }
  return { audio, text, prior };
}

/** Voice note (or typed text) → a draft. Gate: work_board:voice. Writes nothing. */
export async function parseVoiceTasks(authIn: AuthPayload | null, input: VoiceTaskInput, model: VoiceModel | null = voiceModelFromEnv(), now = new Date()): Promise<VoiceTaskDraft> {
  if (!authIn) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(authIn, "work_board:voice")) throw new ForbiddenError("কণ্ঠে কাজ দেওয়ার অনুমতি নেই");
  const { audio, text, prior } = validate(input);
  if (!model) throw new Error("কণ্ঠ বোঝার সেবা চালু করা হয়নি (GEMINI_API_KEY) — অফিসকে জানান");
  const todayKey = dateKeyOf(now);
  const { staff, selfOnly } = await voiceStaffFor(authIn);
  const prompt = buildVoicePrompt({ todayKey, staff, selfId: authIn.userId, priorDraftJson: prior, typedText: text });
  const raw = await model.run(prompt, audio);
  return buildDraft(raw, { staff, selfId: authIn.userId, selfOnly, todayKey });
}
