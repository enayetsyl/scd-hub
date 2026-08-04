/**
 * Draft-autosave invariants for the observation review form (owner ask 2026-08-03).
 *
 * `useFormDraft` mirrors everything an observer types to this device so a reload or a
 * dropped connection does not lose a long review. Two things about the CALLER, not the
 * hook, would silently break it — silently because the form keeps working either way
 * and only the recovery path is wrong:
 *
 *   1. the draft key must be scoped to the USER as well as the observation. Drop the
 *      user id and, on the shared staff device, the second observer to open the same
 *      observation is handed the first one's half-written judgements.
 *   2. `clear()` must run after a SUCCESSFUL submit. Miss it and returning to the
 *      screen restores a draft of a review that was already sent — the observer
 *      re-reads their own submitted text as if it were unsaved.
 *
 * Static source reads, deliberately: the app workspace has no test runner (see
 * navInitialRoute.test.ts for the same reasoning), and these are properties of how the
 * screen is WIRED, which is exactly what a reader can get wrong later.
 */
import { readFileSync } from "fs";
import path from "path";

const SCREEN = path.resolve(__dirname, "../../../app/src/screens/observation/ReviewObservationScreen.tsx");
const HOOK = path.resolve(__dirname, "../../../app/src/lib/useFormDraft.ts");

const screenSrc = readFileSync(SCREEN, "utf8");
const hookSrc = readFileSync(HOOK, "utf8");

describe("observation review draft — wiring invariants", () => {
  test("the draft key is scoped to the observation AND the user", () => {
    // e.g. `obs-review:${observationId}:${user.id}`
    const call = screenSrc.match(/useFormDraft\(\s*([\s\S]*?)\n\s*\);/);
    expect(call).not.toBeNull();
    const keyArg = call![1];
    expect(keyArg).toContain("observationId");
    expect(keyArg).toMatch(/user[?.]*\.id/);
  });

  test("a successful submit clears the draft", () => {
    // The clear must sit inside the `res.data` success branch — not before the
    // mutation, and not on the error path.
    const success = screenSrc.match(/if \(res\.data\) \{([\s\S]*?)\n {4}\}/);
    expect(success).not.toBeNull();
    expect(success![1]).toContain("draft.clear()");
  });

  test("nothing about the draft is sent to the server", () => {
    // The draft is local by design: a half-finished review must not become a record
    // other people can see. The snapshot may reach the hook, and nowhere else — so
    // it must not appear anywhere in the submit path.
    const submit = screenSrc.match(/async function onSubmit\(\)[\s\S]*?\n {2}\}/);
    expect(submit).not.toBeNull();
    expect(submit![0]).not.toContain("draftSnapshot");
  });
});

describe("useFormDraft — the write-after-restore guard", () => {
  test("writes are gated until the stored draft has been handed back", () => {
    // Without this gate the first debounced write fires with the form's EMPTY initial
    // snapshot and overwrites the stored draft before restore has read it — the draft
    // is destroyed by the act of opening the form, which is the worst possible failure
    // for a feature whose whole job is not losing typing.
    expect(hookSrc).toMatch(/readyToWrite\.current = false/);
    expect(hookSrc).toMatch(/readyToWrite\.current = true/);
    const write = hookSrc.match(/---- write \(debounced\)[\s\S]*?\}, \[storageKey, serialised\]\);/);
    expect(write).not.toBeNull();
    expect(write![0]).toContain("!readyToWrite.current");
  });

  test("a storage failure can never break the form being typed into", () => {
    // Quota on web, SecureStore's 2048-byte value cap on Android. Losing a draft is a
    // nuisance; throwing out of the render path loses the form.
    const bodies = hookSrc.match(/catch \{[\s\S]*?\}/g) ?? [];
    expect(bodies.length).toBeGreaterThanOrEqual(3); // read, write, remove
    for (const b of bodies) expect(b).not.toMatch(/throw/);
  });
});
