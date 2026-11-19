/**
 * planBookCut — the pure "cut rule" of the book-beside-a-plan tab (.claude/plans/plan-book-tab.md).
 * Every master here is INVENTED (the repo is public).
 */
import { cutChapters, splitStudentChapters, matchKey, normText, type CutChapterInput } from "../modules/book-lifecycle/services/planBookCut";

const J = (...p: string[]) => p.join("\n\n") + "\n\n";

/** After-heading, SCI style: heading, opener picture, review note, teacher note, then the children's text. */
const sciMaster = (): CutChapterInput[] => [
  { key: "front", title: "শুরুর অংশ", text: "# বিজ্ঞান বই\n\nভূমিকা\n\n" },
  {
    key: "ch-001",
    title: "পাঠ ১: গাছ",
    text: J(
      "<!-- bl:ch ch-001 -->\n## পাঠ ১: গাছ",
      "![গাছ](media/tree.jpg)",
      "**পর্যালোচনা-নোট — শুধু পর্যালোচকের জন্য**",
      "পর্যালোচক দেখুন: ছবির মান ঠিক আছে কি না।",
      "**শিক্ষক-নোট — পাঠ ১**",
      "শিক্ষক ক্লাসে প্রথমে গাছের ছবি দেখাবেন এবং প্রশ্ন করবেন।",
      "উত্তর: গাছ মাটি থেকে পানি নেয়।",
      "![মূল](media/root.jpg)",
      "গাছের শিকড় মাটির নিচে থাকে এবং পানি টেনে নেয়।",
      "<!-- editor: keep -->",
      "গাছের পাতা সূর্যের আলো থেকে খাবার তৈরি করে।",
      "|   |   |\n| --- | --- |",
    ),
  },
  {
    key: "ch-002",
    title: "পাঠ ২: ফুল",
    text: J(
      "<!-- bl:ch ch-002 -->\n## পাঠ ২: ফুল",
      "**পর্যালোচনা-নোট —** দ্বিতীয় পাঠের পর্যালোচনা।",
      "**শিক্ষক-নোট —** দ্বিতীয় পাঠে ফুলের নাম বলান।",
      "ফুলের রঙ নানা রকম হয় এবং সুগন্ধ ছড়ায়।",
    ),
  },
];
const sciStudent = [
  "# পাঠ ১: গাছ",
  "গাছের শিকড় মাটির নিচে থাকে এবং পানি টেনে নেয়।",
  "গাছের পাতা সূর্যের আলো থেকে খাবার তৈরি করে।",
  "# পাঠ ২: ফুল",
  "ফুলের রঙ নানা রকম হয় এবং সুগন্ধ ছড়ায়।",
].join("\n");
const sciTitles = (c: CutChapterInput[]) => c.filter((x) => x.key !== "front");

