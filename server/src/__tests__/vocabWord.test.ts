/**
 * VC-1 — vocabulary word-bank CRUD + validators + the data-driven program/direction
 * model (prd-vocabulary-tracker §3, D-#104/#105/#126). Pure validators exercised
 * directly; the service runs against mocked models (DB-free, the repo convention).
 */
import mongoose from "mongoose";
import {
  VOCAB_PROGRAMS,
  VOCAB_DIRECTIONS,
  VOCAB_PROGRAM_DIRECTIONS,
  VOCAB_DICTATION_FIELDS,
} from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

// --- model + dependency mocks ---------------------------------------------
const mockCreate = jest.fn();
const mockFindById = jest.fn();
const mockFind = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

/** A find()-chain stub: .sort() returns self, .lean() resolves the value. */
const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

jest.mock("../modules/vocab/models/VocabWord", () => ({
  VocabWord: {
    create: (d: unknown) => mockCreate(d),
    findById: (id: unknown) => mockFindById(id),
    find: (q: unknown) => mockFind(q),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import {
  addVocabWord,
  editVocabWord,
  setVocabWordActive,
  listVocabWords,
  assertProgram,
  assertClassLevel,
  cleanField,
  VocabError,
} from "../modules/vocab/services/VocabWordService";

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// The data-driven trilingual model (D-#105)
// ---------------------------------------------------------------------------

describe("VC-1 program/direction model (D-#105)", () => {
  test("three programs, three directions", () => {
    expect([...VOCAB_PROGRAMS]).toEqual(["ENGLISH", "BANGLA", "ARABIC"]);
    expect([...VOCAB_DIRECTIONS]).toEqual(["DICTATION", "HEADWORD_TO_BANGLA", "BANGLA_TO_HEADWORD"]);
  });

  test("every program declares DICTATION and only real directions", () => {
    for (const p of VOCAB_PROGRAMS) {
      expect(VOCAB_PROGRAM_DIRECTIONS[p]).toContain("DICTATION");
      for (const d of VOCAB_PROGRAM_DIRECTIONS[p]) {
        expect(VOCAB_DIRECTIONS).toContain(d);
      }
    }
  });

  test("dictation field counts: ENGLISH/ARABIC = 2, BANGLA = 1 (§3.1)", () => {
    expect(VOCAB_DICTATION_FIELDS.ENGLISH).toBe(2);
    expect(VOCAB_DICTATION_FIELDS.ARABIC).toBe(2);
    expect(VOCAB_DICTATION_FIELDS.BANGLA).toBe(1);
  });

  test("BANGLA omits the reverse meaning direction", () => {
    expect([...VOCAB_PROGRAM_DIRECTIONS.BANGLA]).toEqual(["DICTATION", "HEADWORD_TO_BANGLA"]);
    expect(VOCAB_PROGRAM_DIRECTIONS.BANGLA).not.toContain("BANGLA_TO_HEADWORD");
  });
});

// ---------------------------------------------------------------------------
// Pure validators
// ---------------------------------------------------------------------------

describe("VC-1 validators", () => {
  test("assertProgram accepts a known program, rejects junk", () => {
    expect(assertProgram("ENGLISH")).toBe("ENGLISH");
    expect(() => assertProgram("KLINGON")).toThrow(VocabError);
  });

  test("assertClassLevel accepts roster levels incl. KG/Nursery, rejects others", () => {
    expect(assertClassLevel(3)).toBe(3);
    expect(assertClassLevel(0)).toBe(0); // KG
    expect(assertClassLevel(-1)).toBe(-1); // Nursery
    expect(() => assertClassLevel(6)).toThrow(VocabError);
    expect(() => assertClassLevel(99)).toThrow(VocabError);
  });

  test("cleanField trims and rejects empty/whitespace", () => {
    expect(cleanField("  cat  ", "headword")).toBe("cat");
    expect(() => cleanField("   ", "headword")).toThrow(/headword/);
    expect(() => cleanField("", "banglaMeaning")).toThrow(/banglaMeaning/);
  });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("addVocabWord", () => {
  test("creates a trimmed active word + audits VOCAB_WORD_ADDED", async () => {
    const id = oid();
    mockCreate.mockResolvedValue({ _id: id, program: "ENGLISH", classLevel: 3, headword: "cat" });
    const actorId = oid().toString();

    const w = await addVocabWord({
      program: "ENGLISH",
      classLevel: 3,
      headword: "  cat ",
      banglaMeaning: " বিড়াল ",
      actorId,
    });

    expect(w._id).toBe(id);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ program: "ENGLISH", classLevel: 3, headword: "cat", banglaMeaning: "বিড়াল", active: true }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "VOCAB_WORD_ADDED", actorId }),
    );
  });

  test("rejects an unknown program before touching the DB", async () => {
    await expect(
      addVocabWord({ program: "FRENCH", classLevel: 3, headword: "x", banglaMeaning: "y", actorId: oid().toString() }),
    ).rejects.toThrow(VocabError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("rejects an empty headword", async () => {
    await expect(
      addVocabWord({ program: "ARABIC", classLevel: 2, headword: "   ", banglaMeaning: "y", actorId: oid().toString() }),
    ).rejects.toThrow(VocabError);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("editVocabWord", () => {
  /** A fake mongoose doc with set/save. */
  const fakeDoc = (over: Record<string, unknown> = {}) => {
    const doc: Record<string, unknown> = {
      _id: oid(),
      program: "ENGLISH",
      classLevel: 3,
      headword: "old",
      banglaMeaning: "পুরনো",
      active: true,
      set(patch: Record<string, unknown>) {
        Object.assign(doc, patch);
      },
      save: jest.fn().mockResolvedValue(undefined),
      ...over,
    };
    return doc;
  };

  test("patches provided fields, stamps updatedBy, audits VOCAB_WORD_UPDATED", async () => {
    const doc = fakeDoc();
    mockFindById.mockResolvedValue(doc);
    const actorId = oid().toString();

    await editVocabWord({ wordId: doc._id as string, headword: " new ", actorId });

    expect(doc.headword).toBe("new");
    expect(doc.banglaMeaning).toBe("পুরনো"); // untouched
    expect((doc.save as jest.Mock)).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "VOCAB_WORD_UPDATED", actorId }),
    );
  });

  test("throws when nothing to edit", async () => {
    mockFindById.mockResolvedValue(fakeDoc());
    await expect(editVocabWord({ wordId: oid().toString(), actorId: oid().toString() })).rejects.toThrow(/Nothing to edit/);
  });

  test("throws when the word is missing", async () => {
    mockFindById.mockResolvedValue(null);
    await expect(
      editVocabWord({ wordId: oid().toString(), headword: "x", actorId: oid().toString() }),
    ).rejects.toThrow(/not found/);
  });

  test("rejects an empty headword edit", async () => {
    mockFindById.mockResolvedValue(fakeDoc());
    await expect(
      editVocabWord({ wordId: oid().toString(), headword: "  ", actorId: oid().toString() }),
    ).rejects.toThrow(VocabError);
  });
});

describe("setVocabWordActive", () => {
  test("deactivates (soft) + audits VOCAB_WORD_DEACTIVATED", async () => {
    const doc: Record<string, unknown> = {
      _id: oid(), program: "BANGLA", classLevel: 1, active: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockResolvedValue(doc);
    const actorId = oid().toString();

    await setVocabWordActive(doc._id as string, false, actorId);

    expect(doc.active).toBe(false);
    expect((doc.save as jest.Mock)).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "VOCAB_WORD_DEACTIVATED", actorId, meta: expect.objectContaining({ active: false }) }),
    );
  });

  test("reactivates a word", async () => {
    const doc: Record<string, unknown> = {
      _id: oid(), program: "BANGLA", classLevel: 1, active: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockResolvedValue(doc);
    await setVocabWordActive(doc._id as string, true, oid().toString());
    expect(doc.active).toBe(true);
  });

  test("throws when the word is missing", async () => {
    mockFindById.mockResolvedValue(null);
    await expect(setVocabWordActive(oid().toString(), false, oid().toString())).rejects.toThrow(/not found/);
  });
});

describe("listVocabWords", () => {
  test("active-only by default", async () => {
    mockFind.mockReturnValue(leanChain([{ headword: "a" }]));
    const rows = await listVocabWords({ program: "ENGLISH", classLevel: 3 });
    expect(rows).toHaveLength(1);
    expect(mockFind).toHaveBeenCalledWith({ program: "ENGLISH", classLevel: 3, active: true });
  });

  test("includeInactive drops the active filter", async () => {
    mockFind.mockReturnValue(leanChain([]));
    await listVocabWords({ program: "ENGLISH", classLevel: 3, includeInactive: true });
    expect(mockFind).toHaveBeenCalledWith({ program: "ENGLISH", classLevel: 3 });
  });

  test("validates program + class level before querying", async () => {
    await expect(listVocabWords({ program: "NOPE", classLevel: 3 })).rejects.toThrow(VocabError);
    await expect(listVocabWords({ program: "ENGLISH", classLevel: 9 })).rejects.toThrow(VocabError);
    expect(mockFind).not.toHaveBeenCalled();
  });
});
