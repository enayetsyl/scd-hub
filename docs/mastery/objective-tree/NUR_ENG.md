# Objective tree (draft) — NUR ENG · নার্সারি · ইংরেজি

> Generated from `NUR_ENG.tree.json` (the source of truth) — edit the JSON, not this file. Contract: `docs/prd-objective-tree.md`.

- **Status:** DRAFT — Claude draft for review by Mahzabin; the Principal locks. Codes become permanent at lock.
- **Book:** Nursery (English) 2026 — English (Nursery), Session 2026, Sabr Ver 1.0 (Mohammadpur branch printed workbook; printed pages 1–47) · read 2026-11-12
  - `Mohammadpur Materials/Nursery Books (Session 2026)/Nursery (English) 2026/Nursery (English) 2026 Book (Indesign) Sabr Ver 1.0 (outlined).pdf (49-page PDF; the text is outlined, so every page was read as an image)`
  - `Annual Exam Syllabus-2026 (SCD Sylhet).md (নার্সারি — ইংরেজি: Written ও Oral-এর ধরন)`
  - `repo: server/assets/exam-papers/annual-2026/L-1-ENG.json (অ্যাপে প্রকাশিত ২০২৬ বার্ষিক মানবন্টন — ৯ সারি, নম্বরসহ)`
  - `repo: docs/prd-worksheets.md, docs/prd-viva.md (worksheet-এর প্রশ্নের ধরন ও মৌখিক পরীক্ষার সেট)`
- **Counts:** 3 domains used · 7 objectives · 5 sub-objectives · 1 skill strands · **11 tagged rows**
- **Coverage:** 58 / 58 activity blocks mapped to a tagged row (0 unmapped). exercisesTotal = the book's activity blocks (58): the book numbers no exercises, so every headed activity on a page is one block — 26 letter pages, 10 review pages with two blocks each (first letter + write the letters), and 12 blocks on pages 37–47 (page 44 has two: AFTER, BEFORE). ref = section/page heading/printed page number.

Exercise refs read `section/page heading/page number` — section = a group of pages on one topic (the book has no chapters; see Flags), heading = the page's printed heading or instruction (a letter page is named by its letter and picture words), page = the printed page number. Codes are written without the `LO-NUR-ENG-` prefix; an earlier class's code reads `NUR·02-01.2` (the cross-class ladder). Labels are English (the app shows ENG labels in English); home tips are Bangla.

## বর্ণ ও ধ্বনি `DOM-ENG-PHON`

### `01-01` Name each letter when shown, capital and small

- অংশ 1 · Letters A–Z: name, trace, picture words, first letter · বইয়ের নির্দেশনা: "Pages 1–34: one big capital letter per page with its small letter; "Alphabet Chart — CAPITAL LETTERS / small letters" [বইয়ের নির্দেশনা] (page 47). No instruction is printed on the letter pages."
- অভিভাবকের জন্য বাড়ির টিপস: A থেকে Z বড় হাতের ও ছোট হাতের অক্ষর আলাদা কাগজে লিখে এলোমেলো করে দেখান; শিক্ষার্থী নাম বলুক। b–d, p–q, m–n বারবার মিলিয়ে দেখান।

| Code | Label | Tagged | Book ref (pages) | Assess | QT | Prereq | Claude note |
|---|---|---|---|---|---|---|---|
| `01-01` | Name each letter when shown, capital and small | ✓ | 1/A (ant, apple) … Z (zebra, zoo)/1–5, 8–12, 15–19, 22–26, 29–34 (26 blocks); 3/Alphabet Chart/47 | রুব্রিক | QT-ORAL | — | One row for capital and small: the book teaches them on the same page, and the written check of capital ↔ small is its own row (02-04). Ask each child alone, letters out of order — saying A to Z in a chorus is a teaching method, not the check. |

### `01-03` Look at a picture and write the first letter of its word