describe("after-heading layout (SCI style, student-edition anchor)", () => {
  const chapters = sciMaster();
  const cut = cutChapters(chapters, splitStudentChapters(sciStudent, sciTitles(chapters)));

  it("drops the review note, keeps the teacher note separate", () => {
    const c = cut.get("ch-001")!;
    expect(c.anchorMissing).toBe(false);
    expect(c.childText).not.toMatch(/পর্যালোচনা|পর্যালোচক/);
    expect(c.teacherNote).not.toMatch(/শিক্ষক-নোট —/); // the fold is titled by the app; the label line is dropped
    expect(c.teacherNote).toMatch(/উত্তর: গাছ মাটি থেকে পানি নেয়/);
    expect(c.teacherNote).not.toMatch(/পর্যালোচনা/);
  });

  it("children's text is first: heading + opener picture, then the text after the note", () => {
    const c = cut.get("ch-001")!;
    expect(c.childText.startsWith("## পাঠ ১: গাছ")).toBe(true);
    expect(c.childText.indexOf("media/tree.jpg")).toBeLessThan(c.childText.indexOf("গাছের শিকড়"));
    expect(c.childText).not.toMatch(/শিক্ষক ক্লাসে/);
  });

  it("backs up over a picture that sits just before the anchor (it belongs to the children)", () => {
    const c = cut.get("ch-001")!;
    expect(c.childText).toMatch(/media\/root\.jpg/);
    expect(c.teacherNote).not.toMatch(/media\/root\.jpg/);
  });

  it("strips comments and a trailing empty table stub", () => {
    const c = cut.get("ch-001")!;
    expect(c.childText).not.toMatch(/<!--|editor: keep|bl:ch/);
    expect(c.childText).not.toMatch(/\|\s*---/);
    expect(c.childText.trim().endsWith("খাবার তৈরি করে।")).toBe(true);
  });

  it("cuts the next chapter the same way", () => {
    const c = cut.get("ch-002")!;
    expect(c.childText).toMatch(/^## পাঠ ২: ফুল/);
    expect(c.childText).toMatch(/ফুলের রঙ নানা রকম/);
    expect(c.teacherNote).toMatch(/ফুলের নাম বলান/);
    expect(c.childText).not.toMatch(/ফুলের নাম বলান|দ্বিতীয় পাঠের পর্যালোচনা/);
  });

  it("does not return the front chapter", () => {
    expect(cut.has("front")).toBe(false);
  });
});

describe("missing student edition → whole chapter minus the review note, flagged", () => {
  it.each([["no edition", null], ["no matching title", new Map<string, string>()], ["no anchor", new Map([["ch-001", normText("সম্পূর্ণ আলাদা লেখা এখানে আছে")]])]])("%s", (_n, student) => {
    const cut = cutChapters(sciMaster(), student as Map<string, string> | null);
    const c = cut.get("ch-001")!;
    expect(c.anchorMissing).toBe(true);
    expect(c.teacherNote).toBeNull();
    expect(c.childText).not.toMatch(/পর্যালোচক দেখুন/);
    expect(c.childText).toMatch(/শিক্ষক-নোট/); // teacher note stays inside, unsplit
    expect(c.childText).toMatch(/গাছের শিকড় মাটির নিচে/);
    expect(c.warnings.length).toBeGreaterThan(0);
  });
});

describe("before-heading layout (BAN style: the pair sits at the tail of the previous chapter)", () => {
  const master: CutChapterInput[] = [
    {
      key: "front",
      title: "শুরুর অংশ",
      text: J("# বাংলা বই", "**পর্যালোচনা-নোট — পাঠ ১ (শুধু পর্যালোচকের জন্য)**", "প্রথম পাঠের পর্যালোচনা।", "**শিক্ষক-নোট — পাঠ ১**", "প্রথম পাঠের শিক্ষক-ভূমিকা।", "উত্তর: পাখি।"),
    },
    {
      key: "ch-001",
      title: "পাঠ ১: পাখি",
      text: J(
        "<!-- bl:ch ch-001 -->\n## পাঠ ১: পাখি",
        "পাখি আকাশে ওড়ে। তারা গান গায়।",
        "পাখির বাসা গাছের ডালে থাকে।",
        "ছোট পাখি খুব মিষ্টি করে ডাকে।",
        "**পর্যালোচনা-নোট — পাঠ ২**",
        "দ্বিতীয় পাঠের পর্যালোচনা।",
        "**শিক্ষক-নোট — পাঠ ২**",
        "দ্বিতীয় পাঠের শিক্ষক-নির্দেশ।",
        "![ছবি](media/p2.jpg)",
      ),
    },
    { key: "ch-002", title: "পাঠ ২: মাছ", text: J("<!-- bl:ch ch-002 -->\n## পাঠ ২: মাছ", "মাছ পানিতে সাঁতার কাটে।") },
  ];
  const cut = cutChapters(master, null); // no edition needed

  it("assigns each pair to the NEXT chapter and needs no edition", () => {
    const c1 = cut.get("ch-001")!;
    expect(c1.anchorMissing).toBe(false);
    expect(c1.teacherNote).toMatch(/প্রথম পাঠের শিক্ষক-ভূমিকা/);
    expect(c1.teacherNote).toMatch(/উত্তর: পাখি/);
    expect(c1.childText).toMatch(/^## পাঠ ১: পাখি/);
    expect(c1.childText).toMatch(/পাখি আকাশে ওড়ে/);
    expect(c1.childText).not.toMatch(/পর্যালোচনা|দ্বিতীয় পাঠ/);
  });

  it("the teacher note runs to the next marker (a picture at the tail stays with the note)", () => {
    const c2 = cut.get("ch-002")!;
    expect(c2.teacherNote).toMatch(/দ্বিতীয় পাঠের শিক্ষক-নির্দেশ/);
    expect(c2.teacherNote).toMatch(/media\/p2\.jpg/);
    expect(c2.childText).toBe("## পাঠ ২: মাছ\n\nমাছ পানিতে সাঁতার কাটে।");
    expect(c2.teacherNote).not.toMatch(/পর্যালোচনা/);
  });
});

describe("ENG form: bare labels and blockquotes", () => {
  const master: CutChapterInput[] = [
    { key: "front", title: "Front", text: "# English Book\n\n" },
    {
      key: "ch-001",
      title: "Unit 1: My Family",
      text: J(
        "<!-- bl:ch ch-001 -->\n## Unit 1: My Family",
        "> **Reviewer note**\n>\n> **Reviewer Note (পর্যালোচনা-নোট) — Unit 1**\n>\n> Check the spelling of the family words.",
        "> **Teacher note**\n>\n> **Teacher Note (শিক্ষক-নোট) — Unit 1**\n>\n> Ask the children to name their family members.",
        "This is my mother. She is kind and she loves me.",
        "This is my father. He works hard every single day.",
      ),
    },
  ];
  const student = "# Unit 1: My Family\nThis is my mother. She is kind and she loves me.\nThis is my father. He works hard every single day.";
  it("drops the quoted review note and the bare labels, splits at the anchor", () => {
    const cut = cutChapters(master, splitStudentChapters(student, [{ key: "ch-001", title: "Unit 1: My Family" }]));
    const c = cut.get("ch-001")!;
    expect(c.anchorMissing).toBe(false);
    expect(c.childText).not.toMatch(/Reviewer|spelling of the family/);
    expect(c.childText).toMatch(/This is my mother/);
    expect(c.teacherNote).toMatch(/Ask the children to name/);
    expect(c.teacherNote).not.toMatch(/^> \*\*Teacher note\*\*$/m);
    expect(c.teacherNote).not.toMatch(/Reviewer/);
  });
});

describe("BGS form: label with the 'reviewer only' tag", () => {
  it("is recognised and cut", () => {
    const master: CutChapterInput[] = [
      { key: "front", title: "শুরু", text: "# বই\n\n" },
      {
        key: "ch-001",
        title: "অধ্যায় ১: দেশ",
        text: J(
          "<!-- bl:ch ch-001 -->\n## অধ্যায় ১: দেশ",
          "**পর্যালোচনা-নোট (শুধু পর্যালোচকের জন্য) — অধ্যায় ১**",
          "গোপন পর্যালোচনা।",
          "**শিক্ষক-নোট — অধ্যায় ১**",
          "শিক্ষক মানচিত্র দেখাবেন।",
          "আমাদের দেশের নাম বাংলাদেশ এবং রাজধানী ঢাকা।",
        ),
      },
    ];
    const student = "# অধ্যায় ১: দেশ\nআমাদের দেশের নাম বাংলাদেশ এবং রাজধানী ঢাকা।";
    const c = cutChapters(master, splitStudentChapters(student, [{ key: "ch-001", title: "অধ্যায় ১: দেশ" }])).get("ch-001")!;
    expect(c.childText).not.toMatch(/গোপন/);
    expect(c.teacherNote).toMatch(/মানচিত্র/);
    expect(c.childText).toMatch(/রাজধানী ঢাকা/);
  });
});

describe("splitStudentChapters", () => {
  it("uses the last occurrence of a title (a contents list comes first) and slices to the next chapter", () => {
    const text = ["# Contents", "Unit 1: A", "Unit 2: B", "# Unit 1: A", "alpha alpha alpha", "# Unit 2: B", "beta beta beta"].join("\n");
    const m = splitStudentChapters(text, [{ key: "a", title: "Unit 1: A" }, { key: "b", title: "Unit 2: B" }]);
    expect(m.get("a")).toContain("alpha alpha alpha");
    expect(m.get("a")).not.toContain("beta");
    expect(m.get("b")).toContain("beta beta beta");
  });
  it("leaves a missing title out", () => {
    expect(splitStudentChapters("# Other\ntext", [{ key: "a", title: "Unit 1: A" }]).has("a")).toBe(false);
  });
});

describe("odd labels", () => {
  it("a second review label is treated as back matter; with no edition the chapter is shown unsplit", () => {
    const master: CutChapterInput[] = [
      { key: "front", title: "f", text: "# b\n\n" },
      { key: "ch-001", title: "পাঠ ১: ক", text: J("<!-- bl:ch ch-001 -->\n## পাঠ ১: ক", "**পর্যালোচনা-নোট — এক**", "ক ক ক ক ক ক ক ক ক ক ক ক", "**শিক্ষক-নোট — এক**", "খ খ", "**পর্যালোচনা-নোট — দুই**", "গ গ গ গ গ গ গ গ গ গ গ গ") },
    ];
    const c = cutChapters(master, null).get("ch-001")!;
    expect(c.anchorMissing).toBe(true);
    expect(c.teacherNote).toBeNull();
    expect(c.warnings.join(" ")).toMatch(/back matter cut|unexpected note labels/);
    expect(c.childText).not.toMatch(/গ গ গ/);
  });
});

describe("student edition split on real-world heading forms", () => {
  it("matches a table-row heading with an em dash in the master title (BN style) and Bangla digits", () => {
    const text = ["| অধ্যায় | বিষয় |", "| ১ | তুলনা করি |", "| অধ্যায় ১ | তুলনা করি |", "ক ক ক ক ক ক ক ক ক ক ক ক", "| অধ্যায় ২ | গণনা |", "খ খ খ খ খ খ খ খ খ খ খ খ"].join("\n");
    const m = splitStudentChapters(text, [{ key: "a", title: "অধ্যায় ১ — তুলনা করি" }, { key: "b", title: "অধ্যায় ২ — গণনা" }]);
    expect(m.get("a")).toContain("ক ক ক");
    expect(m.get("a")).not.toContain("খ খ খ");
    expect(m.get("b")).toContain("খ খ খ");
  });

  it("finds a page-banner heading that contains the title (ENG style) and skips the contents row", () => {
    const text = [
      "| Unit | Title | Lessons |",
      "| 1 | KG Revision: Letters and Words | 6 |",
      "| School for Community Development  ·  Class One  ·  English Unit 1 KG Revision: Letters and Words |",
      "alpha alpha alpha alpha",
      "A  Read. (NCTB Unit 2, Lesson 1)",
      "| School for Community Development  ·  Class One  ·  English Unit 2 Greetings and Classroom Language |",
      "beta beta beta beta",
    ].join("\n");
    const m = splitStudentChapters(text, [{ key: "a", title: "Unit 1 — KG Revision: Letters and Words" }, { key: "b", title: "Unit 2 — Greetings and Classroom Language" }]);
    expect(m.get("a")).toContain("alpha alpha");
    expect(m.get("a")).not.toContain("beta");
    expect(m.get("b")).toContain("beta beta");
  });

  it("falls back to anchor word + number when the full title is not in the docx", () => {
    const text = ["# Unit 1 Hello", "one one one one", "Revision note (NCTB Unit 2, page 3)", "# Unit 2 Different words", "two two two two"].join("\n");
    const m = splitStudentChapters(text, [{ key: "a", title: "Unit 1 — Greetings" }, { key: "b", title: "Unit 2 — Words" }]);
    expect(m.get("a")).toContain("one one");
    expect(m.get("b")).toContain("two two");
  });

  it("matchKey ignores dashes, colons, pipes and digit script", () => {
    expect(matchKey("| অধ্যায় ১ | তুলনা করি |")).toBe(matchKey("অধ্যায় 1 — তুলনা করি"));
  });
});

describe("labels", () => {
  it("ordinary text that merely starts with the label word is not a label", () => {
    const master: CutChapterInput[] = [
      { key: "front", title: "f", text: J("# বই", "শিক্ষক-নোটের নমুনা ফরম ও আবেদনপত্রে নামের জায়গায় লেখা থাকে।", "**পর্যালোচনা-নোট — পাঠ ১**", "রিভিউ লেখা।", "**শিক্ষক-নোট — পাঠ ১**", "শিক্ষক নির্দেশ।") },
      { key: "ch-001", title: "পাঠ ১: ক", text: J("<!-- bl:ch ch-001 -->\n## পাঠ ১: ক", "ক ক ক ক ক ক ক ক ক") },
    ];
    const c = cutChapters(master, null).get("ch-001")!;
    expect(c.teacherNote).toMatch(/শিক্ষক নির্দেশ/);
    expect(c.childText).not.toMatch(/রিভিউ|পর্যালোচনা/);
  });
});

describe("before-heading: stray earlier notes in front", () => {
  it("uses the LAST R,T pair (book-wide notes first, then the chapter's) and drops every review note", () => {
    const master: CutChapterInput[] = [
      {
        key: "front",
        title: "Front",
        text: J("# Book", "> **Reviewer note**", "> **Reviewer Note (পর্যালোচনা-নোট) — whole book**", "book review text", "> **Teacher note**", "> **Teacher Note (শিক্ষক-নোট) — whole book**", "book teacher text", "### Contents", "> **Reviewer note**", "> **Reviewer Note (পর্যালোচনা-নোট) — Unit 1**", "unit one review", "> **Teacher note**", "> **Teacher Note (শিক্ষক-নোট) — Unit 1**", "unit one teacher"),
      },
      { key: "ch-001", title: "Unit 1: At the Library", text: J("<!-- bl:ch ch-001 -->\n## Unit 1: At the Library", "Lesson one text here for children.") },
    ];
    const c = cutChapters(master, null).get("ch-001")!;
    expect(c.teacherNote).toMatch(/unit one teacher/);
    expect(c.teacherNote).not.toMatch(/book teacher|review/i);
    expect(c.childText).toBe("## Unit 1: At the Library\n\nLesson one text here for children.");
  });

  it("a stray earlier review note before the tail pair never leaks", () => {
    const master: CutChapterInput[] = [
      { key: "front", title: "f", text: J("# b", "**পর্যালোচনা-নোট — এক**", "r1", "**শিক্ষক-নোট — এক**", "t1") },
      { key: "ch-001", title: "পাঠ ১: ক", text: J("<!-- bl:ch ch-001 -->\n## পাঠ ১: ক", "**পর্যালোচনা-নোট — স্ট্রে**", "stray review", "ছেলেমেয়েদের লেখা এক।", "ছেলেমেয়েদের লেখা দুই।", "ছেলেমেয়েদের লেখা তিন।", "**পর্যালোচনা-নোট — দুই**", "r2", "**শিক্ষক-নোট — দুই**", "t2") },
      { key: "ch-002", title: "পাঠ ২: খ", text: J("<!-- bl:ch ch-002 -->\n## পাঠ ২: খ", "খ খ খ") },
    ];
    const cut = cutChapters(master, null);
    expect(cut.get("ch-001")!.childText).not.toMatch(/stray review|পর্যালোচনা/);
    expect(cut.get("ch-001")!.childText).not.toMatch(/\br2\b/);
    expect(cut.get("ch-001")!.anchorMissing).toBe(true); // ambiguous shape: shown unsplit, never guessed
  });
});

describe("after-heading: back matter after the last chapter", () => {
  const body = (extra: string[]) => J(
    "<!-- bl:ch ch-001 -->\n## অধ্যায় ১ — প্রযুক্তি",
    "**পর্যালোচনা-নোট — অধ্যায় ১**",
    "চ্যাপ্টার রিভিউ",
    "**শিক্ষক-নোট — অধ্যায় ১**",
    "শিক্ষক চ্যাপ্টার নির্দেশ।",
    "প্রযুক্তি আমাদের জীবন সহজ করে তোলে।",
    "প্রযুক্তির সাহায্যে আমরা দ্রুত কাজ করি।",
    ...extra,
  );
  const student = "# অধ্যায় ১ — প্রযুক্তি\nপ্রযুক্তি আমাদের জীবন সহজ করে তোলে।\nপ্রযুক্তির সাহায্যে আমরা দ্রুত কাজ করি।";
  const run = (extra: string[]) => {
    const master: CutChapterInput[] = [{ key: "front", title: "f", text: "# বই\n\n" }, { key: "ch-001", title: "অধ্যায় ১ — প্রযুক্তি", text: body(extra) }];
    return cutChapters(master, splitStudentChapters(student, [{ key: "ch-001", title: "অধ্যায় ১ — প্রযুক্তি" }])).get("ch-001")!;
  };

  it("a second review note (model tests + glossary with their own pairs) ends the chapter", () => {
    const c = run(["**মডেল টেস্ট ১ — প্রস্তুতি**", "**পর্যালোচনা-নোট — মডেল টেস্ট ১–৩**", "মডেল রিভিউ", "**শিক্ষক-নোট — মডেল টেস্ট ১: উত্তর**", "মডেল উত্তর", "**পর্যালোচনা-নোট — শব্দকোষ**", "শব্দ রিভিউ", "**শিক্ষক-নোট — শব্দকোষ**", "| শব্দ | অর্থ |"]);
    expect(c.anchorMissing).toBe(false);
    expect(c.teacherNote).toMatch(/শিক্ষক চ্যাপ্টার নির্দেশ/);
    expect(c.childText).toMatch(/প্রযুক্তির সাহায্যে/);
    expect(c.childText + (c.teacherNote ?? "")).not.toMatch(/মডেল|শব্দকোষ|পর্যালোচনা|রিভিউ/);
    expect(c.warnings.join(" ")).toMatch(/back matter cut/);
  });

  it("a 'Model Test' heading with only teacher-note answers (RTTTTRT) cuts at the heading", () => {
    const c = run(["**মডেল টেস্ট ১**", "প্রশ্ন ১", "**শিক্ষক-নোট — মডেল টেস্ট ১-এর উত্তর**", "উত্তর ১", "**পর্যালোচনা-নোট — শব্দভান্ডার**", "রিভিউ", "**শিক্ষক-নোট — শব্দভান্ডার**", "শব্দ"]);
    expect(c.anchorMissing).toBe(false);
    expect(c.childText + (c.teacherNote ?? "")).not.toMatch(/মডেল|প্রশ্ন ১|উত্তর ১|পর্যালোচনা|শব্দভান্ডার/);
  });

  it("extra teacher notes inside the chapter (R T T T) are fine and no review note shows", () => {
    const c = run(["**শিক্ষক-নোট — কার্যক্রম ২**", "আরও নির্দেশ"]);
    expect(c.anchorMissing).toBe(false);
    expect(c.childText).not.toMatch(/পর্যালোচনা|চ্যাপ্টার রিভিউ/);
  });
});

describe("review-note leak guards", () => {
  it("a plain 'শিক্ষক-নোট:' / 'Teacher note:' sentence inside a review note is text, not a label", () => {
    const master: CutChapterInput[] = [
      { key: "front", title: "f", text: "# b\n\n" },
      {
        key: "ch-001",
        title: "পাঠ ১: ক",
        text: J(
          "<!-- bl:ch ch-001 -->\n## পাঠ ১: ক",
          "**পর্যালোচনা-নোট — পাঠ ১**",
          "শিক্ষক-নোট: এই অংশে ভুল আছে, পর্যালোচক দেখুন।",
          "Teacher note: reviewer only remark here.",
          "**শিক্ষক-নোট — পাঠ ১**",
          "আসল শিক্ষক নির্দেশ।",
          "শিশুদের জন্য মূল পাঠ্য লেখা এখানে আছে।",
        ),
      },
    ];
    const student = "# পাঠ ১: ক\nশিশুদের জন্য মূল পাঠ্য লেখা এখানে আছে।";
    const c = cutChapters(master, splitStudentChapters(student, [{ key: "ch-001", title: "পাঠ ১: ক" }])).get("ch-001")!;
    expect(c.childText + (c.teacherNote ?? "")).not.toMatch(/ভুল আছে|reviewer only|পর্যালোচক দেখুন/);
    expect(c.teacherNote).toBe("আসল শিক্ষক নির্দেশ।");
    expect(c.childText).toMatch(/শিশুদের জন্য মূল পাঠ্য/);
  });

  it("an UNRECOGNISED review label form never reaches the output (fail-closed guard)", () => {
    const master: CutChapterInput[] = [
      { key: "front", title: "f", text: "# b\n\n" },
      { key: "ch-001", title: "পাঠ ১: ক", text: J("<!-- bl:ch ch-001 -->\n## পাঠ ১: ক", "ক ক ক ক ক ক", "পর্যালোচনা-নোট (প্লেইন, বোল্ড ছাড়া): এটি গোপন।", "গোপন দ্বিতীয় লাইন।", "### শিশুদের অংশ", "খ খ খ খ খ খ") },
    ];
    const c = cutChapters(master, null).get("ch-001")!;
    expect(c.childText).not.toMatch(/গোপন|পর্যালোচনা/);
    expect(c.childText).toMatch(/শিশুদের অংশ/); // removal stops at the next heading
    expect(c.warnings.join(" ")).toMatch(/review-note wording found/);
  });

  it("a chapter without any label is flagged unsplit in an after-heading book", () => {
    const master: CutChapterInput[] = [
      { key: "front", title: "f", text: "# b\n\n" },
      { key: "ch-001", title: "পাঠ ১: ক", text: J("<!-- bl:ch ch-001 -->\n## পাঠ ১: ক", "ক ক ক ক ক ক") },
    ];
    expect(cutChapters(master, null).get("ch-001")!.anchorMissing).toBe(true);
  });
});

describe("inner teacher notes (R T T)", () => {
  const master: CutChapterInput[] = [
    { key: "front", title: "f", text: "# b\n\n" },
    {
      key: "ch-001",
      title: "পাঠ ১: ক",
      text: J(
        "<!-- bl:ch ch-001 -->\n## পাঠ ১: ক",
        "**পর্যালোচনা-নোট — এক**",
        "রিভিউ লেখা",
        "**শিক্ষক-নোট — এক**",
        "প্রথম শিক্ষক নির্দেশ",
        "শিশুদের প্রথম অনুচ্ছেদ এখানে লেখা আছে।",
        "**শিক্ষক-নোট — কার্যক্রম ২**",
        "ভেতরের শিক্ষক নির্দেশ",
        "শিশুদের দ্বিতীয় অনুচ্ছেদ এখানে লেখা আছে।",
      ),
    },
  ];
  const student = "# পাঠ ১: ক\nশিশুদের প্রথম অনুচ্ছেদ এখানে লেখা আছে।\nশিশুদের দ্বিতীয় অনুচ্ছেদ এখানে লেখা আছে।";
  it("moves the inner teacher note into the fold and keeps it out of the children's text", () => {
    const c = cutChapters(master, splitStudentChapters(student, [{ key: "ch-001", title: "পাঠ ১: ক" }])).get("ch-001")!;
    expect(c.anchorMissing).toBe(false);
    expect(c.teacherNote).toMatch(/প্রথম শিক্ষক নির্দেশ/);
    expect(c.teacherNote).toMatch(/কার্যক্রম ২/);
    expect(c.teacherNote).toMatch(/ভেতরের শিক্ষক নির্দেশ/);
    expect(c.childText).not.toMatch(/ভেতরের|কার্যক্রম|নির্দেশ|রিভিউ/);
    expect(c.childText).toMatch(/দ্বিতীয় অনুচ্ছেদ/);
  });
});

describe("layout is decided per pair, not per book", () => {
  it("an after-heading book whose front holds a book-wide R/T does not flip", () => {
    const master: CutChapterInput[] = [
      { key: "front", title: "f", text: J("# বই", "**পর্যালোচনা-নোট — পুরো বই**", "বইয়ের রিভিউ", "**শিক্ষক-নোট — পুরো বই**", "বইয়ের শিক্ষক-ভূমিকা") },
      { key: "ch-001", title: "পাঠ ১: ক", text: J("<!-- bl:ch ch-001 -->\n## পাঠ ১: ক", "**পর্যালোচনা-নোট — এক**", "রিভিউ এক", "**শিক্ষক-নোট — এক**", "শিক্ষক এক", "শিশুদের পাঠ এক এখানে আছে।") },
      { key: "ch-002", title: "পাঠ ২: খ", text: J("<!-- bl:ch ch-002 -->\n## পাঠ ২: খ", "**পর্যালোচনা-নোট — দুই**", "রিভিউ দুই", "**শিক্ষক-নোট — দুই**", "শিক্ষক দুই", "শিশুদের পাঠ দুই এখানে আছে।") },
    ];
    const student = "# পাঠ ১: ক\nশিশুদের পাঠ এক এখানে আছে।\n# পাঠ ২: খ\nশিশুদের পাঠ দুই এখানে আছে।";
    const cut = cutChapters(master, splitStudentChapters(student, master.slice(1)));
    expect(cut.get("ch-001")!.teacherNote).toBe("শিক্ষক এক");
    expect(cut.get("ch-001")!.childText).toMatch(/শিশুদের পাঠ এক/);
    expect(cut.get("ch-002")!.teacherNote).toBe("শিক্ষক দুই");
    expect(cut.get("ch-002")!.childText).toMatch(/শিশুদের পাঠ দুই/);
    for (const c of cut.values()) expect(c.childText + (c.teacherNote ?? "")).not.toMatch(/বইয়ের|রিভিউ/);
  });

  it("a before-heading tail of R,T,T still splits (all teacher notes go to the fold)", () => {
    const master: CutChapterInput[] = [
      { key: "front", title: "f", text: J("# b", "**পর্যালোচনা-নোট — এক**", "রিভিউ", "**শিক্ষক-নোট — এক**", "শিক্ষক এক", "**শিক্ষক-নোট — আরও**", "শিক্ষক আরও") },
      { key: "ch-001", title: "পাঠ ১: ক", text: J("<!-- bl:ch ch-001 -->\n## পাঠ ১: ক", "এক", "দুই", "তিন", "চার") },
    ];
    const c = cutChapters(master, null).get("ch-001")!;
    expect(c.teacherNote).toMatch(/শিক্ষক এক/);
    expect(c.teacherNote).toMatch(/শিক্ষক আরও/);
    expect(c.childText).toBe("## পাঠ ১: ক\n\nএক\n\nদুই\n\nতিন\n\nচার");
  });
});

describe("back matter in a before-heading book", () => {
  it("cuts a model test (with its inline teacher answers) out of the last chapter's children's text", () => {
    const master: CutChapterInput[] = [
      { key: "front", title: "f", text: J("# b", "**পর্যালোচনা-নোট — এক**", "রিভিউ", "**শিক্ষক-নোট — এক**", "শিক্ষক এক") },
      { key: "ch-001", title: "পাঠ ১: ক", text: J("<!-- bl:ch ch-001 -->\n## পাঠ ১: ক", "এক", "দুই", "তিন", "**মডেল টেস্ট ১**", "প্রশ্ন ১", "**শিক্ষক-নোট — মডেল টেস্ট ১-এর উত্তর**", "উত্তর ১") },
    ];
    const c = cutChapters(master, null).get("ch-001")!;
    expect(c.childText).toBe("## পাঠ ১: ক\n\nএক\n\nদুই\n\nতিন");
    expect(c.warnings.join(" ")).toMatch(/back matter \(model test\)/);
  });
});

describe("NFC", () => {
  it("matches a title whose য় is decomposed (ya + nukta) against the precomposed form", () => {
    const precomposed = "অধ্যা\u09DF ১ — নদী";
    const decomposed = "অধ্যা\u09AF\u09BC ১ — নদী";
    expect(matchKey(decomposed)).toBe(matchKey(precomposed));
    const m = splitStudentChapters(["# " + decomposed, "লেখা লেখা লেখা"].join("\n"), [{ key: "a", title: precomposed }]);
    expect(m.get("a")).toContain("লেখা");
    const m2 = splitStudentChapters(["# অধ্যা\u09AF\u09BC ৩ অন্য", "লেখা লেখা"].join("\n"), [{ key: "a", title: "অধ্যা\u09DF ৩ — আলাদা শিরোনাম" }]);
    expect(m2.get("a")).toContain("লেখা"); // anchor word + number fallback
  });
});
