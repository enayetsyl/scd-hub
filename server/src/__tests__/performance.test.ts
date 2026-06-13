/**
 * HR-4 — performance / conduct / development (prd-hr §5, H5, D-#28/#112/#113).
 * Pure ladder + supervisory-scope helpers exercised directly; services run against
 * mocked models (DB-free, the repo's test convention).
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// --- model + dependency mocks ----------------------------------------------
const mockConductFind = jest.fn();
const mockConductFindById = jest.fn();
const mockConductCreate = jest.fn();
const mockConductUpdateOne = jest.fn().mockResolvedValue(undefined);
const mockObsCreate = jest.fn();
const mockObsFind = jest.fn();
const mockApprFindOne = jest.fn();
const mockApprFindById = jest.fn();
const mockApprCreate = jest.fn();
const mockDevCreate = jest.fn();
const mockDevFind = jest.fn();
const mockGriCreate = jest.fn();
const mockGriFindById = jest.fn();
const mockGriFind = jest.fn();
const mockStaffFindById = jest.fn();
const mockStaffUpdate = jest.fn().mockResolvedValue(undefined);
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

/** A find()-chain stub: .select()/.sort() return self, .lean() resolves the value. */
const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

jest.mock("../modules/hr/models/ConductRecord", () => ({
  ConductRecord: {
    find: (q: unknown) => mockConductFind(q),
    findById: (id: unknown) => mockConductFindById(id),
    create: (d: unknown) => mockConductCreate(d),
    updateOne: (f: unknown, u: unknown) => mockConductUpdateOne(f, u),
  },
}));
jest.mock("../modules/hr/models/Observation", () => ({
  Observation: {
    create: (d: unknown) => mockObsCreate(d),
    find: (q: unknown) => mockObsFind(q),
  },
}));
jest.mock("../modules/hr/models/Appraisal", () => {
  // The service does `new Appraisal({...})` for the create-fresh path.
  function Appraisal(this: Record<string, unknown>, data: Record<string, unknown>) {
    Object.assign(this, data);
    this.save = async () => undefined;
  }
  (Appraisal as unknown as { findOne: unknown }).findOne = (q: unknown) => mockApprFindOne(q);
  (Appraisal as unknown as { findById: unknown }).findById = (id: unknown) => mockApprFindById(id);
  (Appraisal as unknown as { create: unknown }).create = (d: unknown) => mockApprCreate(d);
  return { Appraisal };
});
jest.mock("../modules/hr/models/DevelopmentLog", () => ({
  DevelopmentLog: {
    create: (d: unknown) => mockDevCreate(d),
    find: (q: unknown) => mockDevFind(q),
  },
}));
jest.mock("../modules/hr/models/Grievance", () => ({
  Grievance: {
    create: (d: unknown) => mockGriCreate(d),
    findById: (id: unknown) => mockGriFindById(id),
    find: (q: unknown) => mockGriFind(q),
  },
}));
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: {
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockStaffFindById(id) }) }),
    findByIdAndUpdate: (id: unknown, u: unknown) => mockStaffUpdate(id, u),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import {
  stageRank,
  isLiveForEscalation,
  nextAllowedStages,
  assertStageAllowed,
  PerformanceError,
} from "../modules/hr/services/conductLadder";
import { supervisoryCovers } from "../modules/hr/services/observationScope";
import type { ScopeItem } from "../modules/foundation/services/ScopeGrantService";
import {
  recordConductStep,
  recordConductHearing,
  finalizeConductStep,
  lapseExpiredConduct,
} from "../modules/hr/services/ConductService";
import {
  submitObservation,
  upsertAppraisal,
  signOffAppraisal,
} from "../modules/hr/services/PerformanceService";
import { raiseGrievance, updateGrievance } from "../modules/hr/services/GrievanceService";

beforeEach(() => jest.clearAllMocks());

