/**
 * Data assistant DA-4 — connections screens' service (docs/prd-data-assistant-mcp.md §11):
 * `myDataConnections` lists only the person's own clients; `allDataConnectionsPage` needs
 * `data_assistant:audit` and is paged; revoke by the owner and by the Principal; audit rows.
 * Tokens are seeded directly (the OAuth flow itself is dataAssistantMcp.test.ts).
 */
import { Types } from "mongoose";
import { AiOAuthToken } from "../modules/ai-workspace/models/AiOAuth";
import { Audit } from "../modules/platform/models/Audit";
import { AiDataCall } from "../modules/data-assistant/models/AiDataCall";
import { allDataConnectionsPage, myDataConnections, revokeDataConnection } from "../modules/data-assistant/services/DataConnectionService";
import { setupFixtures, teardownFixtures, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(120_000);
let fx: Fx;
beforeAll(async () => {
  fx = await setupFixtures();
});
afterAll(async () => teardownFixtures(fx));

let n = 0;
async function connect(userId: string, clientId: string, resource: "data" | "workspace" = "data"): Promise<void> {
  const now = Date.now();
  n++;
  await AiOAuthToken.create({
    accessHash: `a${n}`,
    refreshHash: `r${n}`,
    clientId,
    clientName: clientId === "c-claude" ? "Claude" : "Other",
    userId: new Types.ObjectId(userId),
    resource,
    grantedAt: new Date(now),
    accessExpiresAt: new Date(now + 3600_000),
    refreshExpiresAt: new Date(now + 30 * 86_400_000),
  });
}

beforeEach(async () => {
  await AiOAuthToken.deleteMany({});
  await Audit.deleteMany({});
  await connect(fx.auth.principal.userId, "c-claude");
  await connect(fx.auth.office.userId, "c-claude");
  await connect(fx.auth.office.userId, "c-other");
  await connect(fx.auth.office.userId, "c-ws", "workspace"); // a workspace token is not a data connection
});

it("myDataConnections: own data clients only, with the 90-day end and 30-day calls", async () => {
  await AiDataCall.create({ at: new Date(), userId: new Types.ObjectId(fx.auth.office.userId), role: "OFFICE", surface: "claude", clientId: "c-claude", clientName: "Claude", tool: "my_access", outcome: "ok" });
  const mine = await myDataConnections(fx.auth.office);
  expect(mine.map((c) => c.clientId).sort()).toEqual(["c-claude", "c-other"]);
  const claude = mine.find((c) => c.clientId === "c-claude")!;
  expect(claude.calls30d).toBe(1);
  expect(claude.expiresAt.getTime() - claude.connectedAt.getTime()).toBe(90 * 86_400_000);
  expect((await myDataConnections(fx.auth.principal)).map((c) => c.clientId)).toEqual(["c-claude"]);
  await expect(myDataConnections(fx.auth.guardian)).rejects.toThrow();
});

it("allDataConnectionsPage: the Principal only, paged", async () => {
  await expect(allDataConnectionsPage(fx.auth.office, {})).rejects.toThrow();
  const p = await allDataConnectionsPage(fx.auth.principal, { page: 1, pageSize: 2 });
  expect(p).toMatchObject({ total: 3, page: 1, pageSize: 2 });
  expect(p.rows).toHaveLength(2);
  expect(p.rows.every((r) => r.userName)).toBe(true);
});

it("revoke: the owner their own; the Principal anyone's; Office not someone else's; audited", async () => {
  await expect(revokeDataConnection(fx.auth.office, "c-claude", fx.auth.principal.userId)).rejects.toThrow();
  expect(await revokeDataConnection(fx.auth.office, "c-other")).toBe(true);
  expect((await myDataConnections(fx.auth.office)).map((c) => c.clientId)).toEqual(["c-claude"]);
  expect(await revokeDataConnection(fx.auth.principal, "c-claude", fx.auth.office.userId)).toBe(true);
  expect(await myDataConnections(fx.auth.office)).toEqual([]);
  // The workspace token is untouched by a data disconnect.
  expect(await AiOAuthToken.countDocuments({ clientId: "c-ws", revokedAt: null })).toBe(1);
  const audits = await Audit.find({ eventKind: "DATA_MCP_REVOKED" }).lean();
  expect(audits).toHaveLength(2);
  expect(audits.every((a) => (a.meta as { reason?: string })?.reason === "disconnect")).toBe(true);
  expect(await revokeDataConnection(fx.auth.office, "c-none")).toBe(false);
});
