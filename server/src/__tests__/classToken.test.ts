/**
 * The class segment of a minted tracker id (HW_ID / AS_ID / CT_ID / TOP code).
 *
 * Classes 1–5 are `C1`..`C5`; the two pre-primary levels are LETTERED, `CN` and
 * `CK`, because their numeric levels (-1 and 0) minted `AS-C-1-BAN-0007` — a `-`
 * inside a `-`-delimited id — and `AS-C0-BAN-0007`, which a teacher read as
 * Nursery rather than KG on a real guardian claim.
 *
 * The half that matters most here is the LEGACY half: ids minted before the
 * change are printed on paper forms, quoted by guardians and stored on thousands
 * of prod rows. Every parser must keep resolving them, so each case below is
 * asserted in both spellings.
 */
import { classToken, parseClassToken, CLASS_TOKEN_PATTERN } from "@scd/shared";

describe("classToken / parseClassToken", () => {
  test("classes 1–5 are unchanged", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(classToken(n)).toBe(`C${n}`);
      expect(parseClassToken(`C${n}`)).toBe(n);
    }
  });

  test("pre-primary mints letters, never a signed number", () => {
    expect(classToken(0)).toBe("CK");
    expect(classToken(-1)).toBe("CN");
    // The bug that started this: no minted token may contain a second dash.
    expect(classToken(-1)).not.toContain("-");
  });

  test("parse accepts BOTH spellings — legacy ids must never stop resolving", () => {
    expect(parseClassToken("CK")).toBe(0);
    expect(parseClassToken("C0")).toBe(0);
    expect(parseClassToken("CN")).toBe(-1);
    expect(parseClassToken("C-1")).toBe(-1);
  });

  test("round-trips every roster level", () => {
    for (const n of [-1, 0, 1, 2, 3, 4, 5]) {
      expect(parseClassToken(classToken(n))).toBe(n);
    }
  });

  test("returns null for things that are not class tokens", () => {
    for (const s of ["", "C", "CX", "BAN", "K", "N", "0", "C1B"]) {
      expect(parseClassToken(s)).toBeNull();
    }
  });
});

describe("CLASS_TOKEN_PATTERN", () => {
  const anchored = new RegExp(`^${CLASS_TOKEN_PATTERN}$`);

  test("matches exactly what parseClassToken accepts", () => {
    for (const s of ["C1", "C5", "CK", "CN", "C0", "C-1"]) {
      expect(anchored.test(s)).toBe(true);
      expect(parseClassToken(s)).not.toBeNull();
    }
    for (const s of ["CX", "K", "BAN", "C"]) {
      expect(anchored.test(s)).toBe(false);
      expect(parseClassToken(s)).toBeNull();
    }
  });

  test("embeds in a full id regex in both spellings", () => {
    const hwId = new RegExp(`^HW-${CLASS_TOKEN_PATTERN}-([A-Z]+)-(\\d{4})$`);
    expect(hwId.exec("HW-CK-BAN-0007")?.[2]).toBe("BAN");
    expect(hwId.exec("HW-C0-BAN-0007")?.[2]).toBe("BAN"); // legacy
    expect(hwId.exec("HW-CN-MATH-0001")?.[2]).toBe("MATH");
    expect(hwId.exec("HW-C-1-MATH-0001")?.[2]).toBe("MATH"); // legacy
    expect(hwId.exec("HW-C3-ENG-0042")?.[2]).toBe("ENG");
  });

  test("the class level survives the round trip out of a full id", () => {
    const hwId = new RegExp(`^HW-${CLASS_TOKEN_PATTERN}-([A-Z]+)-(\\d{4})$`);
    expect(parseClassToken(`C${hwId.exec("HW-CK-BAN-0007")![1]}`)).toBe(0);
    expect(parseClassToken(`C${hwId.exec("HW-C-1-MATH-0001")![1]}`)).toBe(-1);
  });
});
