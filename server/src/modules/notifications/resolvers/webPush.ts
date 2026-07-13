/**
 * Web-push registration resolvers (D-#296). Any authenticated account (staff or
 * guardian) may register the browser it just granted the permission in; the
 * subscription is stored against the CALLER only — you cannot register a push
 * endpoint for somebody else. Write-only surface: endpoints/keys are send
 * credentials and are never readable back.
 */
import { Types } from "mongoose";
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { WebPushSubscription } from "../models/WebPushSubscription";
import { webPushPublicKey } from "../services/webPushChannel";

builder.queryField("webPushPublicKey", (t) =>
  t.string({
    nullable: true,
    description:
      "The server's VAPID public key for browser push (D-#296) — null when push is not configured.",
    authScopes: { authenticated: true },
    resolve: () => webPushPublicKey(),
  }),
);

const ownerOf = (auth: { userId: string; role: string }): Record<string, Types.ObjectId> =>
  auth.role === "GUARDIAN"
    ? { guardianId: new Types.ObjectId(auth.userId) }
    : { userId: new Types.ObjectId(auth.userId) };

builder.mutationField("registerWebPush", (t) =>
  t.boolean({
    description:
      "Save this browser's push subscription for the CALLER (D-#296). Upserts on the endpoint, " +
      "so re-enabling or a key rotation overwrites cleanly.",
    authScopes: { authenticated: true },
    args: {
      endpoint: t.arg.string({ required: true }),
      p256dh: t.arg.string({ required: true }),
      auth: t.arg.string({ required: true }),
      userAgent: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (!/^https:\/\//.test(args.endpoint)) throw new Error("Invalid push endpoint");
      await WebPushSubscription.findOneAndUpdate(
        { endpoint: args.endpoint },
        {
          $set: {
            ...ownerOf(ctx.auth as { userId: string; role: string }),
            p256dh: args.p256dh,
            auth: args.auth,
            ...(args.userAgent ? { userAgent: args.userAgent.slice(0, 300) } : {}),
          },
          // A browser re-registered by a DIFFERENT account moves to the new owner:
          // clear the other owner field so the XOR invariant holds.
          $unset:
            (ctx.auth as { role: string }).role === "GUARDIAN" ? { userId: "" } : { guardianId: "" },
        },
        { upsert: true },
      );
      return true;
    },
  }),
);

builder.mutationField("unregisterWebPush", (t) =>
  t.boolean({
    description: "Remove this browser's push subscription (the account-menu toggle OFF, D-#296).",
    authScopes: { authenticated: true },
    args: { endpoint: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      // Only the owner's own row can be removed — the endpoint alone is not enough.
      await WebPushSubscription.deleteOne({
        endpoint: args.endpoint,
        ...ownerOf(ctx.auth as { userId: string; role: string }),
      });
      return true;
    },
  }),
);