// ===========================================================================
// Pure: conduct ladder (H5.3)
// ===========================================================================
describe("conduct ladder — order + fast-track (pure, H5.3)", () => {
  test("stageRank orders verbal<written<final<termination", () => {
    expect(stageRank("verbal")).toBe(0);
    expect(stageRank("written")).toBe(1);
    expect(stageRank("final")).toBe(2);
    expect(stageRank("termination")).toBe(3);
  });

  test("normal escalation: first step must be verbal, then written, etc. — no rung-skip", () => {
    expect(nextAllowedStages([], false)).toEqual(["verbal"]);
    expect(nextAllowedStages(["verbal"], false)).toEqual(["written"]);
    expect(nextAllowedStages(["verbal", "written"], false)).toEqual(["final"]);
    expect(nextAllowedStages(["verbal", "written", "final"], false)).toEqual(["termination"]);
    expect(nextAllowedStages(["verbal", "written", "final", "termination"], false)).toEqual([]);
  });

  test("assertStageAllowed rejects a skipped rung", () => {
    expect(() => assertStageAllowed("final", [], false)).toThrow(PerformanceError);
    expect(() => assertStageAllowed("written", ["verbal"], false)).not.toThrow();
    expect(() => assertStageAllowed("final", ["verbal"], false)).toThrow(/enforces order/);
  });

  test("gross misconduct may fast-track to final or termination, not verbal/written", () => {
    expect(nextAllowedStages([], true)).toEqual(["final", "termination"]);
    expect(() => assertStageAllowed("termination", [], true)).not.toThrow();
    expect(() => assertStageAllowed("final", [], true)).not.toThrow();
    expect(() => assertStageAllowed("verbal", [], true)).toThrow(/fast-track/);
  });

  test("isLiveForEscalation: only finalized counts; null liveUntil never lapses; past liveUntil is dead", () => {
    const now = new Date("2026-06-13T00:00:00Z");
    expect(isLiveForEscalation({ status: "draft", liveUntil: null }, now)).toBe(false);
    expect(isLiveForEscalation({ status: "finalized", liveUntil: null }, now)).toBe(true);
    expect(isLiveForEscalation({ status: "finalized", liveUntil: new Date("2026-12-31") }, now)).toBe(true);
    expect(isLiveForEscalation({ status: "finalized", liveUntil: new Date("2026-01-01") }, now)).toBe(false);
    expect(isLiveForEscalation({ status: "lapsed", liveUntil: null }, now)).toBe(false);
  });
});

// ===========================================================================
// Pure: supervisory observation scope (D-#28)
// ===========================================================================
describe("supervisoryCovers — bounded observation write (pure, D-#28)", () => {
  const C1 = "class1", C2 = "class2", S1 = "subj1", S2 = "subj2";
  const teaching: ScopeItem = { kind: "teaching", classId: C1, sectionId: "sec1", subjectId: S1 };

  test("teaching/proxy scope does NOT grant observation write (supervisory only)", () => {
    expect(supervisoryCovers([teaching], C1, S1)).toBe(false);
    expect(supervisoryCovers([{ kind: "proxy", classId: C1, sectionId: "sec1", grantId: "g" }], C1, S1)).toBe(false);
  });

  test("whole_school covers any class/subject", () => {
    const sup: ScopeItem = { kind: "supervisory", extent: "whole_school" };
    expect(supervisoryCovers([sup], C2, S2)).toBe(true);
    expect(supervisoryCovers([sup], C1, null)).toBe(true);
  });

  test("grade_class matches the class only", () => {
    const sup: ScopeItem = { kind: "supervisory", extent: "grade_class", classId: C1 };
    expect(supervisoryCovers([sup], C1, S2)).toBe(true);
    expect(supervisoryCovers([sup], C2, S2)).toBe(false);
  });

  test("subject_dept matches the subject only", () => {
    const sup: ScopeItem = { kind: "supervisory", extent: "subject_dept", subjectId: S1 };
    expect(supervisoryCovers([sup], C2, S1)).toBe(true);
    expect(supervisoryCovers([sup], C2, S2)).toBe(false);
  });

  test("explicit_set matches a (class, subject) pair", () => {
    const sup: ScopeItem = { kind: "supervisory", extent: "explicit_set", explicitSet: [{ classId: C1, subjectId: S1 }] };
    expect(supervisoryCovers([sup], C1, S1)).toBe(true);
    expect(supervisoryCovers([sup], C1, S2)).toBe(false);
  });

  test("an observation with NEITHER class nor subject is not coverable (default-deny)", () => {
    expect(supervisoryCovers([{ kind: "supervisory", extent: "whole_school" }], null, null)).toBe(false);
  });
});

