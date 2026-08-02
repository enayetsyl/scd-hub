# book-pipeline — the VENDORED render pipeline

**Do not modify anything in this folder.**

This is a verbatim copy of the standalone `studybook-pipeline` that produced the first
সহায়িকা (C1-BAN: 54 lessons, 493 blocks, 201 image slots, both editions rendered). It
is **vendored and spawned, never ported** — D-#407.

## Why it is copied rather than rewritten

`ASSEMBLY.md` §1's discipline is that the frozen renderer core is never edited for
support-book needs. A TypeScript port would be a fork that drifts, silently, from the
only version anyone has actually proven against a real chapter. The four invariants it
carries each exist because they caught a real silent failure:

- **four embedded Noto faces or throw** — no OS fallback, so যুক্তবর্ণ can never
  degrade to tofu on a different machine;
- **geometry assert** — refuses to render if the laid-out page is off by >0.5 mm
  (the inches-inside-mm 0.75-scale bug);
- **text-fit guard** — fails the build on overflow, because a silently clipped Bangla
  sentence is worse than a failed build;
- **post-render font audit** — inflates the PDF and rejects any face that is not one
  of the four, which is the last line of defence against Chrome substituting Nirmala
  UI for a Bengali glyph.

## How the app uses it

`server/src/modules/support-book/services/BookRenderRunner.ts` spawns
`src/validate-studybook.js` and then `src/build-book.js` with `execFile`, an argument
array and `shell: false`. Nothing imports from this folder.

`BOOK_PIPELINE_ROOT` overrides the location (defaults to `book-pipeline`).

## Deliberately NOT an npm workspace

The root `package.json` lists `shared`, `server`, `app` — this package is **not** among
them, on purpose. As a workspace, every `npm install` and every CI run would install
`puppeteer` and `sharp` for a package CI never executes. It gets its own `npm install`
on the machine that actually renders.

## What was NOT copied

`content/` (real book data — that lives in the database, D-#403/#406), `out/`
(generated PDFs), `node_modules/`, and the layout backups.

## Host requirements (measured, D-#413/#422/#423)

| Need | State |
|---|---|
| `chromium-browser` + `PUPPETEER_EXECUTABLE_PATH` | **to install** — Puppeteer ships no linux-arm64 binary |
| `python3-pil` (Pillow) | **to install** — Python 3.12.3 is present, Pillow is not |
| `pdffonts` (poppler-utils) | already installed |
| `sharp` arm64 prebuilds | available; also now the upscaler everywhere (D-#422) |

Verify Chromium launches **under the systemd unit**, not only an interactive shell —
snap confinement is where this bites.

## Fonts

The four TTFs are SIL Open Font License. They are committed because a missing TTF must
throw rather than silently fall back, and a render host that has to fetch fonts at
build time is a render host that will one day render tofu.
