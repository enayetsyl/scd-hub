/**
 * Session Recording CO-2 tests (prd-classroom-observation §5) — the YouTube-unlisted
 * footage that backs a ClassroomObservation.
 *
 * Service   — recordSessionFootage stores the client-returned youtubeVideoId, FORCES
 *             privacyStatus "unlisted" (never a caller value), copies the observation's
 *             session anchor, links the observation's recordingId (a re-upload relinks,
 *             capturing the prior id), and writes one SESSION_RECORDING_ADDED audit row;
 *             an empty/blank youtubeVideoId is refused; a missing observation is refused.
 *             recordingForObservation resolves the linked recording (or null).
 * RBAC      — executed against the built schema with each role's context, so the real
 *             permission map runs: a non-upload role (plain TEACHER) is denied
 *             recordSessionFootage at the scope layer; observationRecording is ROW-SCOPED
 *             via the shared canReadObservation (observed teacher only at/after REVIEWED;
 *             observer own; Principal/Office all; GUARDIAN holds no observation:* perm).
 *
 * DB-free (repo convention): the models + audit are mocked.
 */
import mongoose from "mongoose";
import { graphql } from "graphql";
import type { ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const leanChain = (val: unknown) => ({ lean: async () => val });

const mockObsFindById = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: {
    findById: (id: unknown) => mockObsFindById(id),
  },
}));

const mockRecCreate = jest.fn();
const mockRecFindById = jest.fn();
jest.mock("../modules/classroom-observation/models/SessionRecording", () => ({
  SessionRecording: {
    create: (doc: unknown) => mockRecCreate(doc),
    findById: (id: unknown) => mockRecFindById(id),
  },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import {
  recordSessionFootage,
  recordingForObservation,
} from "../modules/classroom-observation/services/SessionRecordingService";
import { ClassroomObservationError } from "../modules/classroom-observation/services/ClassroomObservationService";
import { builder } from "../schema";
import "../modules/classroom-observation/resolvers/sessionRecording";

const TEACHER = oid(); // the observed teacher
const OBSERVER = oid(); // the assigned senior teacher
const OFFICE = oid(); // the uploader (Principal/Office)
const SECTION = oid();

/**
 * A mongoose-doc-like observation (has .save) — a COMPLETE document so the service's
 * `shape()`/`getObservation` mapper (createdBy/createdAt/domains/…) resolves cleanly.
 */
const makeObs = (over: Record<string, unknown> = {}) => {
  const doc: Record<string, unknown> = {
    _id: oid(),
    form: "REF11",
    subject: "MATH",
    teacherId: TEACHER,
    classDate: "2026-06-14",
    sectionId: SECTION,
    subjectGroupId: null,
    routineSlotId: null,
    periodNumber: 3,
    observerId: OBSERVER,
    state: "REVIEWED",
    createdBy: OFFICE,
    assignedAt: new Date("2026-06-14T00:00:00Z"),
    reviewedAt: new Date("2026-06-14T00:00:00Z"),
    domains: [],
    gates: [],
    oneStrength: null,
    growthFocus: null,
    prevObservationId: null,
    priorFocusProgress: null,
    recordingId: null,
    teacherResponse: null,
    supersededById: null,
    createdAt: new Date("2026-06-14T00:00:00Z"),
    updatedAt: new Date("2026-06-14T00:00:00Z"),
    ...over,
  };
  doc.save = jest.fn(async () => doc);
  return doc;
};

const makeRec = (over: Record<string, unknown> = {}) => ({
  _id: oid(),
  routineSlotId: null,
  sectionId: SECTION,
  subjectGroupId: null,
  subject: "MATH",
  teacherId: TEACHER,
  classDate: "2026-06-14",
  periodNumber: 3,
  youtubeVideoId: "yt-abc123",
  privacyStatus: "unlisted",
  uploadedBy: OFFICE,
  createdAt: new Date("2026-06-14T00:00:00Z"),
  updatedAt: new Date("2026-06-14T00:00:00Z"),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockRecCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
    _id: oid(),
    ...doc,
    createdAt: new Date("2026-06-14T00:00:00Z"),
    updatedAt: new Date("2026-06-14T00:00:00Z"),
  }));
});

// ===========================================================================
// recordSessionFootage — store the footage + link + audit (service)
// ===========================================================================

