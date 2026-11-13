/**
 * CSP-1 review fixes — the safeguarding sign list tolerates past tense, a word in between and
 * English endings (docs/prd-child-support-profile.md §16.5 SG-2), and a child with no enrolment
 * covering today has no readers at all (§2.4, §8.2.1). Pure: no database.
 */
import { safeguardingTermIn, scanSafeguarding, type SafeguardingSign } from "@scd/shared";
import { computeSupportReaders, type ScopeInputs } from "../modules/support-profile/services/supportScope";

const signsOf = (behaviour: string): SafeguardingSign[] => [...new Set(scanSafeguarding({ behaviour }).map((h) => h.sign))];

describe("safeguarding sign list — variants", () => {
  it.each([
    ["আব্বু ওকে মারে, সে বলেছে", "DISCLOSURE"],
    ["সে বলল আব্বু মেরেছে", "DISCLOSURE"],
    ["রাতে আম্মু মেরে দিয়েছে বলল", "DISCLOSURE"],
    ["বাবা প্রায়ই তাকে মারধোর করে", "DISCLOSURE"],
    ["মা ওকে পিটিয়ে ঘর থেকে বের করেছে", "DISCLOSURE"],
    ["বাঁ হাতে একটি কালসিটে দেখেছি", "INJURY"],
    ["পিঠে কালশিরা ছিল", "INJURY"],
    ["আব্বু ওকে ভয় দেখায় বলল", "FEAR"],
    ["বাবা হুমকি দিয়েছে বলল", "FEAR"],
    ["স্যার ওকে মেরেছে", "ADULT_HARM"],
    ["ম্যাডাম ওকে পিটিয়ে ক্লাস থেকে বের করেছে", "ADULT_HARM"],
    ["হুজুর ভয় দেখিয়েছে বলল", "ADULT_HARM"],
    ["he has bruises on his arm", "INJURY"],
    ["there was a bruised patch near the elbow", "INJURY"],
    ["bruising on the back", "INJURY"],
    ["she talked about suicidal thoughts", "SELF_HARM"],
    ["he keeps self-harming", "SELF_HARM"],
    ["she drew weapons on the page and said she would use them", "SERIOUS_PEER_HARM"],
    ["he brought knives from home", "SERIOUS_PEER_HARM"],
  ] as const)("%s → %s", (text, sign) => {
    expect(signsOf(text)).toContain(sign);
  });

  it.each([
    "বন্ধু ওকে মেরেছে, দুজনকেই আলাদা করেছি",
    "রাফি লাইনে এক সহপাঠীকে মেরেছে",
    "মা এসে বললেন ছেলে ভালো আছে",
    "স্যার বললেন সবাই চুপ করে বসো",
    "আব্বু স্কুলে নিতে এসেছিলেন, হাসিমুখে ছিল",
    "সে হাঁটু ছিলে ফেলল খেলতে গিয়ে",
    "he hit the ball over the fence",
    "she sharpened her pencil",
    "দুজন মারামারি করেছে মাঠে",
  ])("control stays quiet: %s", (text) => {
    expect(signsOf(text)).toEqual([]);
    expect(safeguardingTermIn(text)).toBeNull();
  });

  it("the V-9 one-sentence check sees the variants too", () => {
    expect(safeguardingTermIn("আব্বু ওকে মারে")).not.toBeNull();
  });
});

describe("currentSupportReaders core — no enrolment today", () => {
  const T = "2026-11-12";
  const withGroups = (over: Partial<ScopeInputs>): ScopeInputs => ({
    todayKey: T,
    sectionId: null,
    classTeacherId: null,
    subjectGroupIds: ["q1"],
    teachingGrants: [],
    proxyGrants: [],
    slots: [{ teacherId: "quran", groupType: "subjectgroup", groupId: "q1", fromKey: "2026-01-01", toKey: null, active: true }],
    groupCovers: [{ coverTeacherId: "qcov", groupId: "q1", dateKey: T, active: true }],
    ...over,
  });
  it("sectionId null → no readers at all, group slots and covers present", () => {
    expect(computeSupportReaders(withGroups({}))).toEqual([]);
  });
  it("the same child with a section today → the group teacher and the cover read", () => {
    const r = Object.fromEntries(computeSupportReaders(withGroups({ sectionId: "sec1" })).map((x) => [x.userId, x.via]));
    expect(r).toEqual({ quran: "TEACHING", qcov: "COVER" });
  });
});
