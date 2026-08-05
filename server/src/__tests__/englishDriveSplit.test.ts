/**
 * Block splitter tests (D-#455, ED-5) — one authored block file → its sheets.
 *
 * Seams    — sheets are CUT at the master's own document codes; the answer key's
 *            per-sheet sub-headings must NOT shatter it into fake worksheets, a
 *            `#` inside a fenced board-work block is not a heading, and the
 *            `# Worksheets` divider is not a sheet.
 * Fidelity — every numbered item of a sheet survives the cut, verbatim; no answer
 *            key text leaks into a student sheet.
 * Format   — school header on, `*(8 items, 2 marks each)*` → `[16]`, teacher-only
 *            trailer off, document code signed at the foot.
 * AI       — the LLM never writes an item: with no provider the split still yields
 *            every sheet, a provider that throws degrades to the slice with a
 *            warning, and a tidy that changes the numbered items is DISCARDED.
 *
 * DB-free and network-free (repo convention): the provider is a stub.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  classifyHeading,
  deriveBlockTitle,
  normaliseMarkTags,
  numberedItems,
  sameNumberedItems,
  sheetCode,
  sliceSections,
  splitEnglishDriveBlock,
  teacherSheetSource,
} from "../modules/english-drive/services/BlockSplitService";
import { stripCodeFence, type ChatProvider } from "../modules/english-drive/services/OpenRouterProvider";

const MASTER = readFileSync(join(__dirname, "fixtures", "englishDriveBlock.md"), "utf8");

const split = (over: Partial<Parameters<typeof splitEnglishDriveBlock>[0]> = {}) =>
  splitEnglishDriveBlock({
    classLevel: 5,
    blockNumber: 5,
    version: 1,
    contentMd: MASTER,
    // Explicit null = "no provider" and never reads the environment, so the suite
    // cannot start making network calls on a machine that has a key configured.
    provider: null,
    ...over,
  });

/** A provider that echoes a canned reply — no network, no key. */
const stubProvider = (reply: string | ((user: string) => string)): ChatProvider => ({
  model: "stub/model",
  complete: async ({ user }) => (typeof reply === "function" ? reply(user) : reply),
});

describe("block splitter — seam detection", () => {
  it("classifies the master's sheet headings and ignores its dividers", () => {
    expect(classifyHeading("CW-1 · `C5B05-CW1` — Plurals")).toEqual({ kind: "CW", seq: 1 });
    expect(classifyHeading("Performance Test (Thursday) · `C5B05-PT`")).toEqual({ kind: "PT", seq: null });
    expect(classifyHeading("Consolidated Answer Key · `C5B05-AK`")).toEqual({ kind: "AK", seq: null });
    expect(classifyHeading("Assignment · `C5B05-AS`")).toEqual({ kind: "AS", seq: null });
    // Dividers and lesson headings are not sheets.
    expect(classifyHeading("Worksheets")).toBeNull();
    expect(classifyHeading("Class 1 (Sunday) — Plurals: making more than one")).toBeNull();
    expect(classifyHeading("Step 6 — CW-1 (33 min)")).toBeNull();
    expect(classifyHeading("The Countability Chart — `C5B05-CC`")).toBeNull();
    expect(classifyHeading("Teacher checklist")).toBeNull();
  });

  it("does not read a `#` line inside a fenced board-work block as a heading", () => {
    const { sections } = sliceSections(MASTER);
    // The fence in Class 1 Step 1 contains "# not a heading — this is board work".
    expect(sections.some((s) => s.heading.includes("board work"))).toBe(false);
  });

  it("keeps the answer key whole instead of shattering it into fake worksheets", async () => {
    const { sheets } = await split();
    // Four worksheets in the fixture, not eight — the AK's `### CW-1` sub-headings
    // are nested inside the key and must not open new sheets.
    expect(sheets.filter((s) => s.kind === "CW")).toHaveLength(2);
    expect(sheets.filter((s) => s.kind === "HW")).toHaveLength(2);
    expect(sheets.filter((s) => s.kind === "AK")).toHaveLength(1);
    const ak = sheets.find((s) => s.kind === "AK")!;
    // The whole key, every sub-section of it.
    expect(ak.contentMd).toContain("CW-1 — Plurals");
    expect(ak.contentMd).toContain("HW-2 — Countable / Uncountable");
    expect(ak.contentMd).toContain("PT — ");
    // …and nothing from the section that FOLLOWS the key.
    expect(ak.contentMd).not.toContain("Bloom ladder");
    expect(ak.contentMd).not.toContain("Version log");
  });

  it("skips a section the master declares but has not built yet", async () => {
    const { sheets, warnings } = await split();
    expect(sheets.some((s) => s.kind === "AS")).toBe(false);
    expect(warnings.join(" ")).toContain("Assignment");
  });

  it("emits the sheets in library order", async () => {
    const { sheets } = await split();
    expect(sheets.map((s) => `${s.kind}${s.seq}`)).toEqual([
      "TN1",
      "CW1",
      "CW2",
      "HW1",
      "HW2",
      "PT1",
      "AK1",
    ]);
  });
});