- অংশ 1 · Letters A–Z: name, trace, picture words, first letter · বইয়ের নির্দেশনা: ""Look at the pictures and write the first letter in capital" / "… in small" [বইয়ের নির্দেশনা] — one pair of pages after every five letters (10 pages)."
- অভিভাবকের জন্য বাড়ির টিপস: বাড়ির চেনা জিনিস দেখিয়ে ইংরেজি নাম বলুন ("ball") ও জিজ্ঞেস করুন কোন অক্ষর দিয়ে শুরু; শিক্ষার্থী অক্ষরটি বলে খাতায় লিখুক — একবার বড় হাতের, একবার ছোট হাতের।

| Code | Label | Tagged | Book ref (pages) | Assess | QT | Prereq | Claude note |
|---|---|---|---|---|---|---|---|
| `01-03` | Look at a picture and write the first letter of its word | ✓ | 1/Look at the pictures and write the first letter in capital … Look at the pictures and write the first letter in small/6–7, 13–14, 20–21, 27–28, 35–36 (10 blocks) | প্রশ্ন | QT-PICLETTER, QT-MATCHLETTER | 01-02 | worksheet kinds PICTURE_FIRST_LETTER (Q6) and MATCH_PICTURE_LETTER (Q8): both test the same step (first sound of the word → letter); the book only has the "write" form. Capital and small are not split here — which form the child cannot write shows in 02-01 and 02-04. |

### `02-01` Write the alphabet in order, capital and small

- অংশ 2 · The whole alphabet: order, missing letters, after and before, capital with small · বইয়ের নির্দেশনা: ""Write letters from A - E" … "Write letters from u - z"; "Write from A to Z"; "Write from a to z" [বইয়ের নির্দেশনা]"
- অভিভাবকের জন্য বাড়ির টিপস: প্রথমে A থেকে E, তারপর F থেকে J — এভাবে পাঁচটি করে না দেখে লিখতে দিন; শেষে A থেকে Z পুরোটা। বড় হাতের শেষ হলে একই ভাবে ছোট হাতের।

| Code | Label | Tagged | Book ref (pages) | Assess | QT | Prereq | Claude note |
|---|---|---|---|---|---|---|---|
| `02-01` | **Write the alphabet in order, capital and small** | — (adds up its sub-objectives) | | | | 01-01 | Capital and small are separate rows: many children write A–Z from memory but stop or reverse letters (b, d, p, q) in a–z. The exam question is capital only; the syllabus asks for both. |
| `02-01.1` | Write the capital letters A to Z in order | ✓ | 1/Write letters from A - E/6; 1/Write letters from F - J/13; 1/Write letters from K - O/20; 1/Write letters from P - T/27; 1/Write letters from U - Z/35; 2/Write from A to Z/39 | প্রশ্ন | QT-WRITESEQ | SK-HW-01 | worksheet kind WRITE_SEQUENCE (capital). Annual Q1, 15 marks. |
| `02-01.2` | Write the small letters a to z in order | ✓ | 1/Write letters from a - e/7; 1/Write letters from f - j/14; 1/Write letters from k - o/21; 1/Write letters from p - t/28; 1/Write letters from u - z/36; 2/Write from a to z/40 | প্রশ্ন | QT-WRITESEQ | 02-01.1 | worksheet kind WRITE_SEQUENCE (small). Not a separate exam question in 2026 (Q1 is capital only); the syllabus line is "Writing both upper and lower case letters". |

### `02-02` Alphabet order: the missing letter, the letter after and the letter before

- অংশ 2 · The whole alphabet: order, missing letters, after and before, capital with small · বইয়ের নির্দেশনা: ""Fill in the gaps"; "AFTER"; "BEFORE" [বইয়ের নির্দেশনা]"
- অভিভাবকের জন্য বাড়ির টিপস: একটি অক্ষর বলে জিজ্ঞেস করুন "g-এর পরে কোন অক্ষর? g-এর আগে কোন অক্ষর?" প্রথমে বইয়ের Alphabet Chart সামনে রেখে, পরে না দেখে।

