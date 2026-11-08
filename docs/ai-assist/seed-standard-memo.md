# Seed comment standards — memo (AI-3s, D-#1102)

**Status:** PROPOSED, awaiting owner review. Nothing is active, and the checker (AI-5) is not built.
**Drafts:** [comment-standard.md](comment-standard.md) (daily comments), [ct-comment-standard.md](ct-comment-standard.md) (class-test comments).
**Prepared:** 2026-11-08 by Claude Code, from production data. This repo is public, so this memo holds only counts; every example in the two drafts is invented, and no real comment is quoted.

## 1. What was read
- **Source:** `scdhub_prod`, read-only, through a script piped to the VM. Nothing was written to the database. Names, phones and ids were swapped for tokens on the VM before anything left it; see §4 for what the swap missed.
- **Daily comments (`StudentComment`):** 105, newest first, at most 12 per teacher per sentiment, July–November 2026, 15 teachers, Nursery to Class 4. The whole database holds only **195 comments, of which 7 are POSITIVE**, so the sample is 100 concerns plus 5 positives.
- **Class-test comments (`ClassTestResult`):** 200 PRESENT results with at least one comment, at most 20 per teacher, 13 teachers, KG to Class 5, every subject. Almost all are from October–November 2026. Each row carried its mark percentage: 60 rows at 80 %+, 67 at 60–79 %, 53 at 40–59 %, 20 below 40 %.
- **Counts:** regex counts over the text (the script is kept with the export, outside the repo), checked by reading every comment.

## 2. What was found

### Daily comments (105)
| Pattern | Count | Rule it supports |
|---|---|---|
| No greeting (সালাম) | 90 (86 %) | §১ structure |
| No closing line or dua | 87 (83 %) | §১ structure |
| Last sentence has no end mark | 23 (22 %) | §২ punctuation |
| No space after a দাঁড়ি | 15 (14 %) | §২ punctuation |
| Regional or colloquial forms (আনেন নাই, করতেছেন, দিছি, হইছেন) | 23 (22 %) | §২ standard Bangla |
| Today's date typed into the text | 19 (18 %) | §১ (the app stamps the date) |
| Non-honorific forms for the child (সে, করেছে, পারে না) | 11 (10 %) | §২ honorifics |
| Whole comment in English | 8 (8 %) | §২ language |
| Spelling mistakes (ব্যঘাত, দূর্বল, মনযোগ, প্রেকটিস, একি, কারনে) | 10 (10 %) | §২ spelling list |
| Under 25 characters (no reason, no request) | 10 (10 %) | §৫ |
| "নিয়মিত" inside a request | 11 (10 %) | §৫ (owner rule) |
| Blunt label about the child's work, or a threat (refusing entry, expulsion) | 7 (7 %) | §৩ tone |
| Guess stated as fact (who did the work, why the child behaved so) | 6 (6 %) | §৩ |
| Names or identifies ANOTHER child | 4 (two incident reports name classmates in full detail) | §৪ privacy |
| Remark about a staff member or family member | 1 | §৪ |
| Same text sent to 2+ children | 27 (26 %) | not a fault on its own; class-wide facts are fine |
| Positive comments | 7 of 195 in the whole database | §৬ |

**Already good:** most comments use the honorific -েন forms, describe what happened, and many name the subject. The best ones (several Class 3/KG teachers) already have greeting → fact → request → dua. The draft standard is built on them.

### Class-test comments (200 rows, 3 fields)
| Pattern | Count | Rule it supports |
|---|---|---|
| Guardian field empty | 50 of 200 | ct §২ (not empty when a weakness is written) |
| Teacher field empty | 34 of 200 | ct §৪ (not empty below 33 %) |
| Weakness names a concrete item, count or example | 59 of 198 (30 %) | ct §১ |
| Guardian field gives an amount, page or time | 22 of 150 (15 %) | ct §২ |
| 85 %+ results whose weakness line has no word of credit | 41 of 45 | ct §৪ |
| One generic guardian sentence ("practise regularly and they will do well") used for marks from 15 % to 85 % | 18 rows | ct §৪ mark match |
| Identical teacher-field text across a 30+ point spread | 27 rows | ct §৪ |
| Low result (< 50 %) that calls the tested skill "very well understood" | 4 | ct §৪ mark match |
| "নিয়মিত" in the guardian field / teacher field | 35 of 150 / 14 of 166 | owner rule |
| "ইনশাল্লাহ" or "ইং শা আল্লাহ" spellings | 32 | comment §২ |
| Teacher field written to someone else ("করবেন", "দিতে পারেন") | 10 of 166 | ct §৩ |
| Non-honorific forms (সে, পারেনি, লিখেনি) | 33 across the three fields | comment §২ |
| Spelling mistakes (পরিক্ষা, উওর, ব্যকরণ, নৈব্যত্তিক, axillary, sentance) | 48 hits | comment §২ |
| One-word or very short weakness | 26 under 25 characters | ct §১ |
| Blunt pressure on guardians (imperative -হোন forms, warnings about the final marks) | 6 | ct §২ |

