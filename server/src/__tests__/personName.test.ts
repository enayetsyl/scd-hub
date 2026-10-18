/**
 * D-#764 — a person is shown by the English name first; the Bangla name is only a
 * fallback. Covers the server helper and the app's mirror (pure module, no RN).
 */
import { personName } from "../lib/personName";
import { personName as appPersonName, personNameAlt } from "../../../app/src/lib/personName";

describe("personName (D-#764)", () => {
  test.each([
    [{ name: "Akmol Hussain", nameBn: "আকমল হোসাইন" }, "Akmol Hussain"],
    [{ name: "Akmol Hussain" }, "Akmol Hussain"],
    [{ name: "", nameBn: "আকমল হোসাইন" }, "আকমল হোসাইন"],
    [{ name: "  ", nameBn: " আকমল " }, "আকমল"],
  ])("%j → %s (server and app agree)", (p, want) => {
    expect(personName(p)).toBe(want);
    expect(appPersonName(p)).toBe(want);
  });

  test("missing person or names → the fallback", () => {
    expect(personName(null, "শিক্ষার্থী")).toBe("শিক্ষার্থী");
    expect(personName(undefined)).toBe("");
    expect(personName({ name: null, nameBn: null }, "—")).toBe("—");
  });

  test("personNameAlt is the Bangla second line, never a repeat of the primary", () => {
    expect(personNameAlt({ name: "Akmol Hussain", nameBn: "আকমল হোসাইন" })).toBe("আকমল হোসাইন");
    expect(personNameAlt({ name: "Akmol Hussain" })).toBeNull();
    // No English name: the Bangla one is already primary, so no second line.
    expect(personNameAlt({ name: "", nameBn: "আকমল হোসাইন" })).toBeNull();
  });
});
