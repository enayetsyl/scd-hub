/**
 * D-#281 — the print-scoped exception on `GET /pdf/artifact/:id`.
 *
 * The Office holds `roster:manage` but NOT `content:read`, yet it must open the plan a
 * teacher sent to the print queue. Rather than granting the Office the whole content
 * plane, the route admits a `roster:manage` caller ONLY for an artifact a live
 * PrintRequest references.
 *
 *   1. content:read still passes outright, with no PrintRequest lookup
 *   2. the Office passes only for a QUEUED artifact
 *   3. an un-queued artifact is denied to the Office — the content plane stays shut
 *   4. a CANCELLED job withdraws the access again
 *   5. everyone else (teacher without content:read, guardian, anonymous) is denied
 */
const mockExists = jest.fn();

jest.mock("../modules/printing/models/PrintRequest", () => ({
  PrintRequest: { exists: (f: unknown) => mockExists(f) },
}));
jest.mock("../modules/content/models/ContentArtifact", () => ({ ContentArtifact: {} }));
jest.mock("../routes/pdfRenderer", () => ({ markdownToPdf: jest.fn() }));

import { mayRenderArtifact } from "../routes/pdf";
import type { AppContext } from "../context";

const ARTIFACT = "artifact-1";
const ctxFor = (role: string | null): AppContext =>
  ({ auth: role ? { userId: "u1", role } : null }) as unknown as AppContext;

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockResolvedValue(null);
});

describe("mayRenderArtifact", () => {
  test("a content:read holder passes outright — no queue lookup", async () => {
    expect(await mayRenderArtifact(ctxFor("TEACHER"), ARTIFACT)).toBe(true);
    expect(await mayRenderArtifact(ctxFor("PRINCIPAL"), ARTIFACT)).toBe(true);
    expect(mockExists).not.toHaveBeenCalled();
  });

  test("the Office passes ONLY for an artifact that is queued for printing", async () => {
    mockExists.mockResolvedValue({ _id: "pr-1" });
    expect(await mayRenderArtifact(ctxFor("OFFICE"), ARTIFACT)).toBe(true);
    expect(mockExists).toHaveBeenCalledWith({
      contentArtifactId: ARTIFACT,
      status: { $ne: "CANCELLED" },
    });
  });

  test("an un-queued artifact is denied to the Office — the content plane stays shut", async () => {
    mockExists.mockResolvedValue(null);
    expect(await mayRenderArtifact(ctxFor("OFFICE"), ARTIFACT)).toBe(false);
  });

  test("cancelling the print job withdraws the Office's access", async () => {
    // `exists` is filtered on status ≠ CANCELLED, so a cancelled-only job matches nothing.
    mockExists.mockResolvedValue(null);
    expect(await mayRenderArtifact(ctxFor("OFFICE"), ARTIFACT)).toBe(false);
    const filter = mockExists.mock.calls[0][0] as { status: unknown };
    expect(filter.status).toEqual({ $ne: "CANCELLED" });
  });

  test("a guardian and an anonymous caller are always denied", async () => {
    mockExists.mockResolvedValue({ _id: "pr-1" }); // even with a live job
    expect(await mayRenderArtifact(ctxFor("GUARDIAN"), ARTIFACT)).toBe(false);
    expect(await mayRenderArtifact(ctxFor(null), ARTIFACT)).toBe(false);
  });
});
