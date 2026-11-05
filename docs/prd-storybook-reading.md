# Storybook shelf (গল্পের বই) — lending the school's own storybooks (D-#980–#987, #990)

**Owner ask (2026-11-03):** the school has written 12 storybook series (272 titles, all 16-page landscape A4,
ages 3–6, mostly Bangla + English). Put them in the app as a catalogue guardians can browse, lend the physical
books from the office, show guardians what their child has read (week / month / year), and feed reading into a
new "all-rounder" card on Today. Plan + wireframes (owner-reviewed, 8 revisions):
https://claude.ai/artifact/UimqLqkkQJbnpUfoyLPq1e (Part A).

**Built on the library module** (`server/src/modules/library`, prd-library.md, D-#81–#84). Storybooks are
library titles with a series layer. There is no second library: copies, loans, waitlist (BookReservation), policy and the
guardian loans card are reused.

## Settled (owner, 2026-11-03)
| # | Rule |
|---|---|
| Lending | Single books, returned. No fee. Never a whole series to one child. Any working day at the office. |
| Limit | Max 2 books at once (policy data); a dated **holiday rule** raises it and moves due dates. 7-day loan; renew only when nobody waits. |
| Copies | 1–2 copies per title, rotated. Codes `SERIES-BOOK-COPY` (TRE-07-1). QR stickers printed from the office PC. |
| Age bands | Data. 3–6 → Nursery, KG, Class 1; 7–9 → Classes 2–4 (later series). **Guardians see only their child's band; borrowing is never restricted by band.** |
| Availability | Guardians see in / out-until / N waiting per title. |
| Waitlist | Guardian joins in the app; the desk adds a child in person. A returned book is held **2 working days** for the first in line. |
| Read | The desk ticks "read" at return (no guardian tick). A sticker is given for a read book. |
| Alerts | Book issued / held book ready / sticker: notification + pop-up + Today card. |
| Desk | QR scan in the app (`expo-camera`, next APK); typed code works until then. The desk may type the child's school ID (numeric match) instead of searching. |
| Catalogue | Office uploads a PDF per book (draft → publish); only the cover + 3 preview pages are kept, never the whole book. Managed tag list (rename/merge, bulk tag). Series edit/hide; book retire keeps history. |
| Bangla text | Read from rendered cover / back pages (PDF text extraction breaks Bangla conjuncts); Office spot-checks before import. |

## Data
| Model | |
|---|---|
| `StoryAgeBand` new | code, labelBn, ageMin, ageMax, classLevels[], sortOrder, active. Read-time defaults when no rows exist (D-#97 pattern): `3-6` → [-1, 0, 1], `7-9` → [2, 3, 4]. |
| `StoryTag` new | nameBn, nameEn, active. Rename updates every book (books hold tag ids); merge moves ids then deactivates. |
| `StorySeries` new | code (2–4 letters, unique), nameBn, nameEn, ageBandCode, tagIds, aboutBn, learnPointsBn[], coverFileId, sortOrder, status DRAFT / PUBLISHED / HIDDEN. |
| `BookTitle` extend | + seriesId, seriesNo, tagIds, learnedPointsBn[], parentTipBn, coverFileId, previewFileIds[], draft (default false — existing library titles are unaffected). Retire = existing `active: false`. |
| StoredFile kind | `storybook_page` — cover / preview / series-cover JPEG. Read gate: staff `library:view`; a guardian only for a published title or series of a band one of their linked, active children is in. |

## Who can do what
| Caller | Can | Gate |
|---|---|---|
| Guardian | Browse their child's band: series, titles, availability, preview pages, the child's own history | `guardian:read_child` + `assertGuardianOfStudent` |
| Staff | Browse everything incl. drafts | `library:view` |
| Office | Upload books, edit series / tags / bands, publish, retire | `library:edit` |
| Desk | Issue / return / read tick / sticker (SB-2) | existing `library:lend` / `library:return` + `assertIsLibrarian` |

## Slices
- **SB-1 Catalogue.** Models above. `POST /files/storybook` upload (multipart PDF ≤ 60 MB → renders, keeps
  cover + previews, creates a DRAFT title in a series). Series / tag / band CRUD, publish, retire. Guardian
  queries `storyShelf(studentId)`, `storySeries(studentId, seriesId)`, `storyBook(studentId, titleId)`,
  `storyBookPage`. App: guardian গল্পের বই (W1–W3, minus the waitlist button); staff series & upload screens
  (W11/W12). Import script for the 12 folders (separate data step, run by the owner).
- **SB-2 Desk & rules.** Bulk copy creation with generated codes + QR sticker PDF; issue / return with
  read tick + sticker; 2-book limit; holiday rule; school-ID lookup.
- **SB-3 Waitlist.** Guardian join / leave (cap 2 per child); desk add; 2-working-day hold; ready alert; pass on expiry.
- **SB-4 Guardian view & alerts.** "My child's books" replaces the loans card; counts; stickers; alerts.
- **SB-5 QR scanning (APK).** `expo-camera` scanning; ships with the next APK (all ABIs).
- **SB-6 Reports.** Series, book, readers, waitlist demand (`reports:storybook_*` switches).
- **SB-7 All-rounder card.** Score + bands on Today and the staff profile (D-#987).

## Owner-unconfirmed defaults (D-#990)
Waitlist cap 2 per child; a held book does not use a loan slot until collected; same-day return still counts
as read; one alert per loan event; an overdue book blocks new loans (no fines); monthly reading target 4 for the
3–6 band.

## Out of scope
Fines or any money; whole-series hand-over; the full book in the app; guardian "read together" tick.
