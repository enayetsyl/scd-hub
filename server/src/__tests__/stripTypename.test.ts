/** D-#1657: the client exchange deep-strips `__typename` from operation variables. */
const { stripTypename } = require("../../../app/src/lib/stripTypename") as {
  stripTypename: <T>(v: T) => T;
};

describe("stripTypename", () => {
  it("removes __typename deeply, through arrays and nested objects", () => {
    const input = {
      __typename: "X",
      a: 1,
      list: [{ __typename: "Y", n: 2, inner: { __typename: "Z", ok: true } }, 3, "s"],
    };
    expect(stripTypename(input)).toEqual({ a: 1, list: [{ n: 2, inner: { ok: true } }, 3, "s"] });
  });

  it("does not mutate the input", () => {
    const input = { __typename: "X", a: { __typename: "Y" } };
    stripTypename(input);
    expect(input).toEqual({ __typename: "X", a: { __typename: "Y" } });
  });

  it("leaves Date, File/Blob-like instances, null and primitives untouched", () => {
    const d = new Date(0);
    class FakeFile { name = "f"; __typename = "keep-on-class-instances"; }
    const f = new FakeFile();
    const out = stripTypename({ d, f, n: null, u: undefined, s: "x", num: 5, b: false });
    expect(out.d).toBe(d);
    expect(out.f).toBe(f);
    expect(out.n).toBeNull();
    expect(out.u).toBeUndefined();
    expect(out).toMatchObject({ s: "x", num: 5, b: false });
    if (typeof Blob !== "undefined") {
      const blob = new Blob(["x"]);
      expect(stripTypename({ blob }).blob).toBe(blob);
    }
  });

  it("returns arrays of primitives and clean objects as the same reference", () => {
    const arr = [1, "a", null];
    const obj = { a: [1, 2], b: { c: 1 } };
    expect(stripTypename(arr)).toBe(arr);
    expect(stripTypename(obj)).toBe(obj);
    expect(stripTypename(null)).toBeNull();
    expect(stripTypename("s")).toBe("s");
  });
});
