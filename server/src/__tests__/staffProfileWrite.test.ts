/**
 * Staff-record create/edit from the app (D-#526).
 *
 * DB-free: the validation/normalisation logic is pure and exported from
 * StaffProfileService, so nothing loads Mongoose or the Pothos schema.
 */
import { buildPatch, clean, normalizeStaffPhone, parseDate, StaffProfileError } from "../modules/foundation/services/StaffProfileService";

describe("D-#526 — field cleaning", () => {
  test("blank and whitespace become undefined, so a cleared field is UNSET not stored blank", () => {
    expect(clean("")).toBeUndefined();
    expect(clean("   ")).toBeUndefined();
    expect(clean(null)).toBeUndefined();
    expect(clean(undefined)).toBeUndefined();
  });

  test("surrounding whitespace is trimmed", () => {
    expect(clean("  Tasmiah Kaynat Shoily  ")).toBe("Tasmiah Kaynat Shoily");
  });
});

describe("D-#526 — phone normalisation", () => {
  test("every local form collapses to one +880 number", () => {
    // The phone IS the login id (D-#60), so two spellings must not become two staff
    // members with two logins for one person.
    for (const form of ["01712345678", "+8801712345678", "8801712345678", "01712-345678", " 01712 345678 "]) {
      expect(normalizeStaffPhone(form)).toBe("+8801712345678");
    }
  });

  test("a blank phone stays undefined rather than becoming '+88'", () => {
    expect(normalizeStaffPhone("")).toBeUndefined();
    expect(normalizeStaffPhone(null)).toBeUndefined();
  });
});

describe("D-#526 — dates", () => {
  test("a YYYY-MM-DD date is accepted", () => {
    expect(parseDate("1994-03-12")?.toISOString().slice(0, 10)).toBe("1994-03-12");
  });

  test("nonsense is REFUSED rather than stored as Invalid Date", () => {
    expect(() => parseDate("not-a-date", "dob")).toThrow(StaffProfileError);
    expect(() => parseDate("not-a-date", "dob")).toThrow(/dob/);
  });

  test("a blank date is simply absent", () => {
    expect(parseDate("")).toBeUndefined();
  });
});

describe("D-#526 — enum validation", () => {
  test("a bad category is refused by name", () => {
    expect(() => buildPatch({ category: "headmaster" })).toThrow(/category must be one of/);
  });

  test("a real category passes", () => {
    expect(buildPatch({ category: "teacher" }).category).toBe("teacher");
  });

  test("a bad gender is refused", () => {
    expect(() => buildPatch({ gender: "f" })).toThrow(/gender must be one of/);
  });

  test("a bad employment status is refused", () => {
    expect(() => buildPatch({ employmentStatus: "retired-ish" })).toThrow(/employmentStatus/);
  });
});

describe("D-#526 — pay is NOT writable here", () => {
  test("salary and payment method never reach the patch", () => {
    // They are set through setStaffPay under payroll:manage. If they leaked into this
    // input, anyone who can fix an address typo could also set a salary.
    // Cast through unknown: the input type does not DECLARE these fields, which is half
    // the protection — this asserts the runtime half, that a client sending them anyway
    // gets them dropped rather than applied.
    const sneaky = { name: "X", monthlySalary: 99999, paymentMethod: "cash" } as unknown as Parameters<
      typeof buildPatch
    >[0];
    const patch = buildPatch(sneaky);
    expect(patch.monthlySalary).toBeUndefined();
    expect(patch.paymentMethod).toBeUndefined();
    expect(patch.name).toBe("X");
  });
});

describe("D-#526 — patch semantics", () => {
  test("an omitted field is absent from the patch, so an edit cannot blank what it did not show", () => {
    const patch = buildPatch({ name: "New Name" });
    expect(patch).toEqual({ name: "New Name" });
    expect("presentAddress" in patch).toBe(false);
    expect("nid" in patch).toBe(false);
  });

  test("email is lowercased so a login cannot differ by case", () => {
    expect(buildPatch({ email: "  K.Tanha1994@Gmail.COM " }).email).toBe("k.tanha1994@gmail.com");
  });

  test("active:false is carried through — deactivating is a real edit, not an omission", () => {
    expect(buildPatch({ active: false }).active).toBe(false);
    expect("active" in buildPatch({})).toBe(false);
  });

  test("a full record maps every field", () => {
    const patch = buildPatch({
      schoolId: "SCD-101",
      name: "Tasmiah Kaynat Shoily",
      category: "teacher",
      employmentType: "full_time",
      employmentStatus: "confirmed",
      phone: "01712345678",
      email: "K.Tanha1994@gmail.com",
      designation: "Assistant Teacher",
      qualification: "BA",
      presentAddress: "Sylhet",
    });
    expect(patch.schoolId).toBe("SCD-101");
    expect(patch.phone).toBe("+8801712345678");
    expect(patch.email).toBe("k.tanha1994@gmail.com");
    expect(patch.designation).toBe("Assistant Teacher");
    expect(patch.employmentStatus).toBe("confirmed");
    expect(patch.active).toBeUndefined(); // employmentStatus is NOT the active flag
  });
});
