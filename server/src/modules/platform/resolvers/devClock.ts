/**
 * AL-14: the dev-site clock, as the app sees it. PUBLIC on purpose (the app asks before anyone signs in) and it can
 * reveal nothing but the shifted day: `active` is false with null fields on every site where the clock is not on
 * (prod always - `installDevClock` refuses without DEV_CLOCK_ALLOWED=1 and a `_dev` database).
 */
import { builder } from "../../../schema";
import { devClockState } from "../../../lib/devClockInstall";

const DevClockRef = builder.objectRef<{ active: boolean; todayKey: string | null; offsetMs: number | null }>("DevClock").implement({
  fields: (t) => ({
    active: t.exposeBoolean("active"),
    todayKey: t.exposeString("todayKey", { nullable: true }),
    offsetMs: t.exposeFloat("offsetMs", { nullable: true }),
  }),
});

builder.queryField("devClock", (t) =>
  t.field({
    type: DevClockRef,
    description: "The dev site's shifted clock (AL-14); active=false everywhere else.",
    resolve: () => devClockState(),
  }),
);