describe("recordSessionFootage", () => {
  test("stores the youtubeVideoId, forces privacyStatus 'unlisted', links + audits", async () => {
    const obs = makeObs({ recordingId: null });
    mockObsFindById.mockResolvedValue(obs);

    const res = await recordSessionFootage({
      observationId: String(obs._id),
      youtubeVideoId: "yt-abc123",
      actorId: OFFICE.toString(),
      actorRole: "OFFICE",
    });

    // the footage id is stored verbatim and the privacy is forced unlisted
    expect(res.youtubeVideoId).toBe("yt-abc123");
    expect(res.privacyStatus).toBe("unlisted");
    expect(res.observationId).toBe(String(obs._id));

    // the SessionRecording copied the observation's anchor + forced unlisted
    const created = mockRecCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.privacyStatus).toBe("unlisted");
    expect(created.subject).toBe("MATH");
    expect(created.teacherId).toBe(TEACHER);
    expect(created.classDate).toBe("2026-06-14");
    expect(created.sectionId).toBe(SECTION);
    expect(created.periodNumber).toBe(3);
    expect(created.youtubeVideoId).toBe("yt-abc123");

    // the observation's recordingId was linked + saved
    expect(obs.recordingId).toBeTruthy();
    expect((obs.save as jest.Mock)).toHaveBeenCalled();
    expect(res.id).toBe(String(obs.recordingId));

    // exactly one SESSION_RECORDING_ADDED audit, prior/next captured
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const audit = mockWriteAudit.mock.calls[0][0] as {
      eventKind: string;
      targetKind: string;
      meta: { prior: { recordingId: string | null }; next: { recordingId: string; youtubeVideoId: string } };
    };
    expect(audit.eventKind).toBe("SESSION_RECORDING_ADDED");
    expect(audit.targetKind).toBe("ClassroomObservation");
    expect(audit.meta.prior.recordingId).toBeNull();
    expect(audit.meta.next.youtubeVideoId).toBe("yt-abc123");
  });

  test("forces 'unlisted' even though the value is never an arg (re-upload captures prior id)", async () => {
    const priorRec = oid();
    const obs = makeObs({ recordingId: priorRec });
    mockObsFindById.mockResolvedValue(obs);

    const res = await recordSessionFootage({
      observationId: String(obs._id),
      youtubeVideoId: "yt-second",
      actorId: OFFICE.toString(),
    });

    expect(res.privacyStatus).toBe("unlisted");
    // the relink replaced the prior recording link; the prior id is in the audit
    const audit = mockWriteAudit.mock.calls[0][0] as { meta: { prior: { recordingId: string | null } } };
    expect(audit.meta.prior.recordingId).toBe(priorRec.toString());
  });

  test("rejects an empty / blank youtubeVideoId (no create, no audit)", async () => {
    mockObsFindById.mockResolvedValue(makeObs());
    await expect(
      recordSessionFootage({ observationId: oid().toString(), youtubeVideoId: "   ", actorId: OFFICE.toString() }),
    ).rejects.toBeInstanceOf(ClassroomObservationError);
    expect(mockRecCreate).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("rejects when the backing observation is not found", async () => {
    mockObsFindById.mockResolvedValue(null);
    await expect(
      recordSessionFootage({ observationId: oid().toString(), youtubeVideoId: "yt-x", actorId: OFFICE.toString() }),
    ).rejects.toBeInstanceOf(ClassroomObservationError);
    expect(mockRecCreate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// recordingForObservation — the linked recording (via observation.recordingId)
// ===========================================================================

describe("recordingForObservation", () => {
  test("resolves the linked recording via the observation's recordingId", async () => {
    const rec = makeRec();
    const obs = makeObs({ recordingId: rec._id });
    mockObsFindById.mockReturnValue(leanChain(obs));
    mockRecFindById.mockReturnValue(leanChain(rec));

    const res = await recordingForObservation(String(obs._id));
    expect(res?.youtubeVideoId).toBe("yt-abc123");
    expect(res?.observationId).toBe(String(obs._id));
    expect(mockRecFindById).toHaveBeenCalledWith(rec._id);
  });

  test("returns null when the observation has no recording linked", async () => {
    const obs = makeObs({ recordingId: null });
    mockObsFindById.mockReturnValue(leanChain(obs));
    expect(await recordingForObservation(String(obs._id))).toBeNull();
    expect(mockRecFindById).not.toHaveBeenCalled();
  });

  test("returns null when the observation itself is absent", async () => {
    mockObsFindById.mockReturnValue(leanChain(null));
    expect(await recordingForObservation(oid().toString())).toBeNull();
  });
});

// ===========================================================================
// RBAC — executed against the built schema with each role's context
// ===========================================================================

// Register a noop so the builder has at least one always-present root field, then build once.
builder.mutationField("_recTestNoop", (t) => t.boolean({ resolve: () => true }));
const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string | null, userId = oid().toString()): Ctx => ({
  auth: role ? { role, userId } : null,
});

const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

describe("recordSessionFootage — scope-layer RBAC", () => {
  const M = `mutation($o: String!, $y: String!){ recordSessionFootage(observationId: $o, youtubeVideoId: $y){ id privacyStatus } }`;

  test("a plain TEACHER (no observation:upload) is denied at the scope layer", async () => {
    mockObsFindById.mockResolvedValue(makeObs());
    const r = await graphql({
      schema,
      source: M,
      contextValue: ctxOf("TEACHER"),
      variableValues: { o: oid().toString(), y: "yt-x" },
    });
    expect(denied(r)).toBe(true);
    expect(mockRecCreate).not.toHaveBeenCalled();
  });

  test("GUARDIAN (holds no observation:* perm) is denied", async () => {
    const r = await graphql({
      schema,
      source: M,
      contextValue: ctxOf("GUARDIAN"),
      variableValues: { o: oid().toString(), y: "yt-x" },
    });
    expect(denied(r)).toBe(true);
    expect(mockRecCreate).not.toHaveBeenCalled();
  });

  test("unauthenticated is denied", async () => {
    const r = await graphql({
      schema,
      source: M,
      contextValue: ctxOf(null),
      variableValues: { o: oid().toString(), y: "yt-x" },
    });
    expect(denied(r)).toBe(true);
  });

  test("an OFFICE (observation:upload) caller stores the footage, forced 'unlisted'", async () => {
    const obs = makeObs({ recordingId: null });
    mockObsFindById.mockResolvedValue(obs);
    const r = await graphql({
      schema,
      source: M,
      contextValue: ctxOf("OFFICE", OFFICE.toString()),
      variableValues: { o: String(obs._id), y: "yt-office" },
    });
    expect(denied(r)).toBe(false);
    const data = r.data as { recordSessionFootage: { privacyStatus: string } };
    expect(data.recordSessionFootage.privacyStatus).toBe("unlisted");
    expect(mockRecCreate).toHaveBeenCalledTimes(1);
  });
});

describe("observationRecording — observation:read + row-scope", () => {
  const Q = `query($o: String!){ observationRecording(observationId: $o){ id youtubeVideoId } }`;

  /** Wire the observation (getObservation, .lean) + the linked recording for a read. */
  const wireRead = (obsOver: Record<string, unknown>) => {
    const rec = makeRec();
    const obs = makeObs({ recordingId: rec._id, ...obsOver });
    // getObservation + recordingForObservation both use findById(...).lean()
    mockObsFindById.mockReturnValue(leanChain(obs));
    mockRecFindById.mockReturnValue(leanChain(rec));
    return { obs, rec };
  };

  test("the observed teacher is DENIED before REVIEWED (ASSIGNED hidden)", async () => {
    const { obs } = wireRead({ state: "ASSIGNED" });
    const r = await graphql({
      schema,
      source: Q,
      contextValue: ctxOf("TEACHER", TEACHER.toString()),
      variableValues: { o: String(obs._id) },
    });
    expect(denied(r)).toBe(true);
  });

  test("the observed teacher GETS it at/after REVIEWED", async () => {
    const { obs } = wireRead({ state: "REVIEWED" });
    const r = await graphql({
      schema,
      source: Q,
      contextValue: ctxOf("TEACHER", TEACHER.toString()),
      variableValues: { o: String(obs._id) },
    });
    expect(denied(r)).toBe(false);
    expect((r.data as { observationRecording: { youtubeVideoId: string } }).observationRecording.youtubeVideoId).toBe(
      "yt-abc123",
    );
  });

  test("the assigned observer gets their own row in any state", async () => {
    const { obs } = wireRead({ state: "ASSIGNED" });
    const r = await graphql({
      schema,
      source: Q,
      contextValue: ctxOf("TEACHER", OBSERVER.toString()),
      variableValues: { o: String(obs._id) },
    });
    expect(denied(r)).toBe(false);
    expect((r.data as { observationRecording: { youtubeVideoId: string } }).observationRecording.youtubeVideoId).toBe(
      "yt-abc123",
    );
  });

  test("Principal/Office (manager) get the footage in any state", async () => {
    for (const role of ["PRINCIPAL", "OFFICE"]) {
      const { obs } = wireRead({ state: "ASSIGNED" });
      const r = await graphql({
        schema,
        source: Q,
        contextValue: ctxOf(role),
        variableValues: { o: String(obs._id) },
      });
      expect(denied(r)).toBe(false);
      expect((r.data as { observationRecording: { youtubeVideoId: string } | null }).observationRecording?.youtubeVideoId).toBe(
        "yt-abc123",
      );
    }
  });

  test("GUARDIAN (no observation:read) is denied at the scope layer", async () => {
    const { obs } = wireRead({ state: "REVIEWED" });
    const r = await graphql({
      schema,
      source: Q,
      contextValue: ctxOf("GUARDIAN"),
      variableValues: { o: String(obs._id) },
    });
    expect(denied(r)).toBe(true);
  });

  test("a missing observation returns null (not an error) for a permitted reader", async () => {
    mockObsFindById.mockReturnValue(leanChain(null));
    const r = await graphql({
      schema,
      source: Q,
      contextValue: ctxOf("PRINCIPAL"),
      variableValues: { o: oid().toString() },
    });
    expect(denied(r)).toBe(false);
    expect((r.data as { observationRecording: unknown }).observationRecording).toBeNull();
  });
});
