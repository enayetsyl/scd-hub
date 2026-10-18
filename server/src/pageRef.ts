/**
 * pageRef (D-#761): register the GraphQL page type for one row type, in the
 * `{ rows, total, page, pageSize }` shape of `lib/paging.ts`.
 *
 *   const NotificationPageRef = pageRef("NotificationPage", NotificationRef);
 *   builder.queryField("myNotificationsPage", (t) => t.field({
 *     type: NotificationPageRef,
 *     args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }), ... },
 *     resolve: (_r, args, ctx) => myNotificationsPage(ctx.auth!.userId, args),
 *   }));
 *
 * Lives beside `schema.ts` (not in `lib/`) because it needs the builder; `lib/paging.ts`
 * stays importable from services without pulling GraphQL in.
 */
import type { OutputRef } from "@pothos/core";
import { builder } from "./schema";
import type { Page } from "./lib/paging";

export function pageRef<T>(name: string, rowRef: OutputRef<T>) {
  const ref = builder.objectRef<Page<T>>(name);
  ref.implement({
    description: `One page of ${name.replace(/Page$/, "")} rows (D-#761). page is 1-based; total counts every match.`,
    fields: (t) => ({
      rows: t.field({ type: [rowRef], resolve: (p) => p.rows }),
      total: t.exposeInt("total"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });
  return ref;
}
