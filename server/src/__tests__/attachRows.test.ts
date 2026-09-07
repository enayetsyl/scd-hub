/**
 * `attachToExisting` — the invariant that keeps finished work off the open deck (D-#648).
 *
 * The tracker workspaces build one card per item from the OPEN rows, then hand back the
 * returns from an earlier day so the card's "ফেরত N" count has names behind it. Those
 * rows must decorate a card that is already on the deck and must never bring one back:
 * an item whose only remaining rows are old returns is FINISHED and belongs in the
 * completed fold. A resurrected card looks exactly like ordinary work still to do, so
 * the teacher goes hunting for homework that was handed back last week — a silent
 * failure, which is why this is a named function with a test rather than an inline push.
 *
 * The subject-fold case is the one that is easy to get wrong: the screens call the
 * grouper once per subject with a SUBSET of the items, so "this group exists" is
 * narrower than "this item is open", and a row whose card sits in the other fold has to
 * be dropped rather than attached to whatever is nearest.
 *
 * Unit-tested from the server suite because the app workspace has no test runner — the
 * same route `homeworkText.ts` and `nameList.ts` already take.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attachToExisting } = require("../../../app/src/lib/attachRows") as {
  attachToExisting: <T, G extends { rows: T[] }>(
    groups: ReadonlyMap<string, G>,
    rows: readonly T[],
    keyOf: (row: T) => string,
  ) => void;
};

interface Row {
  id: string;
  itemId: string;
}
interface Group {
  itemId: string;
  rows: Row[];
}

const group = (itemId: string, ...rows: Row[]): Group => ({ itemId, rows: [...rows] });
const row = (id: string, itemId: string): Row => ({ id, itemId });
const keyOf = (r: Row): string => r.itemId;

describe("attachToExisting (tracker card rows)", () => {
  it("adds a row to the group its key names", () => {
    const groups = new Map([["A", group("A", row("r1", "A"))]]);
    attachToExisting(groups, [row("r2", "A")], keyOf);
    expect(groups.get("A")!.rows.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("DROPS a row whose group does not exist — never creates one", () => {
    // "B" is a finished item: its card lives in the completed fold, not on the deck.
    const groups = new Map([["A", group("A")]]);
    attachToExisting(groups, [row("r1", "B")], keyOf);
    expect(groups.size).toBe(1);
    expect([...groups.keys()]).toEqual(["A"]);
    expect(groups.get("A")!.rows).toEqual([]);
  });

  it("drops rows for the OTHER subject fold and keeps the ones for this one", () => {
    // The screens group once per subject with a subset, so an English card is absent
    // while the Maths fold renders — its rows must not land on a Maths card.
    const groups = new Map([["maths", group("maths")]]);
    attachToExisting(groups, [row("m1", "maths"), row("e1", "english"), row("m2", "maths")], keyOf);
    expect(groups.get("maths")!.rows.map((r) => r.id)).toEqual(["m1", "m2"]);
  });

  it("is a no-op for an empty row list and for empty groups", () => {
    const groups = new Map([["A", group("A", row("r1", "A"))]]);
    attachToExisting(groups, [], keyOf);
    expect(groups.get("A")!.rows.map((r) => r.id)).toEqual(["r1"]);

    const none = new Map<string, Group>();
    expect(() => attachToExisting(none, [row("r1", "A")], keyOf)).not.toThrow();
    expect(none.size).toBe(0);
  });

  it("spreads rows across several existing groups", () => {
    const groups = new Map([
      ["A", group("A")],
      ["B", group("B")],
    ]);
    attachToExisting(groups, [row("a1", "A"), row("b1", "B"), row("c1", "C")], keyOf);
    expect(groups.get("A")!.rows.map((r) => r.id)).toEqual(["a1"]);
    expect(groups.get("B")!.rows.map((r) => r.id)).toEqual(["b1"]);
    expect(groups.size).toBe(2);
  });
});