| Code | Label | Tagged | Book ref (pages) | Assess | QT | Prereq | Claude note |
|---|---|---|---|---|---|---|---|
| `02-02` | **Alphabet order: the missing letter, the letter after and the letter before** | — (adds up its sub-objectives) | | | | 02-01 | Three separate exam questions that fail apart: "before" is the hardest (the child must think backwards), "after" the easiest. |
| `02-02.1` | Fill in the missing letters of the alphabet | ✓ | 2/Fill in the gaps/38; 2/Fill in the gaps/42 | প্রশ্ন | QT-FILL | — | worksheet kind FILL_MISSING. The exam question is small letters only; the book practises both. |
| `02-02.2` | Write the letter that comes after | ✓ | 2/AFTER/44 | প্রশ্ন | QT-AFTER | — | worksheet kind AFTER. The book practises small letters only. |
| `02-02.3` | Write the letter that comes before | ✓ | 2/BEFORE/44 | প্রশ্ন | QT-BEFORE | 02-02.2 | worksheet kind BEFORE. The book practises small letters only. |

### `02-03` Put jumbled letters in alphabet order

- অংশ 2 · The whole alphabet: order, missing letters, after and before, capital with small · বইয়ের নির্দেশনা: ""Rearrange" [বইয়ের নির্দেশনা] — page 37 (capital, 8 sets), page 43 (small, 8 sets)"
- অভিভাবকের জন্য বাড়ির টিপস: পাঁচটি অক্ষর এলোমেলো করে লিখে দিন (D F B E C); শিক্ষার্থী ক্রমে সাজিয়ে লিখুক (B C D E F)।

| Code | Label | Tagged | Book ref (pages) | Assess | QT | Prereq | Claude note |
|---|---|---|---|---|---|---|---|
| `02-03` | Put jumbled letters in alphabet order | ✓ | 2/Rearrange/37; 2/Rearrange/43 | প্রশ্ন | QT-REARRANGE | 02-01 | worksheet kind REARRANGE (Q2, two sets of five). Capital and small in one row: the skill is the order, not the letter form. |

### `02-04` Write the small letter for a capital letter and the capital for a small letter

- অংশ 2 · The whole alphabet: order, missing letters, after and before, capital with small · বইয়ের নির্দেশনা: ""বড় হাতের letter এর সাথে ছোট হাতের LETTER লিখি" (page 45); "ছোট হাতের letter এর সাথে বড় হাতের LETTER লিখি" (page 46) [বইয়ের নির্দেশনা]; page 41 (Aa Bb … Zz, no heading)."
- অভিভাবকের জন্য বাড়ির টিপস: একটি বড় হাতের অক্ষর লিখে দিন (G), শিক্ষার্থী পাশে ছোট হাতেরটি লিখুক (g); পরে উল্টো। যে জোড়া দেখতে আলাদা (A–a, B–b, D–d, G–g, Q–q, R–r) সেগুলো বেশি করান।

| Code | Label | Tagged | Book ref (pages) | Assess | QT | Prereq | Claude note |
|---|---|---|---|---|---|---|---|
| `02-04` | Write the small letter for a capital letter and the capital for a small letter | ✓ | 2/Aa Bb … Zz (no heading)/41; 2/বড় হাতের letter এর সাথে ছোট হাতের LETTER লিখি/45; 2/ছোট হাতের letter এর সাথে বড় হাতের LETTER লিখি/46 | প্রশ্ন | QT-CASE | 01-01, 02-01.2 | worksheet kind MATCH_CASE (Q7, 10×1) and the syllabus line "Matching capital with small letters". Both directions in one row: one question in the paper, and a child who knows the pair knows it both ways. |

## শব্দ ও অর্থ `DOM-ENG-VOCAB`