describe("block splitter — sheet fidelity", () => {
  it("carries every numbered item of a sheet through the cut, verbatim", async () => {
    const { sheets } = await split();
    const cw1 = sheets.find((s) => s.kind === "CW" && s.seq === 1)!;
    // Part A's ten + Part B's eight, in order.
    expect(numberedItems(cw1.contentMd)).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18"],
    );
    expect(cw1.contentMd).toContain("8. library → ______________");
    expect(cw1.contentMd).toContain("14. child → ______________ **Rule:** ______________");
  });

  it("never leaks answer-key text into a student sheet", async () => {
    const { sheets } = await split();
    for (const sheet of sheets.filter((s) => s.kind === "CW" || s.kind === "HW" || s.kind === "PT")) {
      expect(sheet.contentMd).not.toContain("Consolidated Answer Key");
      expect(sheet.contentMd).not.toContain("consonant + y → -ies · 13 days");
    }
  });

  it("keeps the PT's teacher instructions off the student's paper", async () => {
    const { sheets } = await split();
    const pt = sheets.find((s) => s.kind === "PT")!;
    expect(pt.contentMd).toContain("Part A — Spelling and Dictation");
    // The dictation words are the answers — teacher side only.
    expect(pt.contentMd).not.toContain("PT teacher instructions");
    expect(pt.contentMd).not.toContain("cyclone · museum · announcement");
    // …and they land on the delivery sheet instead.
    const tn = sheets.find((s) => s.kind === "TN")!;
    expect(tn.contentMd).toContain("cyclone · museum · announcement");
  });

  it("gives a PT its own block coverage and leaves the others block-scoped", async () => {
    const { sheets } = await split();
    expect(sheets.find((s) => s.kind === "PT")!.blockNumbers).toEqual([5]);
    expect(sheets.find((s) => s.kind === "CW")!.blockNumbers).toEqual([]);
  });
});

