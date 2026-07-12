/**
 * D-#281 — the print-scoped exception on `GET /pdf/set/:id`.
 *
 * Found in LIVE TESTING: the Office's "Open" button 403'd on every question-set job,
 * because OFFICE holds `roster:manage` but NOT `set:read`. Rather than granting the
 * Office the whole assessment plane, the route admits a `roster:manage` caller ONLY for
 * a set a live PrintRequest references.
 */
const mockExists = jest.fn();

jest.mock("../modules/printing/models/PrintRequest", () => ({
  PrintRequest: { exists: (f: unknown) => mockExists(f) },
}));
jest.mock("../modules/assessment/models/AssessmentSet", () => ({ AssessmentSet: {} }));
jest.mock("../modules/content/models/ContentArtifact", () => ({ ContentArtifact: {} }));
jest.mock("../../routes/pdfRenderer", () => ({ mixedText: jest.fn() }), { virtual: true });

import { mayRenderSet } from "../modules/assessment/routes/setPdf";
import type { AppContext } from "../context";

const SET = "set-1";
const ctxFor = (role: string | null): AppContext =>
  ({ auth: role ? { userId: "u1", role } : null }) as unknown as AppContext;

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockResolvedValue(null);
});

describe("mayRenderSet", () => {
  test("a set:read holder passes outright — no queue lookup", async () => {
    expect(await mayRenderSet(ctxFor("TEACHER"), SET)).toBe(true);
    expect(await mayRenderSet(ctxFor("PRINCIPAL"), SET)).toBe(true);
    expect(mockExists).not.toHaveBeenCalled();
  });

  test("the Office passes ONLY for a set queued for printing (the live-testing bug)", async () => {
    mockExists.mockResolvedValue({ _id: "pr-1" });
    expect(await mayRenderSet(ctxFor("OFFICE"), SET)).toBe(true);
    expect(mockExists).toHaveBeenCalledWith({ setId: SET, status: { $ne: "CANCELLED" } });
  });

  test("an un-queued set stays shut to the Office", async () => {
    mockExists.mockResolvedValue(null);
    expect(await mayRenderSet(ctxFor("OFFICE"), SET)).toBe(false);
  });

  test("a guardian and an anonymous caller are always denied", async () => {
    mockExists.mockResolvedValue({ _id: "pr-1" });
    expect(await mayRenderSet(ctxFor("GUARDIAN"), SET)).toBe(false);
    expect(await mayRenderSet(ctxFor(null), SET)).toBe(false);
  });
});
