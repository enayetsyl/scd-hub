/**
 * Observability — notification-delivery monitoring (MON-4, prd-observability.md §4).
 *
 * DB-free unit cover for the push silent-failure path: `deliveryFailureCodes` (which Expo
 * push ticket errors are SURFACED to GlitchTip — every error EXCEPT the routine
 * DeviceNotRegistered prune) + `capturePushDeliveryFailure` is inert when Sentry is
 * disabled (jest has no DSN). The ticker-heartbeat (`getTickerHealth`) is covered in
 * notificationsScheduler.test.ts, which already mocks the tick's DB dependencies.
 */
import { deliveryFailureCodes } from "../modules/platform/services/ExpoPush";
import { capturePushDeliveryFailure } from "../observability/sentry";

describe("MON-4 — push delivery failure surfacing", () => {
  it("surfaces non-DeviceNotRegistered error tickets, skips the routine prune", () => {
    const tickets = [
      { status: "ok" as const },
      { status: "error" as const, details: { error: "DeviceNotRegistered" } }, // routine prune — skip
      { status: "error" as const, details: { error: "MessageRateExceeded" } },
      { status: "error" as const, details: { error: "MessageTooBig" } },
      { status: "error" as const, message: "Internal server error" }, // no details.error → fall back
    ];
    expect(deliveryFailureCodes(tickets)).toEqual([
      "MessageRateExceeded",
      "MessageTooBig",
      "Internal server error",
    ]);
  });

  it("returns [] when nothing failed (no flooding)", () => {
    expect(deliveryFailureCodes([{ status: "ok" }, { status: "ok" }])).toEqual([]);
    expect(deliveryFailureCodes([{ status: "error", details: { error: "DeviceNotRegistered" } }])).toEqual([]);
  });

  it("capturePushDeliveryFailure is a safe no-op when Sentry is disabled", () => {
    expect(() => capturePushDeliveryFailure({ errorCode: "MessageTooBig", recipientCount: 1 })).not.toThrow();
  });
});