describe("block splitter — sheet formatting", () => {
  it("prints the school header, the mark tags and the document code", async () => {
    const { sheets } = await split();
    const cw1 = sheets.find((s) => s.kind === "CW" && s.seq === 1)!;
    expect(cw1.contentMd.startsWith("SCHOOL FOR COMMUNITY DEVELOPMENT")).toBe(true);
    expect(cw1.contentMd).toContain("Class 5 - English Grammar Campaign");
    expect(cw1.contentMd).toContain("Block 05: Countability (Classwork — Day 1)");
    expect(cw1.contentMd).toContain("Name- _______________________  Date- _______________________");
    // 8 items × 2 marks = [16]; 10 items × 1 mark = [10].
    expect(cw1.contentMd).toContain("[10]");
    expect(cw1.contentMd).toContain("[16]");
    // The teacher-only trailer and the master's own name line are gone.
    expect(cw1.contentMd).not.toContain("Total: 18 items");
    expect(cw1.contentMd).not.toContain("**Name:**");
    expect(cw1.contentMd.trim().endsWith("*C5B05-CW1*")).toBe(true);
  });

  it("computes the mark tag from items × marks", () => {
    expect(normaliseMarkTags("**Part B — …** *(8 items, 2 marks each)*")).toBe("**Part B — …** [16]");
    expect(normaliseMarkTags("**Part A — …** *(10 items, 1 mark each)*")).toBe("**Part A — …** [10]");
    expect(normaliseMarkTags("**Part A — Spelling.** *(10 marks)*")).toBe("**Part A — Spelling.** [10]");
  });

  it("names the sheets from the master's own title", () => {
    expect(deriveBlockTitle(MASTER)).toBe("Countability");
    expect(sheetCode(5, 5, "CW", 1)).toBe("C5B05-CW1");
    expect(sheetCode(5, 5, "PT", 1)).toBe("C5B05-PT");
    expect(sheetCode(1, 12, "AK", 1)).toBe("C1B12-AK");
  });

  it("suggests upload filenames the existing parser reads back", async () => {
    const { sheets } = await split();
    expect(sheets.map((s) => s.filename)).toContain("C5_ENG_B05_CW2_v1.md");
    expect(sheets.map((s) => s.filename)).toContain("C5_ENG_B05_PT_v1.md");
    expect(sheets.map((s) => s.filename)).toContain("C5_ENG_B05_TN_v1.md");
  });
});

