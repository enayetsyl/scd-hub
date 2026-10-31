import {
  hifzMark,
  checkItemMarks,
  checkHifzCounts,
  itemsFullMarks,
  placeForMove,
  sectionDeductionMark,
  toMin,
  fromMin,
} from "../modules/quran-exam/services/quranExamMath";

const hifz = {
  scheme: "HIFZ_DEDUCTION" as const,
  fullMarks: 30,
  sections: [],
  hifz: { paras: [1, 2, 3, 4, 5], tanbihPerMark: 4, fathCost: 2 },
};

const ammapara = {
  scheme: "ITEMS" as const,
  fullMarks: 90,
  sections: [
    { title: "হিফজ", items: [5, 5, 5, 5].map((m, i) => ({ label: `h${i}`, marks: m })) },
    { title: "রিডিং", items: [15, 15, 15, 15].map((m, i) => ({ label: `r${i}`, marks: m })) },
    { title: "দোয়া", items: [2, 2, 2, 2, 2].map((m, i) => ({ label: `d${i}`, marks: m })) },
  ],
};

describe("Quran exam marking (D-#874)", () => {
  it("counts তানবীহ across all paras together: 3 + 2 = 5 → −1", () => {
    const r = hifzMark(hifz, [
      { para: 1, tanbih: 3, fath: 0 },
      { para: 2, tanbih: 2, fath: 0 },
    ]);
    expect(r).toMatchObject({ tanbih: 5, tanbihCut: 1, fathCut: 0, mark: 29 });
  });

  it("each ফাত্হ costs 2; the mockup sample gives 21", () => {
    const r = hifzMark(hifz, [
      { para: 1, tanbih: 3, fath: 1 },
      { para: 2, tanbih: 2, fath: 0 },
      { para: 3, tanbih: 4, fath: 1 },
      { para: 4, tanbih: 1, fath: 0 },
      { para: 5, tanbih: 2, fath: 1 },
    ]);
    expect(r).toMatchObject({ tanbih: 12, fath: 3, tanbihCut: 3, fathCut: 6, mark: 21 });
  });

  it("never goes below 0", () => {
    expect(hifzMark(hifz, [{ para: 1, tanbih: 40, fath: 20 }]).mark).toBe(0);
  });

  it("an ITEMS paper totals its questions and checks each mark's range", () => {
    expect(itemsFullMarks(ammapara)).toBe(90);
    const ok = [[5, 5, 4, 5], [14, 13, 15, 12], [2, 2, 1, 2, 2]];
    expect(checkItemMarks(ammapara, ok)).toBe(82);
    expect(() => checkItemMarks(ammapara, [[6, 5, 4, 5], ok[1], ok[2]])).toThrow(/০ থেকে 5/);
    expect(() => checkItemMarks(ammapara, [ok[0], ok[1]])).toThrow(/মেলেনি/);
    expect(() => checkItemMarks(ammapara, [[5, 5, 4], ok[1], ok[2]])).toThrow(/মেলেনি/);
  });

  it("Hifz counts must cover exactly the sitting's paras", () => {
    expect(checkHifzCounts([4, 5], [{ para: 5, tanbih: 2, fath: 1 }, { para: 4, tanbih: 1, fath: 0 }]).map((c) => c.para)).toEqual([4, 5]);
    expect(() => checkHifzCounts([4, 5], [{ para: 4, tanbih: 1, fath: 0 }])).toThrow(/পারা 5/);
    expect(() => checkHifzCounts([4, 5], [{ para: 3, tanbih: 1, fath: 0 }])).toThrow(/পারা 3/);
  });
});

describe("Moving a sitting to another examiner (D-#875)", () => {
  it("keeps the time when the new examiner is free then", () => {
    const r = placeForMove({ start: "08:30", end: "09:00" }, [{ start: "07:00", end: "07:30" }]);
    expect(r).toEqual({ start: "08:30", end: "09:00", kept: true });
  });

  it("an examiner with no sittings keeps the student's time", () => {
    expect(placeForMove({ start: "08:30", end: "09:00" }, [])).toMatchObject({ start: "08:30", kept: true });
  });

  it("otherwise takes the next free slot after their last sitting, same length", () => {
    const busy = ["07:00", "07:30", "08:00", "08:30"].map((s) => ({ start: s, end: fromMin(toMin(s) + 30) }));
    expect(placeForMove({ start: "08:30", end: "09:00" }, busy)).toEqual({ start: "09:00", end: "09:30", kept: false });
  });

  it("a 2-hour Hifz sitting onto a busy examiner lands after their sitting", () => {
    const r = placeForMove({ start: "07:00", end: "09:00" }, [{ start: "07:00", end: "09:00" }]);
    expect(r).toEqual({ start: "09:00", end: "11:00", kept: false });
  });
});

describe("Section marked the Hifz way (D-#881)", () => {
  it("Nazera দ্বোহা–নাস: 30 − floor(T/4) − 2F, never below 0", () => {
    const rule = { tanbihPerMark: 4, fathCost: 2 };
    expect(sectionDeductionMark(30, rule, 0, 0)).toBe(30);
    expect(sectionDeductionMark(30, rule, 5, 2)).toBe(25);
    expect(sectionDeductionMark(30, rule, 3, 0)).toBe(30);
    expect(sectionDeductionMark(30, rule, 40, 20)).toBe(0);
  });
});