### `01-02` Say two words for each letter (from the pictures)

- অংশ 1 · Letters A–Z: name, trace, picture words, first letter · বইয়ের নির্দেশনা: "Each letter page shows two pictures with their words (A — ant, apple; B — ball, banana …). No instruction is printed."
- অভিভাবকের জন্য বাড়ির টিপস: একটি অক্ষর বলুন, শিক্ষার্থী সেই অক্ষরের দুটি শব্দ বলুক (B — ball, banana) ও বাংলা অর্থ বলুক। বইয়ের ছবি দেখিয়ে শুরু করুন, পরে ছবি ছাড়া।

| Code | Label | Tagged | Book ref (pages) | Assess | QT | Prereq | Claude note |
|---|---|---|---|---|---|---|---|
| `01-02` | Say two words for each letter (from the pictures) | ✓ | 1/A (ant, apple) … Z (zebra, zoo)/1–5, 8–12, 15–19, 22–26, 29–34 (26 blocks) | রুব্রিক | QT-ORAL | 01-01 | The oral exam's letter question (viva: "2 words with each letter", 5 letters × 2 words × ½) and the syllabus line "Memorising 2 words with each letter, with meaning". For X the book's words are ox and six (x is the last letter). |

## Skill strands (cross-section)

### `SK-HW-01` Trace and form the capital and small letters on the four lines

- ক্ষেত্র: হাতের লেখা ও দেখে লেখা · বইয়ের নির্দেশনা: "Each letter page has three rows of dotted capital letters and three rows of dotted small letters (26 pages). No instruction is printed."
- অভিভাবকের জন্য বাড়ির টিপস: বইয়ের বিন্দু-অক্ষরের উপর ধীরে পেনসিল বোলাতে দিন — উপর থেকে নিচে, বাম থেকে ডানে। ছোট হাতের অক্ষর চার লাইনের কোন লাইনে বসে (g, j, p, q, y নিচে নামে) দেখিয়ে দিন।

| Code | Label | Tagged | Book ref (pages) | Assess | QT | Prereq | Claude note |
|---|---|---|---|---|---|---|---|
| `SK-HW-01` | Trace and form the capital and small letters on the four lines | ✓ | 1/A (ant, apple) … Z (zebra, zoo)/1–5, 8–12, 15–19, 22–26, 29–34 (26 blocks) | রুব্রিক | QT-RUBRIC | — | Handwriting is a class rubric, not an exam question. All 26 letter pages are one strand; naming the letter (01-01) and saying its two words (01-02) are the other two jobs of the same page. |

## Question types & marks (the published 2026 annual মানবন্টন rows, unchanged)

| Code | Question type | Marks each | Where in the exam |
|---|---|---|---|
| QT-WRITESEQ | Write the capital letters A–Z | ১৫ (পুরো প্রশ্ন) | বার্ষিক প্র. ১ (১×১৫) · worksheet kind WRITE_SEQUENCE · syllabus: "Writing both upper and lower case letters" |
| QT-REARRANGE | Rearrange the jumbled letters (2 sets × 5) | ৫ (প্রতি সেট) | বার্ষিক প্র. ২ (২×৫) · worksheet kind REARRANGE |
| QT-FILL | Fill in the missing letters (small letter) | ১ | বার্ষিক প্র. ৩ (১০×১) · worksheet kind FILL_MISSING |
| QT-AFTER | Write the letter after | ১ | বার্ষিক প্র. ৪ (১০×১) · worksheet kind AFTER |
| QT-BEFORE | Write the letter before | ১ | বার্ষিক প্র. ৫ (১০×১) · worksheet kind BEFORE |
| QT-PICLETTER | Look at the pictures and write the first letter | ১ | বার্ষিক প্র. ৬ (১০×১) · worksheet kind PICTURE_FIRST_LETTER |
| QT-CASE | Write the Capital letter with Small letter and the Small letter with Capital letter | ১ | বার্ষিক প্র. ৭ (১০×১) · worksheet kind MATCH_CASE |
| QT-MATCHLETTER | Match letters with pictures | ১ | বার্ষিক প্র. ৮ (১০×১) · worksheet kind MATCH_PICTURE_LETTER |
| QT-ORAL | Oral (rubric, 4 steps) | — (মৌখিক মোট ১৫) | বার্ষিক প্র. ৯ Oral (১৫) — অ্যাপের মৌখিক পরীক্ষা (viva): "2 words with each letter" ৫ অক্ষর = ৫, বাকি নামের তালিকা (days, months, colours …) |
| QT-RUBRIC | Seen in class (handwriting rubric) — outside the paper | — (লিখিত নম্বর নেই) | শ্রেণির ভিতরেই; বার্ষিক মানবন্টনে নেই |

