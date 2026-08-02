/**
 * Book file store — kinds, upload validation, Drive path, read gate (SB-2, D-#409).
 *
 * The first block pins the `book_` PREFIX INVARIANT. `GET /files/:id` dispatches the
 * book read gate on `file.kind.startsWith("book_")` rather than on the exported kind
 * list, because a dozen suites mock the StoredFile module and a dispatch that depends
 * on a new named export breaks all of them the day it is added. That is a reasonable
 * trade only if the prefix is actually an invariant — so it is asserted here in both
 * directions rather than assumed.
 */
import {
  STORED_FILE_KINDS,
  BOOK_STORED_FILE_KINDS,
} from "../modules/platform/models/StoredFile";
import {
  validateBookUpload,
  kindForStage,
  bookDrivePath,
  assertBookFileReadAccess,
  MAX_BOOK_IMAGE_BYTES,
  MAX_BOOK_PDF_BYTES,
  BOOK_FILE_ERRORS_BN,
} from "../modules/support-book/services/BookFileService";
import { ForbiddenError } from "../middleware/authz";
import type { AppContext } from "../context";
import type { IStoredFile } from "../modules/platform/models/StoredFile";

describe("the book_ prefix invariant (the GET /files/:id dispatch depends on it)", () => {
  it("every book kind starts with book_", () => {
    for (const k of BOOK_STORED_FILE_KINDS) expect(k.startsWith("book_")).toBe(true);
  });

  it("no NON-book kind starts with book_ — the prefix cannot over-match", () => {
    const bookSet = new Set<string>(BOOK_STORED_FILE_KINDS);
    for (const k of STORED_FILE_KINDS) {
      if (bookSet.has(k)) continue;
      expect(k.startsWith("book_")).toBe(false);
    }
  });

  it("every book kind is registered in the master list", () => {
    for (const k of BOOK_STORED_FILE_KINDS) expect(STORED_FILE_KINDS).toContain(k);
  });
});

describe("stage → StoredFile kind", () => {
  it("maps the two stages that matter to their own kinds", () => {
    expect(kindForStage("APPROVED")).toBe("book_image_approved");
    expect(kindForStage("COMPLIANT")).toBe("book_image_compliant");
  });

  it("treats the intermediate stages as raw artwork", () => {
    // CROPPED/UPSCALED are working files; the ASSET row carries the stage, so the
    // file kind only has to say "this is book artwork".
    expect(kindForStage("CROPPED")).toBe("book_image_raw");
    expect(kindForStage("UPSCALED")).toBe("book_image_raw");
  });
});

describe("upload validation", () => {
  it("accepts PNG and JPEG artwork", () => {
    expect(validateBookUpload("image/png", 1000, false)).toBeNull();
    expect(validateBookUpload("image/jpeg", 1000, false)).toBeNull();
  });

  it("refuses a non-image in Bangla", () => {
    expect(validateBookUpload("image/gif", 1000, false)).toBe(BOOK_FILE_ERRORS_BN.badMime);
    expect(validateBookUpload("application/pdf", 1000, false)).toBe(BOOK_FILE_ERRORS_BN.badMime);
  });

  it("caps artwork at 25 MB", () => {
    expect(validateBookUpload("image/png", MAX_BOOK_IMAGE_BYTES, false)).toBeNull();
    expect(validateBookUpload("image/png", MAX_BOOK_IMAGE_BYTES + 1, false)).toBe(
      BOOK_FILE_ERRORS_BN.tooLargeImage,
    );
  });

  it("allows a much larger PDF — a colour book with 201 images is not small", () => {
    expect(validateBookUpload("application/pdf", MAX_BOOK_PDF_BYTES, true)).toBeNull();
    expect(validateBookUpload("application/pdf", MAX_BOOK_PDF_BYTES + 1, true)).toBe(
      BOOK_FILE_ERRORS_BN.tooLargePdf,
    );
  });

  it("refuses an image posing as a PDF upload", () => {
    expect(validateBookUpload("image/png", 1000, true)).toBe(BOOK_FILE_ERRORS_BN.badMime);
  });
});

describe("Drive path", () => {
  it("puts artifacts under books/<BOOK_ID>/<stage>", () => {
    expect(bookDrivePath("C1-BAN", "COMPLIANT")).toBe("books/C1-BAN/compliant");
    expect(bookDrivePath("GB-B01", "APPROVED")).toBe("books/GB-B01/approved");
  });
});

describe("read gate", () => {
  const withPerms = (perms: string[]): AppContext =>
    ({ auth: { userId: "u1", role: "TEACHER", grantedPermissions: perms } } as unknown as AppContext);
  const file = { kind: "book_image_compliant" } as unknown as IStoredFile;

  it("allows a holder of book:read", () => {
    expect(() => assertBookFileReadAccess(withPerms(["book:read"]), file)).not.toThrow();
  });

  it("refuses a staff login with no production role", () => {
    // book:* is granted per user via AC-1 (D-#405), so an ordinary teacher holds none.
    expect(() => assertBookFileReadAccess(withPerms([]), file)).toThrow(ForbiddenError);
  });

  it("refuses an unauthenticated caller", () => {
    expect(() => assertBookFileReadAccess({} as AppContext, file)).toThrow(ForbiddenError);
  });
});
