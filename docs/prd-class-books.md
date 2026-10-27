# Class books — guardians read the classroom books in the app (D-#870)

**Owner ask (2026-10-26):** the Nursery Bangla, English, Math (Bangla) and Math (English) books are not
given to students; they stay in class for practice. Guardians therefore don't know which letter goes with
which word (or what a page practises) and can't guide at home. Put the books in the app, **view only, not
downloadable**, in their own sidebar tab, and tell the guardians with a pop-up.

## What it does
- **Guardian — বই** (sidebar, right under আজ): the books of the selected child's class, page by page.
  Page turn by ‹ / › buttons, a sideways swipe, ← / → keys on the web, or "go to page"; বড় / ছোট zoom.
  A family with children in two classes switches with the child chooser.
- **Staff — শ্রেণির বই** (`class_books:view`, every teacher and the Office): every class's books.
- **Office — upload** (`class_books:manage`): class + book name + order → pick the PDF (≤ 60 MB). The server
  renders every page to a JPEG (150 dpi, quality 80, ~100 KB a page) in the background — the shelf shows
  "পৃষ্ঠা তৈরি হচ্ছে…" until it is ready. Rename, re-order, move class, hide/show, delete.

## View only — what that means here
- The PDF is **not kept**. Only page images exist, in Drive (`SCD-Hub-Files/<year>/class-books`, StoredFile
  kind `class_book_page`), and the app receives **one page at a time** (`classBookPage` → data URI).
- The reader has no download, share or print control; the page sits under a transparent cover so the browser
  offers no "save image", and the right-click menu is off while a book is open on the web.
- A screenshot cannot be stopped. That is the honest limit, accepted for practice books.

## Who can read what
| caller | books | gate |
|---|---|---|
| Guardian | READY, visible books of the class levels their linked, active children are in | `guardian:read_child` + `guardianClassLevels` in `ClassBookService` |
| Staff | every book (hidden / failed included on the shelf) | `class_books:view` or `class_books:manage` |
| `GET /files/:id` for a page id | the same book gate | `assertClassBookFileReadAccess` |

A book is keyed by the roster **class level** (−1 Nursery … 5), not a year's Class row: the printed book
serves the level, and next session's edition replaces it by upload.

## Pieces
- Server: `modules/class-books/` (model `ClassBook`, `ClassBookService`, `pdfPages` = poppler `pdftoppm`,
  resolvers), `POST /files/class-book` in `routes/files.ts`. Pages are cached in memory (80 MB LRU).
  poppler-utils is on the VM; `scripts/vm-bootstrap.sh` now installs it on a rebuild.
- App: `screens/classbooks/` (shelf + reader), routes `ClassBooksTab` (staff) / `GuardianBooksTab` (guardian),
  guardian view surface `BOOKS` (engagement report), pop-up composer can open `GuardianBooksTab`.
- Audit: `CLASS_BOOK_UPLOADED`, `CLASS_BOOK_EDITED`, `CLASS_BOOK_DELETED`.

## The guardian pop-up
Sent through the pop-up notices (D-#852) after the four books are uploaded on prod: audience = guardians of
**Nursery** (class level −1), shown **once**, ✕ to close, one button **বই দেখুন** → `GuardianBooksTab`.
Text (BN, with EN):

> **নতুন: নার্সারির ক্লাসের বই এখন অ্যাপে**
> প্রিয় অভিভাবক, নার্সারির বাংলা, English, গণিত (বাংলা) ও Math (English) — এই চারটি বই ক্লাসে রেখে অনুশীলন
> করানো হয়, তাই বাড়িতে থাকে না। এখন বইগুলো অ্যাপের মেনুতে "বই" অংশে পাতা উল্টে দেখতে পারবেন। কোন অক্ষরের
> সাথে কোন শব্দ বা ছবি, কোন পাতায় কী অনুশীলন — দেখে বাড়িতে সন্তানকে সাহায্য করুন। বইগুলো শুধু দেখা যাবে,
> ডাউনলোড করা যাবে না।

Phones need the OTA for the বই tab; an old bundle ignores the button target (the pop-up just closes).

## Not in this slice
রওদাতুল আতফাল (Arabic) and KG / other classes' books — the same upload serves them whenever the Office adds them.
