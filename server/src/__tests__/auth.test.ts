/**
 * Auth unit tests — password hashing and token payload shape.
 * No DB connection required (pure logic + bcrypt).
 */

import { hashPassword, verifyPassword } from "../modules/foundation/services/AuthService";

describe("hashPassword / verifyPassword", () => {
  test("hashes a password and verifies it", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash).not.toBe("correct-horse-battery");
    expect(hash.startsWith("$2")).toBe(true); // bcrypt prefix
    await expect(verifyPassword("correct-horse-battery", hash)).resolves.toBe(true);
  });

  test("rejects a wrong password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  test("two hashes of the same password differ (salted)", async () => {
    const h1 = await hashPassword("same-password");
    const h2 = await hashPassword("same-password");
    expect(h1).not.toBe(h2);
  });
});
