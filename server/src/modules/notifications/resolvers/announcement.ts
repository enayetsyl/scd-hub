/**
 * The guardian announcement query (D-#700).
 *
 * `authenticated: true` rather than a permission, and the audience test lives in
 * the service: the shell asks this for whoever is signed in, and staff simply get
 * null. A permission here would mean every staff render logged a refusal for a
 * question that has a perfectly good answer — "nothing for you".
 */
import { builder } from "../../../schema";
import { myAnnouncement, type AnnouncementShape } from "../services/AnnouncementService";

const AnnouncementRef = builder.objectRef<AnnouncementShape>("GuardianAnnouncement").implement({
  description:
    "A short school-wide message shown to guardians as a popup on their first app open of the " +
    "day, for a fixed date window. Null when nothing is live.",
  fields: (t) => ({
    id: t.exposeString("id"),
    titleBn: t.exposeString("titleBn"),
    bodyBn: t.exposeString("bodyBn"),
    ctaBn: t.exposeString("ctaBn"),
    deepLinkTab: t.exposeString("deepLinkTab"),
    todayKey: t.exposeString("todayKey", {
      description:
        "Today in Asia/Dhaka as the SERVER reckons it. The client compares its stored " +
        "last-shown key against this rather than computing a date itself — a wrong device " +
        "clock must not change which day the school thinks it is.",
    }),
  }),
});

builder.queryField("myAnnouncement", (t) =>
  t.field({
    type: AnnouncementRef,
    nullable: true,
    description:
      "The live announcement for the signed-in guardian today, or null. Never throws: it is " +
      "read on every app open inside the authenticated shell, so a failure here must not be " +
      "able to take the app down (the 791e5fe rule).",
    authScopes: { authenticated: true },
    resolve: async (_r, _a, ctx) => myAnnouncement(ctx),
  }),
);
