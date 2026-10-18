/**
 * D-#764 — login lockout: 5 wrong passwords on an account, or 30 from one network, within
 * 2 h ⇒ refused for 2 h. D-#765 — GraphiQL + introspection off outside development.
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createSchema, createYoga } from "graphql-yoga";
import { User } from "../modules/foundation/models/User";
import { Guardian } from "../modules/foundation/models/Guardian";
import { Audit } from "../modules/platform/models/Audit";
import { LoginThrottle } from "../modules/foundation/models/LoginThrottle";
import { guardianLogin, hashPassword, staffLogin } from "../modules/foundation/services/AuthService";
import { resetStaffPassword } from "../modules/foundation/services/ProvisioningService";
import {
  IP_FAIL_LIMIT,
  LOGIN_BLOCK_MS,
  LOGIN_WINDOW_MS,
  LoginBlockedError,
  accountKey,
  assertLoginAllowed,
  ipKey,
  recordLoginFailure,
} from "../modules/foundation/services/LoginThrottleService";
import { maskErrorExposingDomain } from "../observability/errorMask";
import { clientIpFrom } from "../clientIp";
import { graphqlDevToolsOptions } from "../graphqlDevTools";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let teacherId: string;
let guardianId: string;
let rightHash: string;
const PHONE = "01711000001";
const GUARDIAN_PHONE = "01811000002";
const RIGHT = "right-password";

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  const passwordHash = (rightHash = await hashPassword(RIGHT));
  teacherId = (await User.create({ phone: PHONE, name: "শিক্ষক", role: "TEACHER", passwordHash }))._id.toString();
  guardianId = (
    await Guardian.create({
      identifierKind: "phone",
      identifier: GUARDIAN_PHONE,
      phone: GUARDIAN_PHONE,
      name: "অভিভাবক",
      passwordHash,
      loginEnabled: true,
    })
  )._id.toString();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await LoginThrottle.deleteMany({});
  // The reset test gives the teacher a new password; every test starts from RIGHT.
  await User.updateOne({ _id: teacherId }, { $set: { passwordHash: rightHash } });
});

const wrongStaff = (ip: string | null = "203.0.113.5") => staffLogin({ email: PHONE, password: "nope", ip });
const wrongGuardian = (ip: string | null = "203.0.113.5") =>
  guardianLogin({ identifier: GUARDIAN_PHONE, identifierKind: "phone", password: "nope", ip });

describe("account lockout (D-#764)", () => {
  it("blocks the 5th wrong password and then refuses even the right one", async () => {
    for (let i = 0; i < 4; i++) await expect(wrongStaff()).resolves.toBeNull();
    // Four wrong is still a working account.
    await expect(assertLoginAllowed(accountKey("User", teacherId))).resolves.toBeUndefined();

    await expect(wrongStaff()).resolves.toBeNull();
    const refused = staffLogin({ email: PHONE, password: RIGHT, ip: "198.51.100.9" });
    await expect(refused).rejects.toBeInstanceOf(LoginBlockedError);
    await expect(staffLogin({ email: PHONE, password: RIGHT })).rejects.toThrow(/২ ঘণ্টা/);

    const blocked = await Audit.findOne({ actorId: teacherId, "meta.reason": "account_blocked" }).lean();
    expect(blocked).not.toBeNull();
    const fifth = await Audit.findOne({ actorId: teacherId, "meta.lockedOut": true }).lean();
    expect(fifth).not.toBeNull();
  });

  it("a right password clears the count", async () => {
    for (let i = 0; i < 4; i++) await wrongStaff();
    await expect(staffLogin({ email: PHONE, password: RIGHT })).resolves.not.toBeNull();
    for (let i = 0; i < 4; i++) await wrongStaff();
    await expect(staffLogin({ email: PHONE, password: RIGHT })).resolves.not.toBeNull();
  });

  it("counts per account: the guardian path has its own fuse, unknown ids count for nothing", async () => {
    for (let i = 0; i < 5; i++) await wrongGuardian();
    await expect(guardianLogin({ identifier: GUARDIAN_PHONE, identifierKind: "phone", password: RIGHT })).rejects.toBeInstanceOf(
      LoginBlockedError,
    );
    // The staff account is untouched by the guardian's failures.
    await expect(staffLogin({ email: PHONE, password: RIGHT })).resolves.not.toBeNull();
    // The app's staff-first attempt for a guardian (no such User) checks no password and counts nothing.
    for (let i = 0; i < 10; i++) await staffLogin({ email: "01999999999", password: "x", ip: "203.0.113.77" });
    expect(await LoginThrottle.countDocuments({ key: ipKey("203.0.113.77") })).toBe(0);
  });

  it("a password reset lifts the block", async () => {
    for (let i = 0; i < 5; i++) await wrongStaff();
    await expect(staffLogin({ email: PHONE, password: RIGHT })).rejects.toBeInstanceOf(LoginBlockedError);
    const cred = await resetStaffPassword(teacherId, { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" });
    await expect(staffLogin({ email: PHONE, password: cred.password })).resolves.not.toBeNull();
  });

  it("the block lasts 2 hours and the count window is 2 hours", async () => {
    const t0 = new Date("2026-10-18T08:00:00Z");
    const at = (ms: number) => new Date(t0.getTime() + ms);
    const key = accountKey("User", "x");
    for (let i = 0; i < 4; i++) await recordLoginFailure(key, 5, t0);
    // The 5th lands after the window closed ⇒ a fresh count of 1, no block.
    await expect(recordLoginFailure(key, 5, at(LOGIN_WINDOW_MS + 1000))).resolves.toBe(false);
    for (let i = 0; i < 3; i++) await recordLoginFailure(key, 5, at(LOGIN_WINDOW_MS + 2000));
    await expect(recordLoginFailure(key, 5, at(LOGIN_WINDOW_MS + 3000))).resolves.toBe(true);

    const blockedAt = at(LOGIN_WINDOW_MS + 3000);
    await expect(assertLoginAllowed(key, new Date(blockedAt.getTime() + LOGIN_BLOCK_MS - 60_000))).rejects.toThrow(/১ মিনিট/);
    await expect(assertLoginAllowed(key, new Date(blockedAt.getTime() + LOGIN_BLOCK_MS + 1000))).resolves.toBeUndefined();
  });
});

describe("network lockout (D-#764)", () => {
  it("30 wrong passwords from one address block that address only", async () => {
    const ip = "203.0.113.200";
    for (let i = 0; i < IP_FAIL_LIMIT - 1; i++) await recordLoginFailure(ipKey(ip), IP_FAIL_LIMIT);
    await expect(staffLogin({ email: PHONE, password: RIGHT, ip })).resolves.not.toBeNull();
    await wrongGuardian(ip); // the 30th, on another account
    await expect(staffLogin({ email: PHONE, password: RIGHT, ip })).rejects.toThrow(/এই নেটওয়ার্ক/);
    // Another network is unaffected, and so is the account (it had no failures).
    await expect(staffLogin({ email: PHONE, password: RIGHT, ip: "198.51.100.1" })).resolves.not.toBeNull();
    expect(await Audit.findOne({ "meta.reason": "ip_blocked", "meta.ip": ip }).lean()).not.toBeNull();
  });

  it("the refusal reaches the person as a sentence, not 'Unexpected error'", () => {
    const err = new LoginBlockedError("অনেকবার ভুল পাসওয়ার্ড");
    const masked = maskErrorExposingDomain({ originalError: err }, "Unexpected error.");
    expect(masked.message).toBe("অনেকবার ভুল পাসওয়ার্ড");
  });

  it("reads the caller's address: X-Real-IP, then CF-Connecting-IP, then the first X-Forwarded-For", () => {
    const h = (o: Record<string, string>) => (k: string) => o[k] ?? null;
    expect(clientIpFrom(h({ "x-real-ip": "1.1.1.1", "cf-connecting-ip": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIpFrom(h({ "cf-connecting-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" }))).toBe("2.2.2.2");
    expect(clientIpFrom(h({ "x-forwarded-for": "3.3.3.3, 10.0.0.1" }))).toBe("3.3.3.3");
    expect(clientIpFrom(h({}))).toBeNull();
  });
});

describe("GraphQL developer tools (D-#765)", () => {
  const schema = createSchema({ typeDefs: "type Query { ok: Boolean }", resolvers: { Query: { ok: () => true } } });
  const run = async (nodeEnv: string | undefined, query: string) => {
    const opts = graphqlDevToolsOptions(nodeEnv);
    const yoga = createYoga({ schema, graphiql: opts.graphiql, plugins: opts.plugins, logging: false });
    const res = await yoga.fetch("http://x/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    return (await res.json()) as { data?: unknown; errors?: unknown[] };
  };

  it.each([["production"], [undefined], ["test"]])("introspection is refused when NODE_ENV=%s", async (env) => {
    const out = await run(env, "{ __schema { queryType { name } } }");
    expect(out.errors?.length).toBeGreaterThan(0);
    expect(graphqlDevToolsOptions(env).graphiql).toBe(false);
  });

  it("ordinary queries and __typename still work with introspection off", async () => {
    const out = await run("production", "{ ok __typename }");
    expect(out).toEqual({ data: { ok: true, __typename: "Query" } });
  });

  it("a developer's machine keeps both", async () => {
    const out = await run("development", "{ __schema { queryType { name } } }");
    expect(out).toEqual({ data: { __schema: { queryType: { name: "Query" } } } });
    expect(graphqlDevToolsOptions("development").graphiql).toBe(true);
  });
});