describe("block splitter — the teacher delivery sheet", () => {
  it("keeps the day scripts and drops the worksheets and the build metadata", () => {
    const tn = teacherSheetSource(MASTER);
    expect(tn).toContain("Class 1 (Sunday)");
    expect(tn).toContain("Teacher checklist");
    expect(tn).toContain("CAN I COUNT IT?");
    // Worksheets, key and build metadata all belong elsewhere.
    expect(tn).not.toContain("C5B05-CW1");
    expect(tn).not.toContain("Consolidated Answer Key");
    expect(tn).not.toContain("Provenance & build-against references");
    expect(tn).not.toContain("Build verification");
    expect(tn).not.toContain("Version log");
    expect(tn).not.toContain("Dependency flags");
    expect(tn).not.toContain("Bloom ladder");
    expect(tn).not.toContain("Grammar Exemplars");
    // The marking rubric is teaching material, not build metadata — it stays.
    expect(tn).toContain("Self-construction rubric");
    // The `# Worksheets` divider announced sections that are no longer there.
    expect(tn).not.toMatch(/^#\s+Worksheets$/m);
  });
});

describe("block splitter — the AI is an improvement, never a dependency", () => {
  it("produces every sheet with no provider configured, and says so", async () => {
    const { sheets, model, warnings } = await split();
    expect(sheets).toHaveLength(7);
    expect(model).toBeNull();
    expect(sheets.every((s) => s.polished === false)).toBe(true);
    expect(warnings.join(" ")).toContain("OPENROUTER_API_KEY");
  });

  it("makes no call at all when polish is off", async () => {
    const complete = jest.fn();
    await split({ polish: false, provider: { model: "stub/model", complete } });
    expect(complete).not.toHaveBeenCalled();
  });

  it("degrades to the deterministic slice when the provider throws", async () => {
    const provider: ChatProvider = {
      model: "stub/model",
      complete: async () => {
        throw new Error("OpenRouter rate limit reached (429)");
      },
    };
    const { sheets, warnings } = await split({ provider });
    expect(sheets).toHaveLength(7);
    expect(sheets.every((s) => s.polished === false)).toBe(true);
    expect(warnings.join(" ")).toContain("429");
    // The items are still all there — nothing was lost to the failure.
    const cw1 = sheets.find((s) => s.kind === "CW" && s.seq === 1)!;
    expect(numberedItems(cw1.contentMd)).toHaveLength(18);
  });

  it("DISCARDS a tidy that changes the numbered items", async () => {
    // The failure that would otherwise reach a child's desk: an item quietly dropped.
    const provider = stubProvider((user) =>
      user.includes("Teacher Delivery Sheet")
        ? "# Class 5 English — Block 05: Countability — Teacher Delivery Sheet"
        : "SCHOOL FOR COMMUNITY DEVELOPMENT\n\n1. flower → ______\n2. bus → ______\n\n*C5B05-CW1*",
    );
    const { sheets, warnings } = await split({ provider });
    const cw1 = sheets.find((s) => s.kind === "CW" && s.seq === 1)!;
    expect(cw1.polished).toBe(false);
    expect(numberedItems(cw1.contentMd)).toHaveLength(18);
    expect(warnings.join(" ")).toContain("C5_ENG_B05_CW1_v1.md");
  });

  it("accepts a tidy that preserves every item, and reports the model", async () => {
    const provider = stubProvider((user) => {
      if (user.includes("Teacher Delivery Sheet")) {
        return "# Class 5 English — Block 05: Countability — Teacher Delivery Sheet\n\n## Learning outcomes\n\n- Form regular plurals.";
      }
      // Echo the sheet back with one formatting change and no item change.
      const sheet = user.slice(user.indexOf("--- SHEET ---") + "--- SHEET ---".length).trim();
      return sheet.replace("SCHOOL FOR COMMUNITY DEVELOPMENT", "SCHOOL FOR COMMUNITY DEVELOPMENT");
    });
    const { sheets, model } = await split({ provider });
    expect(model).toBe("stub/model");
    const tn = sheets.find((s) => s.kind === "TN")!;
    expect(tn.polished).toBe(true);
    expect(tn.contentMd).toContain("## Learning outcomes");
    // The day scripts are still appended verbatim under the generated front matter.
    expect(tn.contentMd).toContain("Class 1 (Sunday)");
    expect(sheets.find((s) => s.kind === "CW" && s.seq === 1)!.polished).toBe(true);
  });

  it("refuses front matter that came back as a whole-document rewrite", async () => {
    const provider = stubProvider((user) =>
      user.includes("Teacher Delivery Sheet") ? `# Title\n${"x".repeat(5000)}` : "no",
    );
    const { sheets, warnings } = await split({ provider });
    const tn = sheets.find((s) => s.kind === "TN")!;
    expect(tn.polished).toBe(false);
    expect(tn.contentMd).toContain("Teacher Delivery Sheet");
    expect(warnings.join(" ")).toContain("শিক্ষক শীটের শুরুর অংশ");
  });
});

describe("block splitter — guards", () => {
  it("rejects a file with no sheets in it", async () => {
    await expect(split({ contentMd: "# Just a note\n\nNothing to split here." })).rejects.toThrow(
      /শীট পাওয়া যায়নি/,
    );
  });

  it("rejects an out-of-range class and an empty file", async () => {
    await expect(split({ classLevel: 9 })).rejects.toThrow(/শ্রেণি/);
    await expect(split({ contentMd: "   " })).rejects.toThrow(/খালি/);
  });

  it("compares numbered items by number and order", () => {
    expect(sameNumberedItems("1. a\n2. b", "1. a\n2. b!")).toBe(true);
    expect(sameNumberedItems("1. a\n2. b", "1. a")).toBe(false);
    expect(sameNumberedItems("1. a\n2. b", "2. b\n1. a")).toBe(false);
  });

  it("unwraps a whole-reply code fence but leaves inner fences alone", () => {
    expect(stripCodeFence("```markdown\n# Hi\n```")).toBe("# Hi");
    expect(stripCodeFence("# Hi\n\n```\nboard work\n```\n\nmore")).toContain("board work");
  });
});