## Coverage

Every one of the 58 activity blocks (every activity page of the book) maps to at least one tagged row.

## Flags

| Row | Kind | Flag |
|---|---|---|
| — | OTHER | শিখনফলগুলো বইয়ের পৃষ্ঠা থেকে অনুমান করা — বইয়ে শিক্ষক-নোট, ছাপা শিখনফল বা নম্বর বণ্টনের পরিশিষ্ট নেই। তাই প্রতিটি সারির "বইয়ের নির্দেশনা" হলো পৃষ্ঠার শিরোনাম বা নির্দেশ ([বইয়ের নির্দেশনা] চিহ্নিত); অক্ষরের পৃষ্ঠাগুলোতে কোনো নির্দেশ ছাপা নেই। |
| — | OTHER | বইয়ে অধ্যায় নেই। পৃষ্ঠাগুলো বিষয় ধরে তিন অংশে ভাগ করা হয়েছে, বইয়ের ক্রমে: ১ Letters A–Z (পৃ. ১–৩৬) · ২ The whole alphabet (৩৭–৪৬) · ৩ Alphabet chart (৪৭)। কোডের "অধ্যায়" সংখ্যা এই অংশের নম্বর। কভারেজ গোনা হয়েছে পৃষ্ঠার কাজ ধরে: প্রতিটি পৃষ্ঠার প্রতিটি শিরোনাম-যুক্ত কাজ একটি ব্লক (৫৮টি) — ঝালাই পৃষ্ঠায় দুটি করে (first letter + Write letters from …), পৃ. ৪৪-এ দুটি (AFTER, BEFORE)। |
| — | OTHER | প্রশ্নের ধরন ও নম্বর: সিলেট শাখার বার্ষিক সিলেবাস ২০২৬ (নার্সারি, ইংরেজি) শুধু ধরনগুলোর নাম দেয়, নম্বর দেয় না; নম্বর নেওয়া হয়েছে অ্যাপে প্রকাশিত একই সিলেবাসের মানবন্টন থেকে (repo: server/assets/exam-papers/annual-2026/L-1-ENG.json-এর syllabusRows — ৯ সারি, মোট ১০০)। মোহাম্মদপুরের "Marks Distribution - Annual Exam 2026" PDF প্রথম শ্রেণি থেকে শুরু — নার্সারি তাতে নেই। |
| — | OTHER | সিলেবাসের যে অংশ বইয়ে নেই, তার সারি করা হয়নি (বইয়ে চর্চা নেই): লিখিত "Writing own name"; মৌখিক Day's name, Month names, Colour names (৮), Body part names (৮), Family members (৪), ১০ fruits, ৬ flowers, ১০ animals, ৮ birds। মৌখিক ১৫ নম্বরের ১০-ই এই তালিকাগুলো থেকে। পর্যালোচক চাইলে "নতুন যোগ" দিয়ে নামের তালিকার একটি সারি (শব্দ ও অর্থ, রুব্রিক) যোগ করতে পারেন। |
| 02-01.2 | WORDING_RULE_CONFLICT | সিলেবাসে "Writing both upper and lower case letters", কিন্তু প্রকাশিত মানবন্টনের প্র. ১ শুধু "Write the capital letters A–Z" (১৫)। ছোট হাতের a–z ক্রমে লেখা বইয়ে চর্চা হয় (পৃ. ৭, ১৪, ২১, ২৮, ৩৬, ৪০), তাই সারি রাখা হয়েছে; পরীক্ষায় আসবে কি না ঠিক করা দরকার। একই ভাবে প্র. ৩ "Fill in the missing letters (small letter)" শুধু ছোট হাতের, আর প্র. ৪–৫ (after / before)-এর চর্চা বইয়ে শুধু ছোট হাতের অক্ষরে। |
| 01-03 | OTHER | বই-দলের জন্য: পৃ. ৩৬ "Look at the pictures and write the first letter in small" (u–z)-এর ছবিগুলো — সবজি (vegetables), পানি (water), মাঠ (yard?), বাক্স (box), টেবিলের নিচে বল (under?) — অক্ষরের পৃষ্ঠায় শেখানো শব্দ নয়, দুটি অস্পষ্ট, আর box-এ x প্রথম অক্ষর নয়। X-এর পৃষ্ঠার (পৃ. ৩২) শব্দ ox ও six-এও x শেষে। প্রশ্ন-ব্যাংকে X "first letter" প্রশ্নে নেওয়া যাবে না। |
| 01-02 | OTHER | বই-দলের জন্য: কয়েকটি ছবি-শব্দ ছোট শিশুর কাছে অস্পষ্ট বা বিমূর্ত — hot (পৃ. ১০, ধোঁয়া-ওঠা বাটি), year (পৃ. ৩৩, ক্যালেন্ডার), uniform (পৃ. ২৯), glass ও mug দুটি কাছাকাছি ছবি। সিলেবাসের মৌখিক অংশে শব্দের বাংলা অর্থও চাওয়া হয়, কিন্তু বইয়ে অর্থ ছাপা নেই। |
| 02-04 | OTHER | বই-দলের জন্য: পৃ. ৪১-এ (Aa Bb … Zz) কোনো শিরোনাম বা নির্দেশনা নেই। পৃ. ৪৫–৪৬-এর শিরোনাম বাংলা-ইংরেজি মিশিয়ে ছাপা ("বড় হাতের letter এর সাথে ছোট হাতের LETTER লিখি"); বইয়ের বাকি সব নির্দেশনা ইংরেজিতে। |
| 01-01 | OTHER | Claude দ্বিতীয় পাঠ (প্রস্তাব): অক্ষর চেনা এক সারি (বড় ও ছোট হাতের একসাথে)। ছোট হাতের b–d–p–q-তে আলাদা ভাবে আটকানো শিশু আছে; আলাদা দেখতে চাইলে .১ capital / .২ small ভাগ করা যায় — বইয়ে ছোট হাতের অক্ষর চেনার আলাদা পৃষ্ঠা নেই বলে ভাগ করা হয়নি। |
| 02-03 | OTHER | Claude দ্বিতীয় পাঠ (প্রস্তাব): "Rearrange" এক সারি (capital পৃ. ৩৭ + small পৃ. ৪৩), কারণ প্রশ্নপত্রে একটিই প্রশ্ন (২ সেট × ৫)। "Fill in the gaps"-ও এক সারি (capital পৃ. ৩৮ + small পৃ. ৪২)। |
| SK-HW-01 | OTHER | Claude দ্বিতীয় পাঠ (প্রস্তাব): অক্ষরের ২৬টি পৃষ্ঠার প্রতিটি তিন সারিতে উদ্ধৃত (চেনা ০১-০১, শব্দ বলা ০১-০২, হাত ঘোরানো SK-HW-01) — পৃষ্ঠায় তিনটি কাজই আছে, আলাদা শিরোনাম নেই। বইয়ে লেখার প্রস্তুতির (দাগ টানা) পৃষ্ঠা নেই — সেটি বাংলা বইয়ে (NUR·BAN ০১-০১)। |

