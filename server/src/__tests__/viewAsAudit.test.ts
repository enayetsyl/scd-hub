/**
 * "View as" audit attribution (VA-1, G1, D-#638).
 *
 * The owner's rule: while the Principal is working inside someone else's account, the log
 * must say the PRINCIPAL did it — not the teacher or guardian whose account was borrowed.
 *
 * These tests pin the inversion at the one seam that implements it (`writeAudit`), because
 * that is what makes the rule hold for every event kind in the app, including ones written
 * after today. The ordinary path is asserted just as hard: an ordinary request must produce
 * byte-identical rows to the ones it produced before this feature existed.
 *
 * DB-free (repo convention): the Audit model is mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockCreate = jest.fn();
const mockInsertMany = jest.fn();
jest.mock("../modules/platform/models/Audit", () => ({
  Audit: {
    create: (doc: unknown) => mockCreate(doc),
    insertMany: (docs: unknown, opts: unknown) => mockInsertMany(docs, opts),
  },
}));

import { writeAudit, writeAuditMany } from "../modules/platform/services/AuditService";
import { runWithAuditActor, currentAuditActor } from "../modules/platform/services/auditActor";

const PRINCIPAL = oid().toString();
const TEACHER = oid().toString();

const asPrincipal = { impersonatorId: PRINCIPAL, impersonatorRole: "PRINCIPAL", onBehalfOf: TEACHER };

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({});
  mockInsertMany.mockResolvedValue([]);
});

describe("ordinary requests are completely unaffected", () => {
  test("no store ⇒ the row is written exactly as passed", async () => {
    await writeAudit({ eventKind: "ATTENDANCE_MARKED", actorId: TEACHER, actorRole: "TEACHER" });
    const row = mockCreate.mock.calls[0][0];
    expect(row.actorId).toBe(TEACHER);
    expect(row.actorRole).toBe("TEACHER");
    expect(row.onBehalfOf).toBeUndefined();
  });

  test("there is no ambient store outside runWithAuditActor", () => {
    expect(currentAuditActor()).toBeUndefined();
  });

  test("the store does not leak past the call that installed it", async () => {
    runWithAuditActor(asPrincipal, () => undefined);
    await writeAudit({ eventKind: "TRACKER_WRITE", actorId: TEACHER, actorRole: "TEACHER" });
    expect(mockCreate.mock.calls[0][0].actorId).toBe(TEACHER);
  });
});

describe("inside a View-as session the log names the Principal", () => {
  test("actorId becomes the Principal and the borrowed account moves to onBehalfOf", async () => {
    await runWithAuditActor(asPrincipal, () =>
      writeAudit({ eventKind: "ATTENDANCE_MARKED", actorId: TEACHER, actorRole: "TEACHER" }),
    );
    const row = mockCreate.mock.calls[0][0];
    expect(row.actorId).toBe(PRINCIPAL);
    expect(row.actorRole).toBe("PRINCIPAL");
    expect(row.onBehalfOf).toBe(TEACHER);
  });

  test("the inversion survives an await — it is async-context scoped, not synchronous", async () => {
    await runWithAuditActor(asPrincipal, async () => {
      await new Promise((r) => setTimeout(r, 1));
      await writeAudit({ eventKind: "TRACKER_WRITE", actorId: TEACHER });
    });
    expect(mockCreate.mock.calls[0][0].actorId).toBe(PRINCIPAL);
  });

  test("a call site that passes no actorId still records the borrowed account", async () => {
    await runWithAuditActor(asPrincipal, () => writeAudit({ eventKind: "CONTENT_READ" }));
    const row = mockCreate.mock.calls[0][0];
    expect(row.actorId).toBe(PRINCIPAL);
    expect(row.onBehalfOf).toBe(TEACHER);
  });

  test("a call site naming someone OTHER than the caller keeps that account in onBehalfOf", async () => {
    // A few writes attribute to a subject that is not the caller. The row should record the
    // account the write was actually attributed to, not the token's subject.
    const other = oid().toString();
    await runWithAuditActor(asPrincipal, () =>
      writeAudit({ eventKind: "ROSTER_MANAGE", actorId: other, actorRole: "OFFICE" }),
    );
    expect(mockCreate.mock.calls[0][0].onBehalfOf).toBe(other);
  });

  test("the bulk path is inverted too — a batched write cannot escape the rule", async () => {
    await runWithAuditActor(asPrincipal, () =>
      writeAuditMany([
        { eventKind: "QUESTION_EDITED", actorId: TEACHER, actorRole: "TEACHER" },
        { eventKind: "QUESTION_RETIRED", actorId: TEACHER, actorRole: "TEACHER" },
      ]),
    );
    const rows = mockInsertMany.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.actorId).toBe(PRINCIPAL);
      expect(row.actorRole).toBe("PRINCIPAL");
      expect(row.onBehalfOf).toBe(TEACHER);
    }
  });

  test("every other field the call site set is preserved", async () => {
    const target = oid();
    await runWithAuditActor(asPrincipal, () =>
      writeAudit({
        eventKind: "WORK_CLAIM_ACCEPTED",
        actorId: TEACHER,
        targetId: target,
        targetKind: "Assignment",
        meta: { note: "kept" },
      }),
    );
    const row = mockCreate.mock.calls[0][0];
    expect(row.targetId).toBe(target);
    expect(row.targetKind).toBe("Assignment");
    expect(row.meta).toEqual({ note: "kept" });
    expect(row.eventAt).toBeInstanceOf(Date);
  });
});