// ===========================================================================
// ConductService (mocked models)
// ===========================================================================
describe("ConductService — ladder enforcement + due process (H5.3, D-#113)", () => {
  test("recordConductStep enforces the ladder order (cannot start at final)", async () => {
    mockStaffFindById.mockResolvedValue({ active: true });
    mockConductFind.mockReturnValue(leanChain([])); // no live finalized stages
    await expect(
      recordConductStep({ staffProfileId: oid().toString(), stage: "final", issue: "x", actorId: oid().toString() }),
    ).rejects.toThrow(/enforces order/);
    expect(mockConductCreate).not.toHaveBeenCalled();
  });

  test("recordConductStep creates a draft verbal step + audits", async () => {
    const id = oid();
    mockStaffFindById.mockResolvedValue({ active: true });
    mockConductFind.mockReturnValue(leanChain([]));
    mockConductCreate.mockResolvedValue({ _id: id, stage: "verbal", status: "draft" });
    const rec = await recordConductStep({ staffProfileId: oid().toString(), stage: "verbal", issue: "late repeatedly", actorId: oid().toString() });
    expect(rec.stage).toBe("verbal");
    expect(mockConductCreate).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CONDUCT_STEP_RECORDED" }));
  });

  test("gross misconduct can fast-track to termination with no prior steps", async () => {
    mockStaffFindById.mockResolvedValue({ active: true });
    mockConductFind.mockReturnValue(leanChain([]));
    mockConductCreate.mockResolvedValue({ _id: oid(), stage: "termination", status: "draft" });
    await expect(
      recordConductStep({ staffProfileId: oid().toString(), stage: "termination", issue: "theft", grossMisconduct: true, actorId: oid().toString() }),
    ).resolves.toBeDefined();
  });

  test("finalize is BLOCKED until the hearing is recorded ('adl)", async () => {
    const doc: Record<string, unknown> = { _id: oid(), staffProfileId: oid(), stage: "verbal", status: "draft", hearingHeldAt: null, save: jest.fn() };
    mockConductFindById.mockResolvedValue(doc);
    await expect(
      finalizeConductStep({ recordId: doc._id!.toString(), actorId: oid().toString() }),
    ).rejects.toThrow(/hearing must be recorded before/);
  });

  test("hearing → finalize verbal succeeds (not a termination)", async () => {
    const save = jest.fn();
    const doc: Record<string, unknown> = { _id: oid(), staffProfileId: oid(), stage: "verbal", status: "draft", save };
    mockConductFindById.mockResolvedValue(doc);
    await recordConductHearing(doc._id!.toString(), "explained, warned", oid().toString());
    expect(doc.status).toBe("hearing_held");
    expect(doc.hearingHeldAt).toBeInstanceOf(Date);
    await finalizeConductStep({ recordId: doc._id!.toString(), actorId: oid().toString() });
    expect(doc.status).toBe("finalized");
    expect(mockStaffUpdate).not.toHaveBeenCalled(); // verbal does not terminate
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CONDUCT_STEP_FINALIZED" }));
  });

  test("finalizing a termination step writes employmentStatus terminated + STAFF_TERMINATED audit", async () => {
    const staffId = oid();
    const doc: Record<string, unknown> = {
      _id: oid(), staffProfileId: staffId, stage: "termination", status: "hearing_held",
      hearingHeldAt: new Date(), save: jest.fn(),
    };
    mockConductFindById.mockResolvedValue(doc);
    await finalizeConductStep({ recordId: doc._id!.toString(), actorId: oid().toString() });
    expect(mockStaffUpdate).toHaveBeenCalledWith(staffId, { employmentStatus: "terminated" });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "STAFF_TERMINATED" }));
  });

  test("lapseExpiredConduct stamps finalized→lapsed + audits (lazy lapse)", async () => {
    const id = oid();
    mockConductFind.mockReturnValue(leanChain([{ _id: id, stage: "verbal", liveUntil: new Date("2020-01-01") }]));
    await lapseExpiredConduct(oid().toString(), new Date("2026-06-13"));
    expect(mockConductUpdateOne).toHaveBeenCalledWith({ _id: id, status: "finalized" }, { status: "lapsed" });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CONDUCT_WARNING_LAPSED" }));
  });
});