## পর্যালোচকের নোট (মাহজাবিন — আগে পড়ুন)

**কীভাবে পড়বেন।** ✓ চিহ্নের প্রতিটি সারি একটি দক্ষতা — worksheet-এর প্রশ্ন, মৌখিক পরীক্ষা ও রুব্রিক এই সারি ধরেই ট্যাগ হবে। ✓ ছাড়া শিখনফল শুধু দল; অভিভাবকেরা শিখনফলের নাম (ইংরেজিতে) ও বাংলা টিপ দেখবেন। নার্সারির ইংরেজি বই মোহাম্মদপুর শাখার ছাপা কর্মপুস্তক — এতে শিক্ষক-নোট বা শিখনফল ছাপা নেই, তাই সব শিখনফল পৃষ্ঠার কাজ দেখে অনুমান করা। ক্ষেত্র নতুন বানানো হয়নি: `domains/ENG.json`-এর তিনটি ক্ষেত্র ব্যবহার হয়েছে (বর্ণ ও ধ্বনি · হাতের লেখা · শব্দ ও অর্থ); প্রথম শ্রেণির লক করা ক্ষেত্রে কোনো বদল নেই।

**আগে এগুলো দেখুন (Claude-এর বিচার):**
1. **অংশ ভাগ Claude-এর করা।** বইয়ে অধ্যায় নেই; ৪৭ পৃষ্ঠা তিন অংশে ভাগ (অক্ষর A–Z · পুরো বর্ণমালা · চার্ট)। ৫৮টি কাজের সবগুলো কোনো না কোনো সারিতে।
2. **অক্ষরের পৃষ্ঠা তিন সারিতে:** চেনা (০১-০১, মৌখিক), দুটি শব্দ বলা (০১-০২, মৌখিক), বিন্দু-অক্ষরে হাত ঘোরানো (SK-HW-01)।
3. **বড় হাতের ও ছোট হাতের ক্রমে লেখা আলাদা (০২-০১.১ / .২)।** পরীক্ষার প্র. ১ শুধু capital; ছোট হাতেরটি সিলেবাসে আছে, বইয়ে চর্চা আছে — সারি রাখা ঠিক আছে কি?
4. **প্র. ৬ ও প্র. ৮ এক সারিতে (০১-০৩):** "write the first letter" ও "Match letters with pictures" একই দক্ষতা; বইয়ে শুধু প্রথমটির পৃষ্ঠা।
5. **capital ↔ small দুই দিক এক সারি (০২-০৪)** — প্রশ্নপত্রে একটিই প্রশ্ন (প্র. ৭)।
6. **সিলেবাসে আছে, বইয়ে নেই — সারি করা হয়নি:** নিজের নাম লেখা; মৌখিক নামের তালিকা (days, months, colours, body parts, family, fruits, flowers, animals, birds)। মৌখিক ১৫ নম্বরের ১০-ই এই তালিকা থেকে — সারি চাইলে "নতুন যোগ" করুন।
7. **বইয়ের সমস্যা বই-দলের জন্য (ফ্ল্যাগ দেখুন):** X-এর শব্দে x প্রথম অক্ষর নয় (ox, six, box); পৃ. ৩৬-এর ছবিগুলো শেখানো শব্দ নয়; পৃ. ৪১-এ নির্দেশনা নেই; পৃ. ৪৫–৪৬-এর শিরোনাম মিশ্র ভাষায়; hot, year, uniform বিমূর্ত।

**আরবি:** নার্সারির আরবি বই (রওদাতুল আতফাল ১ম ভাগ) এই খসড়ার বাইরে — আরবির বৃক্ষ হবে কি না মালিক ঠিক করবেন।
