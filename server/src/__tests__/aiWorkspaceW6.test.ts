/**
 * AI Workspace W-6 — migration + pilot (docs/prd-ai-workspace.md §8).
 *   • planImport: newest version of each document, the Markdown copy over the .docx, no
 *     working folders, only readable formats — shaped on scd-central's canon/refs
 *   • the pilot score: owner only, usable | minor | rewrite, stamped with the version
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { planImport } from "../modules/ai-workspace/services/importPlan";
import { createAiProject, setAiProjectMembers } from "../modules/ai-workspace/services/AiProjectService";
import { createDraft, scoreDraft, saveDraftVersion } from "../modules/ai-workspace/services/DraftService";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

describe("planImport", () => {
  const f = (path: string, sizeBytes = 100) => ({ path, sizeBytes });
  it("keeps the newest version and the Markdown copy; says why each other file is left out", () => {
    const plan = planImport([
      f("canon/refs/LOCKED_REF-09_Tier1_Question_Setting_Guidelines_v1_0.md"),
      f("canon/refs/LOCKED_REF-09_Tier1_Question_Setting_Guidelines_v1_1.md"),
      f("canon/refs/Bloom_Taxonomy_Comprehensive_Primer_Teachers_V1A.docx"),
      f("canon/refs/Bloom_Taxonomy_Comprehensive_Primer_Teachers_V1A.md"),
      f("canon/refs/LOCKED_REF-22_English_Controlled_WordBank_C1-C5_v1_0.xlsx"),
      f("canon/refs/LOCKED_REF-03_Math_Subject_Spine_Playbook_v1_0.md"),
      f("canon/refs/LOCKED_REF-03_Math_Subject_Spine_Playbook_v1_10.md"),
      f("canon/_wip/draft.md"),
      f("archive/old/REF.md"),
      f("canon/refs/diagram.png"),
      f("canon/refs/empty.md", 0),
    ]);
    expect(plan.keep.map((k) => k.path)).toEqual([
      "canon/refs/Bloom_Taxonomy_Comprehensive_Primer_Teachers_V1A.md",
      "canon/refs/LOCKED_REF-03_Math_Subject_Spine_Playbook_v1_10.md",
      "canon/refs/LOCKED_REF-09_Tier1_Question_Setting_Guidelines_v1_1.md",
      "canon/refs/LOCKED_REF-22_English_Controlled_WordBank_C1-C5_v1_0.xlsx",
    ]);
    const why = Object.fromEntries(plan.skip.map((s) => [s.path, s.reason]));
    expect(why["canon/refs/LOCKED_REF-09_Tier1_Question_Setting_Guidelines_v1_0.md"]).toContain("older version");
    expect(why["canon/refs/LOCKED_REF-03_Math_Subject_Spine_Playbook_v1_0.md"]).toContain("older version");
    expect(why["canon/refs/Bloom_Taxonomy_Comprehensive_Primer_Teachers_V1A.docx"]).toContain("another format");
    expect(why["canon/_wip/draft.md"]).toBe("working folder");
    expect(why["archive/old/REF.md"]).toBe("working folder");
    expect(why["canon/refs/diagram.png"]).toContain("not a readable format");
    expect(why["canon/refs/empty.md"]).toBe("empty");
  });

  it("the same name in different folders is two documents; Windows paths are normalised", () => {
    const plan = planImport([f("a\\README.md"), f("b\\README.md")]);
    expect(plan.keep.map((k) => k.path)).toEqual(["a/README.md", "b/README.md"]);
  });
});

describe("the pilot score", () => {
  let mongo: MongoMemoryServer;
  const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
  const editor: AuthPayload = { userId: new Types.ObjectId().toString(), role: "TEACHER", grantedPermissions: ["ai_workspace:use"] };
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
    await User.create([
      { _id: principal.userId, role: "PRINCIPAL", name: "Head Teacher", phone: "01700000001", passwordHash: "x" },
      { _id: editor.userId, role: "TEACHER", name: "Editor", phone: "01700000002", passwordHash: "x", grantedPermissions: ["ai_workspace:use"] },
    ]);
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it("the owner scores a draft; the score names the version; editors cannot", async () => {
    const p = await createAiProject(principal, { name: "Pilot", nameProtection: false });
    await setAiProjectMembers(principal, p.id, [{ userId: principal.userId, role: "owner" }, { userId: editor.userId, role: "editor" }]);
    const d = await createDraft(editor, p.id, { title: "C1 Bangla s1", kind: "free", body: "খসড়া এক" });
    await expect(scoreDraft(editor, d.id, { score: "usable" })).rejects.toThrow("মালিক");
    await expect(scoreDraft(principal, d.id, { score: "great" })).rejects.toThrow("সঠিক নয়");
    expect((await scoreDraft(principal, d.id, { score: "minor", note: "দুটি শব্দ বদলাতে হবে" })).review).toMatchObject({ score: "minor", version: 1, byName: "Head Teacher", note: "দুটি শব্দ বদলাতে হবে" });
    await saveDraftVersion(editor, d.id, { body: "খসড়া দুই" });
    expect((await scoreDraft(principal, d.id, { score: "usable" })).review).toMatchObject({ score: "usable", version: 2 });
  });
});