// ===========================================================================
// PerformanceService (mocked models)
// ===========================================================================
describe("PerformanceService — observation / appraisal / CPD (H5.1/H5.2/H5.4)", () => {
  test("submitObservation persists + audits OBSERVATION_SUBMITTED", async () => {
    mockStaffFindById.mockResolvedValue({ _id: oid() });
    mockObsCreate.mockResolvedValue({ _id: oid(), notes: "good lesson" });
    await submitObservation({ staffProfileId: oid().toString(), observerId: oid().toString(), dateKey: "2026-06-13", notes: "good lesson", classId: oid().toString() });
    expect(mockObsCreate).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "OBSERVATION_SUBMITTED" }));
  });

  test("upsertAppraisal refuses to edit a signed-off appraisal (immutable)", async () => {
    mockApprFindOne.mockResolvedValue({ status: "signed_off", save: jest.fn() });
    await expect(
      upsertAppraisal({ staffProfileId: oid().toString(), academicYearId: oid().toString(), actorId: oid().toString() }),
    ).rejects.toThrow(/immutable/);
  });

  test("signOffAppraisal sets the outcome, locks, and EMITS development needs → CPD log (H5.4)", async () => {
    const save = jest.fn();
    const doc: Record<string, unknown> = {
      _id: oid(), staffProfileId: oid(), status: "draft",
      developmentNeeds: ["Phonics workshop", "Classroom mgmt course"], save,
    };
    mockApprFindById.mockResolvedValue(doc);
    mockDevCreate.mockResolvedValue({ _id: oid() });
    await signOffAppraisal({ appraisalId: doc._id!.toString(), outcome: "meets", actorId: oid().toString() });
    expect(doc.status).toBe("signed_off");
    expect(doc.overallOutcome).toBe("meets");
    expect(mockDevCreate).toHaveBeenCalledTimes(2); // one CPD row per development need
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "APPRAISAL_SIGNED_OFF" }));
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "DEVELOPMENT_LOGGED" }));
  });

  test("signOffAppraisal rejects an already-signed appraisal + an unknown outcome", async () => {
    mockApprFindById.mockResolvedValue({ status: "signed_off", developmentNeeds: [], save: jest.fn() });
    await expect(signOffAppraisal({ appraisalId: oid().toString(), outcome: "meets", actorId: oid().toString() })).rejects.toThrow(/already signed off/);
    mockApprFindById.mockResolvedValue({ status: "draft", developmentNeeds: [], save: jest.fn() });
    await expect(signOffAppraisal({ appraisalId: oid().toString(), outcome: "bogus" as never, actorId: oid().toString() })).rejects.toThrow(/Unknown appraisal outcome/);
  });
});

// ===========================================================================
// GrievanceService (mocked models)
// ===========================================================================
describe("GrievanceService — confidential staff-raised channel (H5.4)", () => {
  test("raiseGrievance opens a grievance + audits GRIEVANCE_RAISED", async () => {
    mockGriCreate.mockResolvedValue({ _id: oid(), status: "open" });
    await raiseGrievance({ raisedByStaffProfileId: oid().toString(), subject: "workload", detail: "too many sections", actorId: oid().toString() });
    expect(mockGriCreate).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "GRIEVANCE_RAISED" }));
  });

  test("updateGrievance moves status + records the handler", async () => {
    const save = jest.fn();
    const doc: Record<string, unknown> = { _id: oid(), status: "open", save };
    mockGriFindById.mockResolvedValue(doc);
    await updateGrievance({ grievanceId: doc._id!.toString(), status: "resolved", resolutionNote: "reassigned", actorId: oid().toString() });
    expect(doc.status).toBe("resolved");
    expect(doc.handledAt).toBeInstanceOf(Date);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "GRIEVANCE_UPDATED" }));
  });

  test("updateGrievance rejects an unknown status", async () => {
    mockGriFindById.mockResolvedValue({ status: "open", save: jest.fn() });
    await expect(updateGrievance({ grievanceId: oid().toString(), status: "bogus" as never, actorId: oid().toString() })).rejects.toThrow(/Unknown grievance status/);
  });
});
