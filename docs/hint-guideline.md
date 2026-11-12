# Guardian hint guideline (owner rulings 2026-11-13, D-#1520 / D-#1521)

A guardian helps a child with homework. Too often the guardian gives the answer. Hints let the guardian help
**without** giving the answer. Every bank question gets a **3-step ladder**; the guardian opens one step at a
time; the answer is **never** shown.

## The ladder
1. **Step 1 — where to look / what to notice.** Point the child to the part of the book, the picture-free
   example, the rule or the word in the question that matters. One short sentence.
   - "অনুচ্ছেদের দ্বিতীয় বাক্যটি আবার পড়ো।" / "বইয়ের ১২ নম্বর পাঠের ছকটি দেখো।" / "Look at the first word of the sentence."
2. **Step 2 — a guiding question.** A question that makes the child think one step closer, without naming the
   answer. One sentence.
   - "কোন শব্দটি একজন মানুষের নাম বোঝায়?" / "দশকের ঘরে কয়টি দশ আছে?" / "Is it one thing or many things?"
3. **Step 3 — a similar worked example.** Solve a DIFFERENT but similar item fully (other numbers, other words),
   so the child sees the method, then goes back to their own question. Up to three short lines.
   - Maths: "যেমন: ২৩ + ১৪ — আগে এককের ঘর: ৩ + ৪ = ৭; তারপর দশকের ঘর: ২ + ১ = ৩; উত্তর ৩৭। এবার তোমার অঙ্কটি এভাবে করো।"

## Never
- The answer, any part of it, or a near-answer: not the correct option, not the word, not its first letter, not
  "it rhymes with …", not the number.
- A step 3 example that has the same answer as the real question, or the same numbers/words.
- New words or numbers the book has not taught by that chapter (Class 1–2 especially).
- Pictures of living beings; anything against the school's Islamic values.

## Language
- Bangla for every Bangla-medium subject (Bangla, Math, Science, BGS, Islam).
- English items: the hint sentence is in simple Bangla (so a guardian who knows little English can use it), and
  any English example words are given in English. e.g. "বাক্যের শুরুতে বড় হাতের অক্ষর লাগে — যেমন: My name is Ali."
- Simple, warm, short. The guardian reads it aloud to the child.

## By question type
- **MCQ / tick:** step 1 what to look for; step 2 how to rule out one wrong option ("কোনটি কখনোই হতে পারে না?");
  step 3 a similar MCQ worked out.
- **True / false:** step 1 the key word in the sentence; step 2 "বইয়ে কী লেখা আছে — একই কথা কি?"; step 3 a
  similar statement judged with the reason.
- **Fill in the blank:** step 1 read the whole sentence; step 2 what kind of word fits (person/place/doing word,
  a number …); step 3 a similar sentence filled.
- **Matching:** step 1 start with the pair you are surest of; step 2 a question about one pair; step 3 one
  different pair matched with the reason.
- **Short answer / passage questions:** step 1 which sentence of the passage to read; step 2 a question pointing
  at the information; step 3 a similar question on a different sentence answered in a full sentence.
- **Maths sums and story sums:** step 1 what the question asks / which operation words; step 2 draw, count, or
  set out in the column grid; step 3 a similar sum fully worked, then "check by the reverse sum".
- **Writing (sentence, paragraph, letter):** step 1 talk about the topic first (2–3 talk questions); step 2 help
  plan the first sentence by questions, never write it; step 3 a short model on a DIFFERENT topic. The child's own
  words matter more than a perfect sentence.

## File format (one file per bank file, in the pack's `out/hints/`)
`<bank file name without .json>_hints.json`:
```json
{ "hints": [ { "qid": "QP-MATH-C1-U07-Q0001", "steps": [ "…step 1…", "…step 2…", "…step 3…" ] } ] }
```
One entry for EVERY question in the bank file, in the same order. Check with
`python -X utf8 ../tools/check_hints.py <bank.json> <bank_hints.json>` (run from the pack folder; it refuses a
missing qid, fewer or more than 3 steps, an empty or over-long step, and any step that contains the answer).

## Lessons from the pilot (13 Nov 2026)
- The checker matches answers as whole words: "an" inside "and", "মা" inside "তোমার" are fine. English grammar
  words (a, an, is, he, this …) may appear in a RULE statement ("an comes before a vowel sound") — the checker only
  warns; never write the item's own word with its answer ("an apple").
- True/false step 3: pick the example's verdict independently of the real item (sometimes the same, sometimes the
  opposite) so a guardian cannot work out the answer by elimination.
- Maths: generate ladders per question type with a script (as `C1_MATH/work/hints/make_hints_U07.py` does) — the
  step 3 example is drawn from a pool and checked so it never shares the real numbers or answer.
- Bangla step 3 example sentences use only everyday words the child already knows; prefer words from earlier
  chapters of the same book.
- Reuse the pilot generators in `<pack>/work/hints/` as the model for every new file.
