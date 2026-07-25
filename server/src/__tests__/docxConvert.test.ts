/**
 * docxConvert — DOCX → PDF via headless LibreOffice (owner 2026-07-25). DB-free /
 * process-free: child_process.execFile + fs/promises are mocked so the pure logic
 * (temp dir, isolated profile arg, PDF-header validation, cleanup, error mapping)
 * runs without soffice installed.
 */
const mockExecFile = jest.fn();
const mockReadFile = jest.fn();
const mockRm = jest.fn();

jest.mock("node:child_process", () => ({
  // promisify(execFile) calls this with a trailing (err, {stdout,stderr}) callback.
  execFile: (cmd: string, args: string[], opts: unknown, cb: (e: unknown, r?: unknown) => void) =>
    mockExecFile(cmd, args, opts, cb),
}));
jest.mock("node:fs/promises", () => ({
  mkdtemp: async (p: string) => `${p}XXX`,
  writeFile: async () => undefined,
  readFile: (...a: unknown[]) => mockReadFile(...a),
  rm: (...a: unknown[]) => mockRm(...a),
}));

import { docxToPdf, DocxConvertError, isDocxMime } from "../modules/platform/services/docxConvert";

beforeEach(() => {
  jest.clearAllMocks();
  mockExecFile.mockImplementation((_c, _a, _o, cb) => cb(null, { stdout: "", stderr: "" }));
  mockRm.mockResolvedValue(undefined);
});

describe("docxToPdf", () => {
  test("returns the converted PDF buffer and cleans up the temp dir", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("%PDF-1.7 hello"));
    const out = await docxToPdf(Buffer.from("docx-bytes"), "C4B04_TD.docx");
    expect(out.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // Headless + an isolated per-call profile (concurrency-safe).
    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain("--headless");
    expect(args.some((a) => a.startsWith("-env:UserInstallation=file://"))).toBe(true);
    expect(args).toContain("pdf");
    expect(mockRm).toHaveBeenCalled(); // temp dir removed
  });

  test("soffice failure → DocxConvertError (temp dir still cleaned)", async () => {
    mockExecFile.mockImplementation((_c, _a, _o, cb) => cb(new Error("soffice: not found")));
    await expect(docxToPdf(Buffer.from("x"), "a.docx")).rejects.toBeInstanceOf(DocxConvertError);
    expect(mockRm).toHaveBeenCalled();
  });

  test("non-PDF output → DocxConvertError", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("not a pdf"));
    await expect(docxToPdf(Buffer.from("x"), "a.docx")).rejects.toThrow(/no valid PDF/);
  });
});

describe("isDocxMime", () => {
  test("accepts doc + docx, rejects pdf", () => {
    expect(isDocxMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(isDocxMime("application/msword")).toBe(true);
    expect(isDocxMime("application/pdf")).toBe(false);
  });
});
