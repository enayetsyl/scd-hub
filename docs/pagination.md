# Pagination standard (D-#761)

Every list that **grows over time** pages from its first version. "Grows over time" means
it gains rows per day, per student, per test or per year. Examples: history, records,
results, comments, requests, notifications, logs, imports, tasks and audit entries.

Lists that stay naturally small, such as classes, subjects, staff (~25), one section's
roster (~30) or one day's periods, need no paging.

## The two mistakes this replaces

1. **Unbounded read.** `Model.find(filter)` with no limit and no window. The list works in
   week one and becomes a 2,000-row scroll by year two. The server reads the whole history
   on every visit.
2. **Silent cap.** `.limit(100)` with no way past it. Older rows simply vanish, and a short
   list reads as "that's everything". The bell badge can count a notification the list
   can no longer show.

## The shape

One wire shape everywhere. It is the shape `assignablePlansPage` (D-#559) already used:

```graphql
type XPage { rows: [X!]!  total: Int!  page: Int!  pageSize: Int! }
xPage(<filters>, page: Int, pageSize: Int): XPage!   # page is 1-based
```

- Defaults: `pageSize` 50, maximum 200 (`DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE`).
- `total` counts every match, so the screen can show "Page 2 / 7".
- Sort is stable and newest first, unless the list has a natural order (name, roll number).

## Server

```ts
// service
import { queryPage, pageOf, type PageArgs } from "../../../lib/paging";

export function myThingsPage(userId: string, args: PageArgs) {
  return queryPage(Thing, { userId }, { createdAt: -1, _id: -1 }, args, (docs) => docs.map(toDTO));
}
// derived rows (joins / computed) the service builds in memory anyway:
//   return pageOf(rows, args);

// resolver
import { pageRef } from "../../../pageRef";
const ThingPageRef = pageRef("ThingPage", ThingRef);
builder.queryField("myThingsPage", (t) => t.field({
  type: ThingPageRef,
  args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
  resolve: (_r, args, ctx) => myThingsPage(ctx.auth!.userId, args),
}));
```

- **Use `queryPage`** whenever the list is a plain `find`. Skip and limit run in the database.
- **Use `pageOf`** only when the rows are computed in memory (joins, derived states). The
  wire and the screen still get one page.
- **Join names for the page only.** Map the 50 rows, not the whole history.
- Add an index on `filter fields + sort fields` when the collection is large.

### Backward compatibility (hard rule)

After a deploy, phones keep running the previous bundle until their next cold start (the
OTA lands then), and they call the same server. So:

- **Add** `xPage` beside the existing `x` query. Never change `x`'s return shape or its
  default behaviour.
- The new screen code calls `xPage`. The old query stays until no supported bundle uses it.

## Client

| The server... | Use |
|---|---|
| returns a `<name>Page` (unbounded data) | `usePageState(resetKey)` → pass `page` + `pageSize: PAGE_SIZE` as variables, render `<Pager page pageSize total onPage>` |
| already bounds the data (one month, a chosen date window, one section's open items) and the payload is modest | `usePagedRows(rows, { resetKey })` → render `shown`, then `<Pager {...pager} />` |
| is a guardian history walking back from today | `LoadOlder` (D-#476) widening the date window |

```tsx
import { Pager } from "../../components/Pager";
import { usePageState, PAGE_SIZE } from "../../lib/paging";

const [page, setPage] = usePageState(`${classLevel}|${subject}`);   // filters → back to page 1
const [q] = useQuery({ query: MY_THINGS_PAGE, variables: { page, pageSize: PAGE_SIZE } });
const p = q.data?.myThingsPage;
...
{p?.rows.map(renderRow)}
<Pager page={page} pageSize={PAGE_SIZE} total={p?.total ?? 0} onPage={setPage} />
```

- **`resetKey` must include every filter.** A new filter never opens on an empty page 7.
- **Counts come from `total`**, not `rows.length`: "959 documents" is the total, not the page.
- **Select-all** on a paged list selects the current page. Say so in the button text if
  it matters.
- A `FlatList` limits rendering only; it is not paging. The server still sends everything.

## Review checklist for a new list screen

- [ ] Does this list gain rows over time? If yes, it is paged.
- [ ] No `.find()` without a limit or a bounded window on a growing collection.
- [ ] No `.limit(N)` that silently hides older rows.
- [ ] `total` drives the count and the pager. Filters reset to page 1.
- [ ] The old query is untouched if released bundles call it.
