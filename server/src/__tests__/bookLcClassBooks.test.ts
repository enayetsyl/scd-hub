/**
 * BL-2 — the optional class-books publish (docs/prd-book-lifecycle.md §11.2, §19 bookLcClassBooks; Q7, D-#1600).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
const startClassBookUpload = jest.fn(async (input: { classLevel: number; title: string; pdf: Buffer }) => ({ book: { id: "classbook-fixture-1", ...input }, done: Promise.resolve() }));
jest.mock("../modules/class-books/services/ClassBookService", () => ({ startClassBookUpload: (i: never) => startClassBookUpload(i) }));
import { setupLc, teardownLc, resetBooks, releasedBook, type LcFx } from "./bookLcFixtures";
import { publishToClassBooks, setClassBooksSwitch } from "../modules/book-lifecycle/services/releaseService";
import { BookPrintRelease } from "../modules/book-lifecycle/models/BookRelease";
import { ForbiddenError } from "../middleware/authz";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;

it("refused while the book's switch is off (the default)", async () => {
  const { release } = await releasedBook(P());
  await expect(publishToClassBooks(P(), release._id.toString())).rejects.toThrow(/বন্ধ/);
  expect(startClassBookUpload).not.toHaveBeenCalled();
});

it("the switch is the Principal's; when on, the Student PDF goes to the class-books reader", async () => {
  const { book, release } = await releasedBook(P());
  await expect(setClassBooksSwitch(fx.auth.officeRelease, book._id.toString(), true)).rejects.toBeInstanceOf(ForbiddenError);
  await setClassBooksSwitch(P(), book._id.toString(), true);
  const out = await publishToClassBooks(fx.auth.officeRelease, release._id.toString());
  expect(startClassBookUpload).toHaveBeenCalledTimes(1);
  expect(startClassBookUpload.mock.calls[0][0].classLevel).toBe(3);
  expect(startClassBookUpload.mock.calls[0][0].pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(out.classBookId).toBe("classbook-fixture-1");
  expect((await BookPrintRelease.findById(release._id))?.classBookId).toBe("classbook-fixture-1");
});