**Already good:** the Class 5 English and KG English/Class 3 Maths sets name the exact mistake with an example, give the guardian a page or a daily amount, and say what the teacher will do. The draft's examples follow their pattern.

## 3. Why each rule exists (short)
- **Structure (greeting → fact → reason → what we did → one request → closing):** 86 % open without সালাম and 83 % end without a closing line; the best comments in the sample already follow this shape, so the rule writes down what good teachers do.
- **Honorifics and standard Bangla:** the school already writes -েন forms for children; 10–22 % slip into সে/করেছে or regional forms. A guardian reads these as rude.
- **App vocabulary:** the owner fixed বাড়ির কাজ / শিক্ষার্থী / প্রধান শিক্ষক for the app (2026-07-21); comments currently mix হোমওয়ার্ক, H.W, cw.
- **Tone, no threats:** consequences in a daily note (refusing entry, expulsion) should come from the Principal or Office. The checker FLAGS such lines and does not rewrite them.
- **Privacy:** four comments named other children, two of them incident reports describing what was done to a classmate. This is also the strongest reason for AI-4 (§4).
- **Concrete requests:** only 15 % of guardian fields say how much or how long; "নিয়মিত অনুশীলন" was the most common substitute.
- **Mark match:** the same guardian sentence for 15 % and 85 %, and fault-only lines for 41 of 45 high scorers, mean the text is not about the child's result. This is the check the PRD asked for ("no 'excellent' on a 40 % result"), and the data shows the opposite problem is more common: no credit on a 90 % result.
- **Teacher field:** it is internal, so it should be the teacher's own commitment. Today it is often a vague "we practise regularly" or a note addressed to someone else.

## 4. Finding for AI-4 (de-identification) — important
The roster swap removed 18 names, but **many children's first names survived**, because **only 17 of 91 active students have a Bangla name (`nameBn`) on file** and teachers write first names and nicknames in Bangla. About 19 of the 105 daily comments and at least 3 class-test comments still held a child's Bangla first name after the swap; one staff member's Bangla name survived too (staff have English names only). The "no full roster name left" check passed, because the names it knows were already gone.

So AI-4 cannot rely on the roster as it stands. Before the checker is switched on (AI-8), one of these is needed (recommendation: a + c):
- (a) Office fills `nameBn` (and a Bangla nickname, if used) for every student and staff member;
- (b) AI-4 transliterates English roster names to likely Bangla spellings;
- (c) the checker tokenises the child's OWN name from the record it is checking, and the outbound check also looks for any capitalised or Bangla word that matches a first name in the section roster.

This is also recorded in the PRD as pre-flight note P11.

## 5. Questions for the owner
1. **Greeting and closing:** required in every daily comment (as drafted), or only suggested?
2. **"ইনশাআল্লাহ" or "ইন শা আল্লাহ":** the draft picks "ইনশাআল্লাহ" (the most common form here). Which do you want?
3. **বাড়ির কাজ vs হোমওয়ার্ক in comments:** apply the app vocabulary to comments too (as drafted)?
4. **Consequence lines** (refusing entry, expulsion): flag only (as drafted), or allowed when a teacher has the Principal's go-ahead?
5. **Guardian field required** whenever a weakness is written (as drafted)? Today 50 of 200 are empty.
6. **Teacher field** on class tests: should the checker cover it (PRD P1; recommended yes, since the নিয়মিত rule is about it)?
7. **The 10 examples in each file:** edit freely. They become the checker's reference, so their wording matters more than the rules' wording.

## 6. Export file
The de-identified export and the analysis script are on the laptop in the session scratchpad. They are **not** in the repo. Because of §4, the export still holds some children's first names, so it will be deleted once you approve or change the drafts.
