'use strict';
/**
 * compose.js — study-book composer (standalone, D-020).
 *
 * Template-per-arrangement engine (Option A). Walks each lesson:
 *  - if lesson.layout[] present: render rows in order, each via its arrangement template
 *  - if absent: document-order fallback (blocks then images, stacked)
 * Emits ONE HTML document for a whole book+profile so the fit guard measures
 * across all pages at once.
 *
 * Arrangements (open vocabulary; add a template to extend):
 *   image-only, text-only, image-above-text, side-by-side, text-in-image
 *
 * Presets (book.layout_presets) drive side-by-side splits and bubble anchors.
 * Colours/background come from the profile; geometry from geometry.js.
 *
 * NOTE: block INTERNAL styling keys off block.layout_hint (verse-center,
 * qa-pairs, speech-bubbles, dialogue-two-column, form-lines, section-label,
 * caption-highlight, title, open-questions). arrangement composes block<->image;
 * layout_hint styles the block's own text. The two are orthogonal.
 */

const geometry = require('./geometry');
const { PROFILES, resolveForProfile, BACKGROUND_WHITE } = require('./profiles');

/* ---------- Bengali orphaned-mark repair ----------
   A কারচিহ্ন with no consonant in front of it (chart tile, পড়ি row, tracing
   cell, or a heading like "আ-কার া") is an orphaned combining mark, so the
   shaper draws a dotted placeholder circle: ◌া. NCTB prints the bare stroke.
   Giving the mark a no-break space to attach to suppresses the circle while
   keeping the glyph font-derived. Render-time only — book.json keeps the
   plain mark, and NBSP is inside the script guard's allowed range. */
const BN_MARK = /[ঁ-ঃ়া-্ৗ]/;
const BN_BASE = /[অ-হড়-য়ৰৱঁ-ঃ়া-্ৗ]/;
function fixOrphanMarks(s) {
  return s.replace(/[ঁ-ঃ়া-্ৗ]/g, (m, off, str) => {
    const prev = off > 0 ? str[off - 1] : '';
    return BN_BASE.test(prev) ? m : ' ' + m;
  });
}

/* HTML-escape only. For a fragment whose preceding character is known from the
   original string, so the orphan-mark repair must NOT run on it again. */
function escRaw(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- html escaping ---------- */
function esc(s) {
  const raw = String(s == null ? '' : s);
  return (BN_MARK.test(raw) ? fixOrphanMarks(raw) : raw)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
// Bengali text with newlines -> <br>; preserves intra-block line structure.
function textToHtml(s) {
  return esc(s).replace(/\n/g, '<br>');
}
// Latin -> Bangla digits (page refs on an all-Bangla page)
function bnDigits(s) {
  return String(s).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
}
// "পাঠ ৪" — chapter marker (NCTB cross-ref dropped by owner decision;
// nctb_pages stays in book.json if it's ever wanted back)
function lessonMarker(lesson) {
  return `পাঠ ${bnDigits(lesson.lesson_no)}`;
}

/* NCTB colour code: inside a word, only the letter being taught is red.
   The span is extended over any কারচিহ্ন attached to that letter, so the
   remainder never starts with an orphaned mark. */
function markLetter(word, letter) {
  if (!letter) return esc(word);
  const i = word.indexOf(letter);
  if (i < 0) return esc(word);
  let end = i + letter.length;
  while (end < word.length && /[ঁ-ঃ়া-্ৗ]/.test(word[end])) end++;
  // An element boundary ends the shaping run, so a bare combining mark inside
  // its own span renders with a dotted circle. When the taught letter IS a mark
  // (ং in রং, ঃ in দুঃখ, ঁ in চাঁদ) pull its base letter into the highlight so
  // the cluster shapes as one piece.
  let start = i;
  if (i > 0 && BN_MARK.test(letter[0])) {
    // step back over any intervening marks (চাঁদ = চ + া + ঁ) to the base letter
    let s = i;
    while (s > 0 && BN_MARK.test(word[s - 1])) s--;
    if (s > 0) s--;
    start = s;
  }
  const mid = word.slice(start, end);
  return esc(word.slice(0, start)) +
    `<span class="sb-hi">${esc(mid)}</span>` +
    escRaw(word.slice(end));
}
/* Same, but scoped to the keyword's occurrence inside a sentence — so a
   letter that also appears in other words (ক in করে) stays black. */
function markLetterInSentence(sentence, word, letter) {
  if (!word) return esc(sentence);
  const i = sentence.indexOf(word);
  if (i < 0) return esc(sentence);
  // the keyword may be the stem of a longer word (রস inside রসের): pull in any
  // কারচিহ্ন that follow, so the remainder never starts with an orphaned mark
  let end = i + word.length;
  while (end < sentence.length && /[ঁ-ঃ়া-্ৗ]/.test(sentence[end])) end++;
  return esc(sentence.slice(0, i)) + markLetter(sentence.slice(i, end), letter) +
    escRaw(sentence.slice(end));
}

/* ---------- block-internal renderers, keyed by layout_hint ----------
 * Lessons 1–37 were authored with canonical slugs; 38 onward use descriptive
 * phrases for the same shapes. Map the synonyms here rather than rewriting
 * book.json, so a content drop that re-authors a block still renders right. */
const HINT_ALIASES = {
  'chapter-head': 'title',
  'centered-title': 'poem-title',
  'centered-byline': 'poem-byline',
  'indented-refrains': 'indented-couplets',
  'left words | right words, draw-line': 'match-columns',
  'two columns, draw-a-line matching': 'match-columns',
  'four oral questions': 'head-block',
  'three oral questions': 'head-block',
  'question-list': 'open-questions',
  'word - definition pairs': 'dash-pairs',
  'game-instruction paragraph above illustration': 'letter-chain',
  '7-row label + blank-cell form': 'label-form',
  'centred end badge below the form': 'end-badge',
  'date - meaning pairs': 'dash-pairs',
  '5 rows: word | conjunct | two components': 'conjunct-table',
  'prompt + blank line': 'prompt-then-blank',
  '10 numbered ruled blanks in two columns': 'numbered-blanks',
  'section-head': 'section-label',
  'section header': 'section-label',
  'exercise header': 'section-label',
  'oral prompt': 'section-label',
  'three numerals with spell-out lines': 'inline-blanks',
  'three words with numeral lines': 'inline-blanks',
  '3-row fill-the-blank number-word grid': 'word-grid',
  'oral question': 'head-block',
  'three numbered writing lines': 'head-block',
  'four gapped sentences': 'form-lines',
  'six colour prompts beside a 6-colour swatch': 'form-lines',
  'যুক্তবর্ণ cell (ন | দ)': 'conjunct-table',
  'যুক্তবর্ণ cell (দ | দ)': 'conjunct-table',
  'verse block, left of illustration': 'poem-block',
  'three words with writing lines': 'word-write-lines',
  'two gapped sentences': 'form-lines',
  'two preceding-line blanks': 'form-lines',
  'three writing lines': 'section-label',
  'glossary header': 'section-label',
  'info-box header': 'section-label',
  'left-word right-sentence': 'word-sentence-pair',
  'write-model': 'model-sentence',
  'two ruled blank lines': 'blank-ruled-lines',
  'several ruled blank lines': 'ruled-lines-many',
  'four short lines': 'spaced-lines',
  'engine + 7 day-name carriages': 'day-train',
  'word | conjunct | letter | letter (5 rows)': 'conjunct-table',
  '7 day-label pills -> blank write-boxes': 'day-pill-boxes',
  'prompt line + gap + (option/option) x3': 'fill-the-gap',
  'prompt with blank gaps': 'fill-the-gap',
  '5-column bordered grid': 'letter-grid',
  '5x5 coloured tiles, dotted blank box under each': 'tile-write-grid',
};
function normalizeHint(hint) {
  const h = String(hint || '').trim();
  return HINT_ALIASES[h] || h;
}

/** "..." / "…" marks a blank the child fills in; draw it as a rule. */
function gapsToRules(line) {
  return textToHtml(line).replace(/\.{3,}|…/g, '<span class="sb-rule"></span>');
}

function renderBlockInner(block, lessonNo) {
  const hint = normalizeHint(block.layout_hint);
  const t = block.text_bn || '';
  switch (hint) {
    case 'title': {
      const chapter = lessonNo != null
        ? `<div class="sb-chapter">পাঠ ${bnDigits(lessonNo)}</div>` : '';
      // some title blocks carry their own "পাঠ N" line — the chapter chip
      // already renders it, so drop the duplicate (and the whole heading when
      // the number is all the block contains, e.g. rhyme lessons)
      const text = t.replace(/^পাঠ\s+[০-৯0-9]+\s*\n?/, '').trim();
      return chapter + (text ? `<h1 class="sb-title" data-fit>${textToHtml(text)}</h1>` : '');
    }
    case 'section-label': {
      // NCTB sets a heading, then any following lines as red instructions —
      // a multi-line header block is that pattern, not one tall heading
      const [head, ...rest] = t.split('\n').filter(s => s.trim());
      return `<h2 class="sb-section" data-fit>${textToHtml(head || t)}</h2>` +
        rest.map(line => `<div class="sb-instruction" data-fit>${textToHtml(line)}</div>`).join('');
    }
    case 'poem-block': {
      // byline, then the verse (tab = NCTB's stepped line), then the source note
      const lines = t.split('\n').filter(s => s.trim());
      let byline = '';
      const body = lines.map((line, i) => {
        if (i === 0 && !/^\t/.test(line)) { byline = line; return ''; }
        if (/^\(.*\)$/.test(line.trim())) {
          return `<div class="sb-note-right">${textToHtml(line)}</div>`;
        }
        const ind = /^\t/.test(line) ? ' sb-verse-in' : '';
        return `<div class="sb-verse-line${ind}">${textToHtml(line.replace(/^\t+/, ''))}</div>`;
      }).join('');
      return (byline ? `<div class="sb-byline" data-fit>${textToHtml(byline)}</div>` : '') +
        `<div class="sb-verse" data-fit>${body}</div>`;
    }
    case 'inline-blanks': {
      // several "word ______" items across one line (tab-separated)
      const items = t.split(/[\t\n]+/).map(s => s.trim()).filter(Boolean)
        .map(it => `<span class="sb-ib-item">${gapsToRules(it.replace(/_{3,}/g, '...'))}</span>`)
        .join('');
      return `<div class="sb-inline-blanks" data-fit>${items}</div>`;
    }
    case 'word-grid': {
      // bordered grid where "______" cells are the ones the child fills in
      const rows = t.split('\n').filter(s => s.trim()).map(line =>
        '<tr>' + line.split(/\t+/).map(c => {
          const v = c.trim();
          return /^_{3,}$/.test(v) ? '<td></td>' : `<td>${esc(v)}</td>`;
        }).join('') + '</tr>').join('');
      return `<table class="sb-word-grid"><tbody>${rows}</tbody></table>`;
    }
    case 'label-form': {
      // NCTB's address table: a tinted label column and a wide blank cell for
      // the child to write in. "/" in a label is where NCTB wraps the line.
      const rows = t.split('\n').map(s => s.replace(/\t+$/, '')).filter(s => s.trim())
        .map(label => '<tr>' +
          `<td class="sb-lf-label">${textToHtml(label.replace(/\/\s*/g, '/\n'))}</td>` +
          '<td class="sb-lf-cell"></td></tr>').join('');
      return `<table class="sb-label-form"><tbody>${rows}</tbody></table>`;
    }
    case 'end-badge':
      return `<div class="sb-end-badge-wrap"><span class="sb-end-badge">${textToHtml(t)}</span></div>`;
    case 'letter-chain': {
      // NCTB colours the letters the word-game passes along: each letter named
      // on its own, and the last letter of the word that answers "হলো …".
      // Derived from the sentence, so renaming the children cannot break it.
      // code points, not literals: a decomposed ড় would break the range
      const BN_CONS = /[অ-হড়-য়ৎ]/;
      const parts = t.split(/(\s+)/);
      let prev = '';
      const out = parts.map(tok => {
        if (/^\s*$/.test(tok)) return tok;
        const core = tok.replace(/[।,?!]+$/, '');
        const tail = esc(tok.slice(core.length));
        let html;
        if ([...core].length === 1 && BN_CONS.test(core)) {
          html = `<span class="sb-chain">${esc(core)}</span>`;          // named letter
        } else if (prev === 'হলো' && [...core].length > 1) {
          const chars = [...core];
          const last = chars[chars.length - 1];
          // only split off a plain consonant — never out of a conjunct, which
          // would break the shaping run and orphan the mark
          if (BN_CONS.test(last) && chars[chars.length - 2] !== '্') {
            html = escRaw(chars.slice(0, -1).join('')) +
              `<span class="sb-chain">${escRaw(last)}</span>`;
          } else html = esc(core);
        } else html = esc(core);
        prev = core;
        return html + tail;
      }).join('');
      return `<p class="sb-text" data-fit>${out}</p>`;
    }
    case 'dash-pairs': {
      // "word - meaning" per line, set as two columns with the dash aligned,
      // as NCTB does for শব্দ শিখি and জেনে রাখি
      const rows = t.split('\n').filter(s => s.trim()).map(line => {
        const m = line.match(/^(.*?)\s*[-–—]\s*(.*)$/);
        const [a, bb] = m ? [m[1], m[2]] : [line, ''];
        return '<div class="sb-dp2-row">' +
          `<span class="sb-dp2-term">${textToHtml(a)}</span>` +
          `<span class="sb-dp2-dash">–</span>` +
          `<span class="sb-dp2-def">${textToHtml(bb)}</span></div>`;
      }).join('');
      return `<div class="sb-dash-pairs" data-fit>${rows}</div>`;
    }
    case 'head-block': {
      // a red heading followed by its own content: either plain body text
      // (an oral question) or numbered write-on lines ("১।" alone on a line).
      // Some sources include the heading in the block and some do not, so
      // only treat line 1 as a heading when it reads like one — a short line
      // with no terminal ? or ।
      const lines = t.split('\n').filter(s => s.trim());
      const isNum = s => /^[০-৯0-9]+\s*।?\s*$/.test(s.trim());
      const numbered = lines.some(isNum);
      const first = (lines[0] || '').trim();
      const hasHead = first.length <= 25 && !/[?।]$/.test(first);
      if (!hasHead) {
        return `<div class="sb-questions" data-fit>${
          lines.map(l => `<div>${textToHtml(l)}</div>`).join('')}</div>`;
      }
      const head = `<h2 class="sb-section" data-fit>${textToHtml(lines[0] || '')}</h2>`;
      const rest = lines.slice(1).map(line => {
        if (isNum(line)) {
          return '<div class="sb-nb-item">' +
            `<span class="sb-nb-num">${textToHtml(line)}</span>` +
            '<span class="sb-ruled-line"></span></div>';
        }
        // with numbered lines below, a middle line is the instruction for them
        return numbered
          ? `<div class="sb-instruction" data-fit>${textToHtml(line)}</div>`
          : `<p class="sb-text" data-fit>${textToHtml(line)}</p>`;
      }).join('');
      return head + (numbered ? `<div class="sb-numbered-rows">${rest}</div>` : rest);
    }
    case 'word-write-lines': {
      // a word, then a rule to build a sentence with it
      const items = t.split('\n').filter(s => s.trim()).map(w =>
        `<div class="sb-ww-row"><span class="sb-ww-word">${textToHtml(w)}</span>` +
        '<span class="sb-ruled-line"></span></div>').join('');
      return `<div class="sb-word-write">${items}</div>`;
    }
    case 'rhyme-title':
      // the poem's own title, under the section label
      return `<div class="sb-rhyme-title" data-fit>${textToHtml(t)}</div>`;
    case 'form-lines':
      // fill-in lines: each newline is a form line; runs of ___ become
      // ruled lines stretching to the margin (NCTB style)
      return `<div class="sb-form" data-fit>${
        esc(t).split('\n').map(line =>
          `<div class="sb-form-line">${line.replace(/_{3,}/g, '<span class="sb-rule"></span>')}</div>`
        ).join('')
      }</div>`;
    case 'caption-highlight':
      return `<p class="sb-caption" data-fit>${textToHtml(t)}</p>`;
    case 'panel-caption':
      // story-panel caption: centered under its panel (NCTB style)
      return `<p class="sb-panel-cap" data-fit>${textToHtml(t)}</p>`;
    case 'read-large-letters':
    case 'read-letters':
    case 'new-letters': {
      // পড়ি: big red display letters, evenly spaced (NCTB letter-lesson style)
      const items = t.split(/[\s·]+/).filter(Boolean);
      return `<div class="sb-read-large" data-fit>${
        items.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
    }
    case 'letter-keyword-showcase':
    case 'picture-word-pair':
    case 'picture-naming':
    case 'picture-words-row':
    case 'picture-word-row':
    case 'naming-row': {
      // word list that pairs 1:1 with an image grid — equal columns so each
      // word sits under/over its picture. block.hi_letters (layout data)
      // reddens the taught letter in each word, NCTB-style.
      // words may be separated by newlines, tabs, middle dots — or (in some
      // blocks) just spaces; fall back to whitespace when nothing else splits
      let words = t.split(/[\n\t·]+/).map(s => s.trim()).filter(Boolean);
      if (words.length === 1 && /\s/.test(words[0])) words = words[0].split(/\s+/).filter(Boolean);
      const hl = block.hi_letters || [];
      return `<div class="sb-word-list" data-fit>${
        words.map((w, i) => `<span>${hl[i] ? markLetter(w, hl[i]) : esc(w)}</span>`).join('')}</div>`;
    }
    case 'picture-sentences': {
      // sentences that teach a keyword each; block.hi_words / block.hi_letters
      // (layout data) colour just the taught letter, NCTB-style
      const words = block.hi_words || [];
      const letters = block.hi_letters || [];
      const lines = t.split('\n').filter(Boolean);
      if (!words.length) return `<p class="sb-text sb-sentences" data-fit>${textToHtml(t)}</p>`;
      return `<p class="sb-text sb-sentences" data-fit>${
        lines.map((s, i) => markLetterInSentence(s, words[i] || '', letters[i] || '')).join('<br>')}</p>`;
    }
    case 'exercise-instruction':
      // exercise prompt line: red like NCTB's activity instructions
      return `<p class="sb-exercise" data-fit>${textToHtml(t)}</p>`;
    case 'kar-table':
    case 'kar-intro-cell': {
      // NCTB কার lesson header: "ই-কার" beside the sign in a boxed cell —
      // one cell per line (a lesson may introduce two kars)
      const cells = t.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
        const [label, kar] = line.split(/\t+/);
        return `<span class="sb-kar-pair"><span>${esc(label || '')}</span>` +
          `<span class="sb-kar-box">${esc(kar || '')}</span></span>`;
      }).join('');
      return `<div class="sb-kar-intro" data-fit>${cells}</div>`;
    }
    case 'picture-word-large':
      // the model word for the kar being taught
      return `<div class="sb-picword-lg" data-fit>${esc(t)}</div>`;
    case 'picture-word':
      // caption under one picture; siblings sit side by side across the row
      return `<span class="sb-picword">${esc(t)}</span>`;
    case 'kar-tracing-row': {
      // NCTB: the kar once in red, then dotted copies to trace over
      const kar = t.trim();
      const copies = (block.trace_copies || 4);
      // colours live in the profile CSS (this renderer has no profile)
      const glyph = esc(kar);
      // viewBox is wider than the advance width: kar hooks (ী, ৌ, ে…) overhang
      // their advance, and a tight box clips the tail off
      const t9 = attrs => `<text x="40" y="72" text-anchor="middle"` +
        ` font-family="NotoSerifBengali" font-size="58"${attrs}>${glyph}</text>`;
      const cell = style =>
        `<svg class="sb-kar-trace" viewBox="0 0 80 108" preserveAspectRatio="xMidYMid meet">` +
        (style === 'solid' ? t9(' class="sb-kt-solid"') : t9(' fill="url(#sb-dots)"')) +
        `</svg>`;
      return `<div class="sb-kar-trace-row" data-fit>${cell('solid')}${
        Array.from({ length: copies }, () => cell('dotted')).join('')}</div>`;
    }
    case 'vowel-to-kar-pairs': {
      // NCTB কারচিহ্ন chart: each vowel beside its kar sign in coloured tiles,
      // two pairs per row. block.kar_solo lists line indices that stand alone
      // (a vowel with no short/long partner) and centre across both columns.
      const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
      const solo = new Set(block.kar_solo || []);
      const cells = lines.map((line, i) => {
        const [v, k] = line.split(/\t+/);
        return `<div class="sb-kar-cell sb-kt-${i % 6}${solo.has(i) ? ' sb-kar-solo' : ''}">` +
          `<span class="sb-kar-tile">${esc(v || '')}</span>` +
          `<span class="sb-kar-tile">${esc(k || '')}</span></div>`;
      }).join('');
      return `<div class="sb-kar-chart" data-fit>${cells}</div>`;
    }
    case 'vowel-review-grid': {
      // bordered table of the vowel inventory (NCTB review-page style)
      const rows = t.split('\n').map(line => line.split(/\s+/).filter(Boolean));
      const cols = Math.max(...rows.map(r => r.length));
      const body = rows.map(r => `<tr>${Array.from({ length: cols }, (_, i) =>
        `<td>${r[i] ? esc(r[i]) : ''}</td>`).join('')}</tr>`).join('');
      return `<table class="sb-vowel-grid" data-fit>${body}</table>`;
    }
    case 'colour-the-vowels-row': {
      // NCTB রং করি: multicoloured solid letters, then hollow outlines to colour
      const letters = t.split(/\s+/).filter(Boolean);
      const solid = letters.map((l, i) => `<span class="sb-cv-${i % 7}">${esc(l)}</span>`).join('');
      const outline = letters.map(l =>
        `<svg viewBox="0 0 60 74" class="sb-cv-svg"><text x="30" y="54" text-anchor="middle"` +
        ` font-family="NotoSerifBengali" font-size="46" class="sb-outline-text">${esc(l)}</text></svg>`).join('');
      return `<div class="sb-cv-solid" data-fit>${solid}</div><div class="sb-cv-outline">${outline}</div>`;
    }
    case 'read-words':
    case 'word-row': {
      // standalone row of words (not captions) — centred and large
      let w = t.split(/[\n\t·]+/).map(s => s.trim()).filter(Boolean);
      if (w.length === 1 && /\s/.test(w[0])) w = w[0].split(/\s+/).filter(Boolean);
      return `<div class="sb-word-row" data-fit>${w.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
    }
    case 'circle-the-vowel-in-words': {
      // word-hunt row: large spaced words for circling target letters
      const words = t.split(/\s+/).filter(Boolean);
      return `<div class="sb-word-row" data-fit>${words.map(w => `<span>${esc(w)}</span>`).join('')}</div>`;
    }
    case 'circle-the-letter-row': {
      // letter-hunt: large, widely spaced letters for the child to circle
      const letters = t.split(/\s+/).filter(Boolean);
      return `<div class="sb-letter-row" data-fit>${letters.map(l => `<span>${esc(l)}</span>`).join('')}</div>`;
    }
    case 'arrange-and-write-boxes': {
      // সাজিয়ে লিখি: each letter above an empty writing box
      const letters = t.split(/\s+/).filter(Boolean);
      return `<div class="sb-arrange" data-fit>${letters.map(l =>
        `<div class="sb-arrange-col"><span>${esc(l)}</span><div class="sb-write-box"></div></div>`).join('')}</div>`;
    }
    case 'arrange-and-write-bank': {
      // review-page variant: a coloured letter bank, then a separate grid of
      // large empty boxes for the child to write them in order
      const letters = t.split(/[\s·]+/).filter(Boolean);
      const bank = letters.map((l, i) => `<span class="sb-cv-${i % 7}">${esc(l)}</span>`).join('');
      const boxes = letters.map(() => '<div class="sb-write-box-lg"></div>').join('');
      return `<div class="sb-bank" data-fit>${bank}</div><div class="sb-box-grid">${boxes}</div>`;
    }
    case 'tracing-grid-stroke-arrows':
    case 'tracing-rows':
      // the visual tracing grid is rendered from the lesson's vector slot
      // (font-derived SVG); this text block is its data twin — render nothing
      return '';
    case 'dialogue-two-column': {
      // "Speaker : line" per row -> two-column table
      const rows = t.split('\n').map(line => {
        const idx = line.indexOf(':');
        if (idx === -1) return `<tr><td class="sb-dlg-line" colspan="3">${esc(line)}</td></tr>`;
        const who = line.slice(0, idx).trim(), said = line.slice(idx + 1).trim();
        return `<tr><td class="sb-dlg-who">${esc(who)}</td><td class="sb-dlg-colon">:</td><td class="sb-dlg-said">${esc(said)}</td></tr>`;
      }).join('');
      return `<table class="sb-dialogue" data-fit>${rows}</table>`;
    }
    case 'qa-pairs': {
      // NCTB style: every line a plain dash-prefixed item, uniform indent
      const items = t.split('\n').filter(Boolean).map(line =>
        `<div class="sb-qa">– ${esc(line)}</div>`).join('');
      return `<div class="sb-qa-list" data-fit>${items}</div>`;
    }
    case 'open-questions': {
      // NCTB style: plain unnumbered lines
      const items = t.split('\n').filter(Boolean)
        .map(line => `<div>${esc(line)}</div>`).join('');
      return `<div class="sb-questions" data-fit>${items}</div>`;
    }
    case 'speech-bubbles': {
      // each line becomes a bubble; positioned by the text-in-image template
      // when used inside an image, else rendered as a bubble stack
      const bubbles = t.split('\n').filter(Boolean)
        .map(line => `<span class="sb-bubble">${esc(line)}</span>`).join('');
      return `<div class="sb-bubbles" data-fit>${bubbles}</div>`;
    }
    case 'word-sentence-pair': {
      // NCTB sets these as two aligned columns: the word, then a sentence
      // using it. Consecutive pair blocks stack into one column pair via CSS.
      const [word, sent] = t.split(/\t+/);
      return '<div class="sb-ws-pair" data-fit>' +
        `<span class="sb-ws-word">${textToHtml(word || '')}</span>` +
        `<span class="sb-ws-sent">${textToHtml(sent || '')}</span></div>`;
    }
    case 'model-sentence':
      return `<div class="sb-model-sent" data-fit>${textToHtml(t)}</div>`;
    case 'poem-title':
      return `<div class="sb-poem-title" data-fit>${textToHtml(t)}</div>`;
    case 'poem-byline':
      return `<div class="sb-byline" data-fit>${textToHtml(t)}</div>`;
    case 'indented-couplets': {
      // NCTB sets a rhyme with every second line stepped in; the source marks
      // those lines with a leading tab
      const lines = t.split('\n').filter(s => s.trim()).map(line => {
        const ind = /^\t/.test(line) ? ' sb-verse-in' : '';
        return `<div class="sb-verse-line${ind}">${textToHtml(line.replace(/^\t+/, ''))}</div>`;
      }).join('');
      return `<div class="sb-verse" data-fit>${lines}</div>`;
    }
    case 'spaced-lines':
      // short reading lines, one per line, set with NCTB's generous leading
      return `<div class="sb-spaced" data-fit>${
        t.split('\n').filter(s => s.trim())
          .map(line => `<div>${textToHtml(line)}</div>`).join('')}</div>`;
    case 'fill-the-gap': {
      // "..." in the source marks where the child writes; render it as a rule
      const items = t.split('\n').filter(s => s.trim())
        .map(line => `<div class="sb-gap-line">${gapsToRules(line)}</div>`).join('');
      return `<div class="sb-fill-gap" data-fit>${items}</div>`;
    }
    case 'ruled-lines-many':
      return `<div class="sb-ruled sb-ruled-many">${
        '<span class="sb-ruled-line"></span>'.repeat(8)}</div>`;
    case 'day-train': {
      // NCTB draws the week as a train: an engine pulling one named carriage
      // per day. Engine and wheels are drawn here, never rastered.
      const cars = t.split(/[\t\n]+/).map(s => s.trim()).filter(Boolean);
      const engine =
        '<svg class="sb-train-engine" viewBox="0 0 60 44" aria-hidden="true">' +
        '<rect x="2" y="18" width="40" height="16" rx="2" fill="#1F6FB2"/>' +
        '<rect x="30" y="6" width="16" height="16" rx="2" fill="#C0392B"/>' +
        '<rect x="8" y="8" width="8" height="12" rx="1" fill="#F4B400"/>' +
        '<circle cx="12" cy="38" r="5" fill="#333"/><circle cx="34" cy="38" r="5" fill="#333"/>' +
        '</svg>';
      const carsHtml = cars.map((d, i) =>
        `<span class="sb-car sb-car-c${i % 7}"><span class="sb-car-body">${esc(d)}</span>` +
        '<span class="sb-car-wheels"></span></span>').join('');
      return `<div class="sb-train">${engine}${carsHtml}</div>`;
    }
    case 'conjunct-table': {
      // word | conjunct | the two letters it is built from
      const rows = t.split('\n').filter(s => s.trim()).map(line => {
        const c = line.split(/\t+/).map(s => s.trim());
        const parts = c.slice(2).map(p => `<td class="sb-cj-part">${esc(p)}</td>`).join('');
        return `<tr><td class="sb-cj-word">${esc(c[0] || '')}</td>` +
          `<td class="sb-cj-conj">${esc(c[1] || '')}</td>${parts}</tr>`;
      }).join('');
      return `<table class="sb-conjunct"><tbody>${rows}</tbody></table>`;
    }
    case 'day-pill-boxes': {
      // a coloured day pill, an arrow, then a box to write the day's activity;
      // "..." means NCTB leaves that pill blank for the child to fill
      const rows = t.split('\n').filter(s => s.trim()).map((line, i) => {
        const day = (line.split(/\t+/)[0] || '').trim();
        const label = /^\.{3,}$|^…$/.test(day) ? '' : esc(day);
        return `<div class="sb-dp-row"><span class="sb-dp-pill sb-dp-c${i % 7}">${label}</span>` +
          `<span class="sb-dp-arrow sb-dp-a${i % 7}"></span>` +
          '<span class="sb-dp-box"></span></div>';
      }).join('');
      return `<div class="sb-day-pills">${rows}</div>`;
    }
    case 'instruction-line':
      return `<div class="sb-instruction" data-fit>${textToHtml(t)}</div>`;
    case 'match-columns': {
      // two word columns with clear space between for the child to draw the
      // joining line. Sources write this either as one pair per line
      // ("নদী⇥গান") or as two lines, one per COLUMN — accept both.
      const lines = t.split('\n').filter(s => s.trim()).map(s => s.split(/\t+/));
      const pairs = (lines.length === 2 && lines[0].length > 1 && lines[1].length > 1)
        ? lines[0].map((a, i) => [a, lines[1][i]])   // column-per-line form
        : lines.map(c => [c[0], c[1]]);              // pair-per-line form
      const rows = pairs.map(([a, bb]) => '<div class="sb-mc-row">' +
        `<span class="sb-mc-l">${textToHtml(a || '')}</span>` +
        `<span class="sb-mc-r">${textToHtml(bb || '')}</span></div>`).join('');
      return `<div class="sb-match-cols" data-fit>${rows}</div>`;
    }
    case 'right-aligned-note':
      return `<div class="sb-note-right" data-fit>${textToHtml(t)}</div>`;
    case 'prompt-then-blank': {
      // a line of the rhyme, then a ruled line for the child to write the next
      const items = t.split('\n').filter(s => s.trim()).map(line =>
        `<div class="sb-pb-item"><div class="sb-pb-prompt">${textToHtml(line)}</div>` +
        '<span class="sb-ruled-line"></span></div>').join('');
      return `<div class="sb-prompt-blank">${items}</div>`;
    }
    case 'numbered-blanks': {
      // numbered write-on lines laid out in columns (tab separates columns)
      const rows = t.split('\n').filter(s => s.trim()).map(s => s.split(/\t+/));
      const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
      const cells = rows.flatMap(r => Array.from({ length: cols }, (_, i) =>
        r[i] == null ? '<span></span>'
          : `<span class="sb-nb-item"><span class="sb-nb-num">${esc(r[i].trim())}</span>` +
            '<span class="sb-ruled-line"></span></span>')).join('');
      return `<div class="sb-numbered-blanks" style="--nb-cols:${cols}">${cells}</div>`;
    }
    case 'letter-grid': {
      // NCTB's bordered alphabet chart: one line per row, short rows padded
      // with empty cells so the grid stays rectangular
      const rows = t.split('\n').map(s => s.trim()).filter(Boolean)
        .map(line => line.split(/\s+/).filter(Boolean));
      const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
      const html = rows.map(r => '<tr>' + Array.from({ length: cols }, (_, i) =>
        `<td>${r[i] ? esc(r[i]) : ''}</td>`).join('') + '</tr>').join('');
      return `<table class="sb-letter-grid"><tbody>${html}</tbody></table>`;
    }
    case 'tile-write-grid': {
      // coloured letter tiles, each with a dotted box under it to copy into
      const rows = t.split('\n').map(s => s.trim()).filter(Boolean)
        .map(line => line.split(/\s+/).filter(Boolean));
      const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
      const html = rows.map((r, ri) => {
        const tiles = r.map((ch, ci) =>
          // rotate the palette per row so no colour stacks vertically
          `<span class="sb-tw-tile sb-tw-c${(ri * 2 + ci) % 5}">${esc(ch)}</span>`).join('');
        const boxes = r.map(() => '<span class="sb-tw-box"></span>').join('');
        return `<div class="sb-tw-line">${tiles}</div><div class="sb-tw-line">${boxes}</div>`;
      }).join('');
      return `<div class="sb-tile-write" style="--tw-cols:${cols}">${html}</div>`;
    }
    case 'blank-ruled-lines': {
      // an empty block whose whole purpose is the lines the child writes on;
      // the count comes from its non-empty lines, or 2 when it is blank
      const n = t.split('\n').filter(s => s.trim()).length || 2;
      return `<div class="sb-ruled">${'<span class="sb-ruled-line"></span>'.repeat(n)}</div>`;
    }
    default:
      return `<p class="sb-text" data-fit>${textToHtml(t)}</p>`;
  }
}

/* ---------- ruled trace panel (NCTB "পড়ি ও লিখি") ----------
 * A tinted panel of writing lanes: the first lane shows the words solid, the
 * rest repeat them dot-filled to trace over. Words come from the block, so a
 * content drop can change them without touching the layout. */
function renderTracePanel(items, profile, opts) {
  const o = opts || {};
  const size = o.size || 46;
  const practice = o.practice_rows == null ? 2 : o.practice_rows;
  const solidCol = profile.greyscale ? '#000' : '#000';
  // baseline sits at y=72 of the 108-unit viewBox; the মাত্রা bar near y=30
  const cell = (w, style) => {
    const glyph = esc(w);
    const fill = style === 'solid' ? solidCol : 'url(#sb-dots-fine)';
    return '<div class="sb-tp-cell">' +
      `<svg class="sb-tp-svg" viewBox="-4 0 108 108" preserveAspectRatio="xMidYMid meet">` +
      `<text x="50" y="72" text-anchor="middle" font-family="NotoSerifBengali"` +
      ` font-size="${size}" fill="${fill}">${glyph}</text></svg></div>`;
  };
  const lane = (style, i) =>
    `<div class="sb-tp-lane${style === 'solid' ? ' sb-tp-model' : ''}" data-lane="${i}">` +
    items.map(w => cell(w, style)).join('') + '</div>';
  const lanes = [lane('solid', 0)]
    .concat(Array.from({ length: practice }, (_, i) => lane('dotted', i + 1)));
  // NCTB tints these panels differently per lesson; the photocopy edition
  // drops the tint entirely so the lanes stay readable on a copier
  const tint = TRACE_TINTS[o.tint] || TRACE_TINTS.cream;
  const style = profile.greyscale
    ? '--tp-rule:#666;background:#FFFFFF;border-color:#666'
    : `--tp-rule:${tint.rule};background:${tint.bg};border-color:${tint.rule}`;
  return `<div class="sb-trace-panel" style="${style}">${lanes.join('')}</div>`;
}
const TRACE_TINTS = {
  cream: { bg: '#FDF6D8', rule: '#C9B87A' },
  mint: { bg: '#BFE0DC', rule: '#4E8E86' },
  sky: { bg: '#D6E8F7', rule: '#6E9CC4' },
  sage: { bg: '#E4EFC8', rule: '#8FA85E' },
  blush: { bg: '#F8DDDD', rule: '#C48C8C' },
};

/* ---------- letter-tracing renderer (font-derived, D-020 trace spec) ----------
 * Letters come from the embedded Noto fonts via SVG <text> — Chrome shapes the
 * Bengali (conjuncts/কারচিহ্ন correct) and stroke-dasharray makes the dotted
 * outline. Never AI raster: shapes must match the taught glyph exactly.
 * slot.trace = { items:["অ","আ"], rows:["model","blank"], matra_guide, size }
 *   model row: [solid][dotted] cell pair per item; blank rows: empty boxes. */
function renderTraceAsset(slot, profile) {
  const t = slot.trace;
  const items = t.items || [];
  const rows = t.rows || ['model', 'blank'];
  const size = t.size || 58;                    // font-size in the 100-unit viewBox
  const solidCol = profile.greyscale ? '#000' : '#C0392B';
  const dotCol = profile.greyscale ? '#000' : '#555';
  const cellW = item => Math.min(70, (t.cell_mm || 30) + Math.max(0, [...String(item)].length - 1) * 8); // mm

  const guide = t.matra_guide
    ? '<line x1="8" y1="24" x2="92" y2="24" stroke="#BBB" stroke-width="0.6" stroke-dasharray="2 2"/>' : '';
  const cell = (item, style) => {
    let inner = '';
    const glyph = esc(item); // esc() strips the dotted placeholder circle
    if (style === 'solid') {
      inner = `<text x="50" y="72" text-anchor="middle" font-family="NotoSerifBengali" font-size="${size}" fill="${solidCol}">${glyph}</text>`;
    } else if (style === 'dotted') {
      // dot-pattern FILL, not a dashed outline — stroking an outline draws
      // both sides of every stroke, which reads as a double line
      inner = guide + `<text x="50" y="72" text-anchor="middle" font-family="NotoSerifBengali"` +
        ` font-size="${size}" fill="url(#sb-dots-fine)">${glyph}</text>`;
    } else inner = guide; // blank
    // viewBox is taller/wider than the em box so descenders and hooks that
    // overhang the advance width are not clipped
    return `<div class="sb-trace-cell" style="width:${cellW(item)}mm;height:${t.cell_h_mm || 24}mm">` +
      `<svg class="sb-trace-svg" viewBox="-4 0 108 108" preserveAspectRatio="xMidYMid meet">${inner}</svg></div>`;
  };

  const rowsHtml = rows.map(style => {
    const cells = style === 'model'
      ? items.map(it => cell(it, 'solid') + cell(it, 'dotted')).join('')
      : items.map(it => cell(it, 'blank') + cell(it, 'blank')).join('');
    return `<div class="sb-trace-row">${cells}</div>`;
  }).join('');
  return `<div class="sb-trace" data-vector="${esc(slot.id)}">${rowsHtml}</div>`;
}

/* ---------- image renderer ---------- */
function renderImage(slot, profile, imagesRel) {
  const isVector = slot.action === 'vector_asset' || slot.image_class === 'tracing_asset';
  if (isVector) {
    // trace.rows: [] — the slot's visual is rendered by a block on the page
    // (e.g. the কার chart); keep the slot placed but draw nothing
    if (slot.trace && Array.isArray(slot.trace.rows) && slot.trace.rows.length === 0) return '';
    if (slot.trace && Array.isArray(slot.trace.items) && slot.trace.items.length) {
      return renderTraceAsset(slot, profile);
    }
    // no trace spec yet: placeholder box
    return `<div class="sb-vector" data-vector="${esc(slot.id)}">tracing/vector: ${esc(slot.id)}</div>`;
  }
  const src = `${imagesRel}/${esc(slot.filename)}`;
  const grey = profile.greyscale ? ' sb-grey' : '';
  return `<img class="sb-img${grey}" src="${src}" alt="${esc(slot.scene_description || '')}" decoding="sync">`;
}

/* ---------- arrangement templates ---------- */
function tmplImageOnly(refs, ctx, preset) {
  const img = renderImage(ctx.imageById(refs[0]), ctx.profile, ctx.imagesRel);
  const frac = preset && preset.image_frac; // optional width cap; row centers it
  return `<div class="sb-row sb-image-only">${
    frac ? `<div style="width:${Math.round(frac * 1000) / 10}%">${img}</div>` : img
  }</div>`;
}
function tmplTextOnly(refs, ctx, preset) {
  const inner = refs.map(id => renderBlockInner(ctx.blockById(id), ctx.lessonNo)).join('');
  // width_frac narrows and centres the row — used to line a word row up with
  // the picture above it (e.g. captions under a composite image)
  const frac = preset && preset.width_frac;
  return `<div class="sb-row sb-text-only">${
    frac ? `<div style="width:${Math.round(frac * 1000) / 10}%;margin:0 auto">${inner}</div>` : inner
  }</div>`;
}
function tmplImageAboveText(refs, ctx, preset) {
  const imgId = refs.find(id => ctx.isImage(id));
  const txtIds = refs.filter(id => !ctx.isImage(id));
  let img = imgId ? renderImage(ctx.imageById(imgId), ctx.profile, ctx.imagesRel) : '';
  const frac = preset && preset.image_frac; // optional width cap, centered
  if (img && frac) img = `<div style="width:${Math.round(frac * 1000) / 10}%;margin:0 auto">${img}</div>`;
  const txt = txtIds.map(id => renderBlockInner(ctx.blockById(id), ctx.lessonNo)).join('');
  return `<div class="sb-row sb-image-above-text">${img}<div class="sb-below">${txt}</div></div>`;
}
function tmplSideBySide(refs, ctx, preset, row) {
  const imgIds = refs.filter(id => ctx.isImage(id));
  let txtIds = refs.filter(id => !ctx.isImage(id));
  // row.img_col_refs names blocks that belong UNDER the images rather than in
  // the facing column — NCTB often runs an exercise beneath the illustration
  // while a poem occupies the full height of the other column
  const underIds = (row && Array.isArray(row.img_col_refs)) ? row.img_col_refs : [];
  if (underIds.length) txtIds = txtIds.filter(id => !underIds.includes(id));
  const imgFrac = (preset && preset.image_frac) || 0.5;
  const txtFrac = (preset && preset.text_frac) || 0.5;
  const gutter = (preset && preset.gutter_mm) || 6;
  const valign = (preset && preset.valign) || 'top';
  // several images share the column as a mini-grid (img_cols per row)
  const imgCols = (preset && preset.img_cols) || 1;
  const imgs = imgIds.map(id => renderImage(ctx.imageById(id), ctx.profile, ctx.imagesRel));
  const img = imgs.length <= 1 ? (imgs[0] || '')
    : `<div class="sb-col-img-grid">${imgs.map(h =>
        `<div style="width:calc((100% - ${(imgCols - 1) * 3}mm)/${imgCols})">${h}</div>`).join('')}</div>`;
  const txt = txtIds.map(id => renderBlockInner(ctx.blockById(id), ctx.lessonNo)).join('');
  const under = underIds.map(id => renderBlockInner(ctx.blockById(id), ctx.lessonNo)).join('');
  const cap = preset && preset.img_max_mm
    ? `;--sb-img-max:${preset.img_max_mm}mm;--sb-img-w:auto` : '';
  const imgCol = `<div class="sb-col-img" style="flex:${imgFrac}${cap}">${img}${under}</div>`;
  // text_side:'end' pushes the text block to the far edge of its column, so
  // image and text sit against opposite margins (text keeps its own alignment)
  const endCls = (preset && preset.text_side === 'end') ? ' sb-txt-end' : '';
  const txtCol = `<div class="sb-col-txt${endCls}" style="flex:${txtFrac}">${txt}</div>`;
  const flip = preset && preset.image_side === 'right'; // text first, images right
  return `<div class="sb-row sb-side-by-side" style="gap:${gutter}mm;align-items:${valign === 'center' ? 'center' : 'flex-start'}">` +
    (flip ? txtCol + imgCol : imgCol + txtCol) + '</div>';
}
function tmplTextInImage(refs, ctx, preset) {
  const imgId = refs.find(id => ctx.isImage(id));
  const txtIds = refs.filter(id => !ctx.isImage(id));
  let img = imgId ? renderImage(ctx.imageById(imgId), ctx.profile, ctx.imagesRel) : '';
  // split: '2x2' shows the four quadrants of one image with gutters between
  // them (adds breathing room to grid-of-figures art without new assets)
  if (img && preset && preset.split === '2x2') {
    const slot = ctx.imageById(imgId);
    const src = `${ctx.imagesRel}/${esc(slot.filename)}`;
    const grey = ctx.profile.greyscale ? ' sb-grey' : '';
    const [aw, ah] = String((preset && preset.aspect) || slot.aspect || '1:1').split(':').map(Number);
    const g = preset.gutter_mm != null ? preset.gutter_mm : 6;
    // split_y: where the horizontal cut falls (fraction of image height,
    // default 0.5) — lets the cut land in the artwork's own gap
    // split_y: single number, or [left, right] when the two columns of the
    // artwork need different cut heights
    const syRaw = preset.split_y != null ? preset.split_y : 0.5;
    const [syL, syR] = Array.isArray(syRaw) ? syRaw : [syRaw, syRaw];
    const cell = (mx, sy, bottom) => {
      const aspect = bottom ? `${aw}/${2 * (1 - sy) * ah}` : `${aw}/${2 * sy * ah}`;
      const ty = bottom ? -(sy / (1 - sy)) * 100 : 0;
      return `<div class="sb-quad" style="aspect-ratio:${aspect}">` +
        `<img class="sb-img${grey}" src="${src}" alt="" style="left:${mx}%;top:${ty}%" decoding="sync"></div>`;
    };
    img = `<div class="sb-quad-grid" style="gap:${g}mm">` +
      cell(0, syL, false) + cell(-100, syR, false) +
      cell(0, syL, true) + cell(-100, syR, true) + '</div>';
  }
  const frac = preset && preset.image_frac; // optional width cap, centered
  if (img && frac) img = `<div style="width:${Math.round(frac * 1000) / 10}%;margin:0 auto">${img}</div>`;
  const anchor = (preset && preset.anchor) || 'top-right';
  const maxW = (preset && preset.max_width_frac) || 0.45;
  const pad = (preset && preset.pad_mm) || 4;
  // positioned bubbles: 'plain' text sits inside bubbles drawn in the art;
  // 'pill' draws its own speech-balloon (NCTB style, art has no bubbles)
  const bubbleCls = (preset && preset.bubble_style === 'pill') ? 'sb-bubble-abs sb-bubble' : 'sb-bubble-abs';

  // speech-bubbles blocks may carry bubble_pos: [{x,y}|null,...] (fractions of
  // the image box) placing each line individually inside the artwork's own
  // drawn bubbles. Lines without a position fall back to the anchored overlay.
  let absHtml = '', overlayInner = '';
  for (const id of txtIds) {
    const block = ctx.blockById(id);
    if (block && block.layout_hint === 'speech-bubbles' && Array.isArray(block.bubble_pos)) {
      const lines = String(block.text_bn || '').split('\n').filter(Boolean);
      const rest = [];
      lines.forEach((line, i) => {
        const p = block.bubble_pos[i];
        if (p && typeof p.x === 'number' && typeof p.y === 'number') {
          // per-bubble style override: 'pill' draws its own balloon even when
          // the row default is plain (e.g. one phrase lacking a drawn bubble)
          const cls = p.style === 'pill' ? 'sb-bubble-abs sb-bubble'
            : p.style === 'plain' ? 'sb-bubble-abs' : bubbleCls;
          absHtml += `<span class="${cls}" data-block="${esc(block.id)}" data-bi="${i}"` +
            ` style="left:${(p.x * 100).toFixed(2)}%;top:${(p.y * 100).toFixed(2)}%">${esc(line)}</span>`;
        } else rest.push(line);
      });
      if (rest.length) {
        overlayInner += `<div class="sb-bubbles" data-fit>${
          rest.map(l => `<span class="sb-bubble">${esc(l)}</span>`).join('')}</div>`;
      }
    } else {
      overlayInner += renderBlockInner(block, ctx.lessonNo);
    }
  }
  const overlay = overlayInner
    ? `<div class="sb-overlay sb-anchor-${anchor}" style="max-width:${Math.round(maxW * 100)}%;padding:${pad}mm">${overlayInner}</div>`
    : '';
  return `<div class="sb-row sb-text-in-image">${img}${overlay}${absHtml}</div>`;
}
function tmplImageTextImage(refs, ctx, preset) {
  // images flanking a centre text column. Two image refs use one per side;
  // a single ref with preset.split === 'vertical' shows its left/right halves
  // (same asset placed once — keeps validator check 13 and image lineage intact).
  const imgIds = refs.filter(id => ctx.isImage(id));
  const txtIds = refs.filter(id => !ctx.isImage(id));
  const lf = (preset && preset.left_frac) || 0.3;
  const rf = (preset && preset.right_frac) || 0.3;
  const tf = (preset && preset.text_frac) || Math.max(0.1, +(1 - lf - rf).toFixed(3));
  const gutter = (preset && preset.gutter_mm) != null ? preset.gutter_mm : 6;
  const valign = (preset && preset.valign) === 'center' ? 'center' : 'flex-start';
  let left = '', right = '';
  if (imgIds.length === 1 && preset && preset.split === 'vertical') {
    const tag = renderImage(ctx.imageById(imgIds[0]), ctx.profile, ctx.imagesRel);
    left = `<div class="sb-img-half sb-half-left">${tag}</div>`;
    right = `<div class="sb-img-half sb-half-right">${tag}</div>`;
  } else {
    if (imgIds[0]) left = renderImage(ctx.imageById(imgIds[0]), ctx.profile, ctx.imagesRel);
    if (imgIds[1]) right = renderImage(ctx.imageById(imgIds[1]), ctx.profile, ctx.imagesRel);
  }
  const txt = txtIds.map(id => renderBlockInner(ctx.blockById(id), ctx.lessonNo)).join('');
  return `<div class="sb-row sb-image-text-image" style="gap:${gutter}mm;align-items:${valign}">` +
    `<div class="sb-iti-img" style="flex:${lf}">${left}</div>` +
    `<div class="sb-iti-text" style="flex:${tf}">${txt}</div>` +
    `<div class="sb-iti-img" style="flex:${rf}">${right}</div></div>`;
}

function tmplImageGrid(refs, ctx, preset) {
  // N images in equal columns, wrapping — the workhorse for বর্ণ-শিখি
  // object-word pictures (6-10 small images per lesson)
  const cols = (preset && preset.cols) || 3;
  const gutter = (preset && preset.gutter_mm) != null ? preset.gutter_mm : 4;
  const imgIds = refs.filter(id => ctx.isImage(id));
  // Optional captions: text refs in the same row become the labels under each
  // picture, so they line up with their image exactly (a separate word row
  // would centre on the page, not on the grid). Either one block per image,
  // or a single block whose words split one per image.
  const txtIds = refs.filter(id => !ctx.isImage(id));
  // when a composite is sliced, the cell count is the slice count, not the
  // number of image refs — captions must map to cells
  const nCells = (preset && preset.slice_x > 1 && imgIds.length === 1)
    ? preset.slice_x : imgIds.length;
  let caps = [];
  if (txtIds.length === nCells && nCells !== 1) {
    caps = txtIds.map(id => String((ctx.blockById(id) || {}).text_bn || '').trim());
  } else if (txtIds.length === 1) {
    const raw = String((ctx.blockById(txtIds[0]) || {}).text_bn || '');
    let w = raw.split(/[\n\t·]+/).map(s => s.trim()).filter(Boolean);
    if (w.length === 1 && /\s/.test(w[0])) w = w[0].split(/\s+/).filter(Boolean);
    if (w.length === nCells) caps = w;
  }
  // slice_x: one composite picture (objects in a row, baked into a single
  // file) shown as N separate cells with real gutters between them, so the
  // objects read as individual pictures. Needs the file's true pixel ratio.
  const slice = preset && preset.slice_x;
  let cells;
  if (slice > 1 && imgIds.length === 1) {
    const slot = ctx.imageById(imgIds[0]);
    const src = `${ctx.imagesRel}/${esc(slot.filename)}`;
    const grey = ctx.profile.greyscale ? ' sb-grey' : '';
    // band [y0,y1]: show only that vertical slice of the artwork — used to
    // crop off a composite's own baked-in labels so the page prints the words
    // once, from the text blocks
    const [y0, y1] = (preset.band && preset.band.length === 2) ? preset.band : [0, 1];
    const span = Math.max(0.05, y1 - y0);
    const topPct = -(y0 / span) * 100;
    // slice_bounds: explicit [x0,x1] per cell. Objects in a composite are
    // rarely spaced at exact fractions, so even slicing catches slivers of the
    // neighbours; measured bounds cut in the gaps between them.
    const bounds = (Array.isArray(preset.slice_bounds) && preset.slice_bounds.length === slice)
      ? preset.slice_bounds
      : Array.from({ length: slice }, (_, i) => [i / slice, (i + 1) / slice]);
    // each cell is as wide as its share of the artwork, so nothing is squashed
    const widths = bounds.map(([a, b]) => b - a);
    const total = widths.reduce((s, w) => s + w, 0);
    cells = bounds.map(([x0, x1], i) => {
      const w = Math.max(0.02, x1 - x0);
      const ratio = (preset.ratio || 1) * w / span;      // width/height of THIS slice
      const pct = (widths[i] / total) * 100;
      return `<div class="sb-grid-cell" style="width:calc((100% - ${(slice - 1) * gutter}mm)*${(pct / 100).toFixed(4)})">` +
        `<div class="sb-slice" style="aspect-ratio:${ratio.toFixed(4)}">` +
        `<img class="sb-img${grey}" src="${src}" alt=""` +
        ` style="width:${(100 / w).toFixed(2)}%;left:${(-(x0 / w) * 100).toFixed(2)}%;top:${topPct.toFixed(2)}%" decoding="sync">` +
        `</div>${caps[i] ? `<div class="sb-grid-cap">${esc(caps[i])}</div>` : ''}</div>`;
    }).join('');
  } else {
    cells = imgIds.map((id, i) =>
      `<div class="sb-grid-cell" style="width:calc((100% - ${(cols - 1) * gutter}mm)/${cols})">${
        renderImage(ctx.imageById(id), ctx.profile, ctx.imagesRel)}${
        caps[i] ? `<div class="sb-grid-cap">${esc(caps[i])}</div>` : ''}</div>`).join('');
  }
  const frac = preset && preset.image_frac; // optional overall width cap, centered
  const grid = `<div class="sb-grid-inner" style="gap:${gutter}mm">${cells}</div>`;
  // text refs that could NOT be mapped to captions still belong on the page —
  // render them below the grid rather than dropping them silently
  // …centred as a word list, since they don't line up with the pictures
  const leftover = caps.length ? '' : (txtIds.length
    ? `<div class="sb-leftover-words">${
        txtIds.map(id => renderBlockInner(ctx.blockById(id), ctx.lessonNo)).join('')}</div>`
    : '');
  return `<div class="sb-row sb-image-grid">${
    frac ? `<div style="width:${Math.round(frac * 1000) / 10}%;margin:0 auto">${grid}</div>` : grid
  }${leftover}</div>`;
}

/**
 * One strip image containing stacked story panels, each panel band cropped
 * out and shown with its caption(s) beneath (NCTB story-page style).
 * Row fields: aspect: "W:H" of the strip file; panels: [{band:[y0,y1],
 * caps:[i,...]}] where caps index into the row's text refs (in order).
 * The strip is placed ONCE (validator check 13); bands are CSS crops.
 */
function tmplPanelCaptions(refs, ctx, preset, row) {
  const imgId = refs.find(id => ctx.isImage(id));
  const txtIds = refs.filter(id => !ctx.isImage(id));
  const slot = imgId && ctx.imageById(imgId);
  if (!slot) return '<div class="sb-row sb-unknown">[panel-captions: no image]</div>';
  const src = `${ctx.imagesRel}/${esc(slot.filename)}`;
  const grey = ctx.profile.greyscale ? ' sb-grey' : '';
  const [aw, ah] = String((row && row.aspect) || slot.aspect || '1:1').split(':').map(Number);
  const frac = (preset && preset.image_frac) || 1;
  const groups = ((row && row.panels) || [{ band: [0, 1], caps: txtIds.map((_, i) => i) }]).map(p => {
    const [y0, y1] = p.band;
    const shift = -(y0 / (y1 - y0)) * 100;
    const bandImg = `<div class="sb-band" style="aspect-ratio:${aw}/${((y1 - y0) * ah).toFixed(3)}">` +
      `<img class="sb-img${grey}" src="${src}" alt="" style="top:${shift.toFixed(2)}%" decoding="sync"></div>`;
    const caps = (p.caps || []).map(i => txtIds[i]).filter(Boolean)
      .map(id => renderBlockInner(ctx.blockById(id), ctx.lessonNo)).join('');
    const w = p.w != null ? p.w : frac; // per-panel width lets panels sit 2-up
    return `<div class="sb-panel-group" style="width:${Math.round(w * 1000) / 10}%">${bandImg}${caps}</div>`;
  }).join('');
  return `<div class="sb-row sb-panel-captions">${groups}</div>`;
}

/**
 * NCTB letter-lesson body: one row per letter —
 *   [picture] [sentence(s)] [keyword] [big letter]
 * refs: the spotlight-pairs block ("keyword<TAB>letter" per line), the
 * sentences block, then one image per letter in order. Sentences map one per
 * letter, with any extra lines joining the last (the closing rhyme couplet);
 * row.sent_map overrides that split explicitly.
 */
function tmplLetterRows(refs, ctx, preset, row) {
  const imgIds = refs.filter(id => ctx.isImage(id));
  const txtIds = refs.filter(id => !ctx.isImage(id));
  const pairsBlock = ctx.blockById(txtIds[0]);
  const sentBlock = txtIds[1] ? ctx.blockById(txtIds[1]) : null;
  // the keyword block is normally "keyword<TAB>letter" per line; some lessons
  // keep the letters in a separate block, so row.letters supplies them
  const rowLetters = (row && Array.isArray(row.letters)) ? row.letters : null;
  // split on NEWLINES only — a tab separates keyword from letter within a line
  const pairs = String((pairsBlock && pairsBlock.text_bn) || '').split('\n')
    .map(s => s.trim()).filter(Boolean)
    .map((line, i) => {
      const [kw, letter] = line.split(/\t+/);
      return { kw: kw || '', letter: letter || (rowLetters ? rowLetters[i] || '' : '') };
    });
  // sentences may live in ONE block (a line per letter) or in one block per
  // letter — accept both
  const perLetterBlocks = txtIds.length - 1 === pairs.length && pairs.length > 1;
  const lines = t => String(t || '').split('\n').map(s => s.trim()).filter(Boolean);

  let groups;
  if (perLetterBlocks) {
    // one block per letter — a block's own line breaks are the couplet breaks
    // NCTB sets (রং দিয়ে ছবি আঁকি, / ফুল ফল গাছ পাখি।)
    groups = txtIds.slice(1).map(id => lines((ctx.blockById(id) || {}).text_bn));
  } else {
    const sents = lines(sentBlock && sentBlock.text_bn);
    groups = [];
    if (row && Array.isArray(row.sent_map)) {
      let k = 0;
      for (const n of row.sent_map) { groups.push(sents.slice(k, k + n)); k += n; }
    } else {
      for (let i = 0; i < pairs.length; i++) {
        groups.push(i === pairs.length - 1 ? sents.slice(i) : sents.slice(i, i + 1));
      }
    }
  }

  const imgPct = Math.round(((preset && preset.image_frac) || 0.3) * 1000) / 10;
  // preset.sent_pt scales the sentence and keyword columns together, so the
  // reading line and the word it teaches stay the same size
  const sentPt = (preset && preset.sent_pt) || null;
  const sentStyle = sentPt ? ` style="font-size:${sentPt}pt"` : '';
  const body = pairs.map((p, i) => {
    const img = imgIds[i] ? renderImage(ctx.imageById(imgIds[i]), ctx.profile, ctx.imagesRel) : '';
    // NCTB colour code: within the keyword — in the sentence and in the
    // keyword column — only the letter being taught is red
    const sent = (groups[i] || [])
      .map(s => `<div>${markLetterInSentence(s, p.kw, p.letter)}</div>`).join('');
    return '<div class="sb-lr-row">' +
      `<div class="sb-lr-img" style="flex:0 0 ${imgPct}%">${img}</div>` +
      `<div class="sb-lr-sent"${sentStyle}>${sent}</div>` +
      `<div class="sb-lr-key"${sentStyle}>${markLetter(p.kw, p.letter)}</div>` +
      `<div class="sb-lr-letter">${esc(p.letter)}</div></div>`;
  }).join('');
  return `<div class="sb-row sb-letter-rows">${body}</div>`;
}

/**
 * word-build — NCTB "ছবি দেখি শব্দ বানাই": a lead letter tile spanning a
 * column of second-letter tiles, each with an empty box for the child to
 * write the word it makes.
 *
 *        [ল] [______]
 *   [ব]  [ই] [______]
 *        [ক] [______]
 *
 * refs: for each group, one "letter-tiles" block (lead<TAB>rest…) followed by
 * one block per word it builds. The word blocks size the column — NCTB leaves
 * the boxes blank, so the words themselves are the answer key and are not
 * printed. A vector_asset slot in the refs is consumed here (this template IS
 * that asset) rather than left as an empty placeholder.
 */
function tmplWordBuild(refs, ctx, preset, row) {
  const txtIds = refs.filter(id => !ctx.isImage(id));
  // group: a tiles block starts a new group; following blocks are its words
  const groups = [];
  for (const id of txtIds) {
    const b = ctx.blockById(id);
    if (!b) continue;
    const tiles = String(b.text_bn || '').split(/\t+/).map(s => s.trim()).filter(Boolean);
    if (b.layout_hint === 'letter-tiles' || (!groups.length && tiles.length > 1)) {
      groups.push({ lead: tiles[0] || '', rest: tiles.slice(1), words: [] });
    } else if (groups.length) {
      groups[groups.length - 1].words.push(String(b.text_bn || '').trim());
    }
  }
  const boxW = (preset && preset.box_mm) || 32;
  const tile = (preset && preset.tile_mm) || 11;
  const tileStyle = ` style="width:${tile}mm;height:${tile}mm"`;
  const body = groups.map(g => {
    // one row per second letter; the words confirm the count
    const n = Math.max(g.rest.length, g.words.length);
    const rows = Array.from({ length: n }, (_, i) => {
      const t = g.rest[i] || '';
      // colour by letter, not by position, so a letter reused in another group
      // keeps its tile colour — NCTB does the same (ই is yellow in both)
      const c = t ? t.codePointAt(0) % 3 : 0;
      return '<div class="sb-wb-r">' +
        `<span class="sb-wb-tile sb-wb-t${c}"${tileStyle}>${esc(t)}</span>` +
        `<span class="sb-wb-box" style="width:${boxW}mm;height:${tile}mm"></span></div>`;
    }).join('');
    return '<div class="sb-wb-group">' +
      `<span class="sb-wb-tile sb-wb-lead"${tileStyle}>${esc(g.lead)}</span>` +
      `<div class="sb-wb-rows">${rows}</div></div>`;
  }).join('');
  return `<div class="sb-row sb-wordbuild">${body}</div>`;
}

/**
 * trace-panel — the "পড়ি ও লিখি" ruled panel. refs: the tab-separated word
 * block, plus optionally the vector_asset slot this row IS (consumed here so
 * it does not also render as an empty placeholder).
 */
function tmplTracePanel(refs, ctx, preset, row) {
  const txtIds = refs.filter(id => !ctx.isImage(id));
  const b = ctx.blockById(txtIds[0]);
  const items = String((b && b.text_bn) || '').split(/[\t\n]+/)
    .map(s => s.trim()).filter(Boolean);
  if (!items.length) return '';
  return `<div class="sb-row">${renderTracePanel(items, ctx.profile, preset || {})}</div>`;
}

/**
 * in-artwork — the block's text is lettering INSIDE an illustration on this
 * page (signboards, banners), so printing it again would duplicate what the
 * reader already sees. The row places the blocks — keeping the orphan guard
 * meaningful and recording where the text went — and draws nothing.
 */
function tmplInArtwork() { return ''; }

/**
 * zigzag-pairs — NCTB's caption-and-picture ladder: each sentence sits beside
 * its picture, and the picture alternates sides down the page. refs pair up in
 * order (block, block, … then image, image, …).
 */
function tmplZigzagPairs(refs, ctx, preset) {
  const imgIds = refs.filter(id => ctx.isImage(id));
  const txtIds = refs.filter(id => !ctx.isImage(id));
  const frac = Math.round(((preset && preset.image_frac) || 0.45) * 1000) / 10;
  const cap = preset && preset.img_max_mm ? `max-height:${preset.img_max_mm}mm;width:auto` : '';
  const rows = txtIds.map((tid, i) => {
    const img = imgIds[i]
      ? `<div class="sb-zz-img" style="flex:0 0 ${frac}%">${
          renderImage(ctx.imageById(imgIds[i]), ctx.profile, ctx.imagesRel)}</div>` : '';
    const txt = `<div class="sb-zz-txt">${renderBlockInner(ctx.blockById(tid), ctx.lessonNo)}</div>`;
    // even rows put the picture on the right, odd rows on the left
    const side = i % 2 === 0 ? txt + img : img + txt;
    return `<div class="sb-zz-row">${side}</div>`;
  }).join('');
  return `<div class="sb-row sb-zigzag" style="${cap ? `--sb-zz-cap:${preset.img_max_mm}mm` : ''}">${rows}</div>`;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
function bnToInt(s) {
  const d = String(s).trim().replace(/[০-৯]/g, c => String(BN_DIGITS.indexOf(c)));
  const n = parseInt(d, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * numeral-list — NCTB's counting ladder: numeral, then what it counts.
 * The source splits these entries across blocks by provenance (NCTB-kept vs
 * edited), NOT by value, so this merges every ref and sorts by the numeral —
 * otherwise the page reads ১ ২ ৫ ৭ ৮ … ৩ ৪ ৬. preset.range picks the slice for
 * this page, so one content block can span several pages.
 */
function tmplNumeralList(refs, ctx, preset, row) {
  const entries = refs.filter(id => !ctx.isImage(id))
    .flatMap(id => String((ctx.blockById(id) || {}).text_bn || '').split('\n'))
    .map(s => s.trim()).filter(Boolean)
    .map(line => { const [n, label] = line.split(/\t+/); return { n, v: bnToInt(n), label: label || '' }; })
    .filter(e => e.v != null)
    .sort((a, b) => a.v - b.v);
  const r = (preset && preset.range) || null;
  const shown = r ? entries.filter(e => e.v >= r[0] && e.v <= r[1]) : entries;
  // row.sprites gives each numeral its own picture, cropped out of a composite
  // counting chart — NCTB prints a separate picture per entry, and our art is
  // two charts. Each spec is { img, rect:[x,y,w,h] fractions, ar: crop aspect }.
  const sprites = (row && row.sprites) || null;
  const spriteH = (preset && preset.sprite_h_mm) || 13;
  // a wide crop (ten objects in a row) would otherwise squeeze the label,
  // so cap the width and let the height follow the aspect ratio
  const spriteMaxW = (preset && preset.sprite_max_w_mm) || 30;
  const sprite = (v) => {
    const s = sprites && sprites[String(v)];
    const slot = s && ctx.imageById(s.img);
    if (!slot || !slot.filename) return '';
    const [rx, ry, rw, rh] = s.rect;
    const grey = ctx.profile.greyscale ? ' sb-grey' : '';
    const w = Math.min(spriteH * s.ar, spriteMaxW);
    return `<span class="sb-sprite" style="width:${w.toFixed(1)}mm;height:${(w / s.ar).toFixed(1)}mm">` +
      `<img class="${grey.trim()}" src="${ctx.imagesRel}/${esc(slot.filename)}" alt="" decoding="sync"` +
      ` style="width:${(100 / rw).toFixed(2)}%;left:${(-rx / rw * 100).toFixed(2)}%;` +
      `top:${(-ry / rh * 100).toFixed(2)}%"></span>`;
  };
  // NCTB order down the row: picture, what it counts, then the numeral
  const rows = shown.map(e =>
    '<div class="sb-nl-row">' +
    `<span class="sb-nl-pic">${sprite(e.v)}</span>` +
    `<span class="sb-nl-label">${esc(e.label)}</span>` +
    `<span class="sb-nl-num">${esc(e.n)}</span></div>`).join('');
  // the charts are already on the page one crop at a time; drawing them whole
  // as well would print every picture twice
  const imgIds = sprites ? [] : refs.filter(id => ctx.isImage(id));
  const imgs = imgIds.map(id => renderImage(ctx.imageById(id), ctx.profile, ctx.imagesRel)).join('');
  const frac = Math.round(((preset && preset.image_frac) || 0.45) * 1000) / 10;
  const imgCol = imgs ? `<div class="sb-nl-img" style="flex:0 0 ${frac}%">${imgs}</div>` : '';
  // preset.cols flows the ladder into columns — 20 entries in one column is
  // taller than a page, and NCTB's own counting charts are two-up
  const cols = (preset && preset.cols) || 1;
  return `<div class="sb-row sb-numeral-list">` +
    `<div class="sb-nl-rows" style="--nl-cols:${cols}">${rows}</div>${imgCol}</div>`;
}

const TEMPLATES = {
  'image-only': tmplImageOnly,
  'in-artwork': tmplInArtwork,
  'numeral-list': tmplNumeralList,
  'zigzag-pairs': tmplZigzagPairs,
  'word-build': tmplWordBuild,
  'trace-panel': tmplTracePanel,
  'text-only': tmplTextOnly,
  'image-above-text': tmplImageAboveText,
  'side-by-side': tmplSideBySide,
  'text-in-image': tmplTextInImage,
  'image-text-image': tmplImageTextImage,
  'image-grid': tmplImageGrid,
  'panel-captions': tmplPanelCaptions,
  'letter-rows': tmplLetterRows,
};

/* ---------- per-lesson composition ---------- */
/**
 * A layout row may carry an optional "page" (1-based, default 1) to split a
 * long lesson across multiple .sb-page blocks (the fit-guard-sanctioned fix
 * for one-page overflow). Returns ONE <section> string per page, each with
 * the NCTB cross-reference repeated (it must appear on every page).
 */
function composeLessonPages(lesson, book, profile, imagesRel) {
  const blocks = new Map((lesson.blocks || []).map(b => [b.id, b]));
  const images = new Map((lesson.image_slots || []).map(s => [s.id, s]));
  const presets = book.layout_presets || {};
  const ctx = {
    profile, imagesRel,
    lessonNo: lesson.lesson_no,
    blockById: id => blocks.get(id),
    imageById: id => images.get(id),
    isImage: id => images.has(id),
  };

  const pageRows = new Map(); // page no -> accumulated rows html
  const add = (no, html) => pageRows.set(no, (pageRows.get(no) || '') + html);

  if (Array.isArray(lesson.layout) && lesson.layout.length) {
    const ordered = [...lesson.layout]
      .sort((a, b) => ((a.page || 1) - (b.page || 1)) || (a.row - b.row));
    for (const row of ordered) {
      const tmpl = TEMPLATES[row.arrangement];
      const preset = row.preset ? presets[row.preset] : null;
      const html = tmpl
        ? tmpl(row.refs || [], ctx, preset, row)
        : `<div class="sb-row sb-unknown">[unknown arrangement: ${esc(row.arrangement)}]</div>`;
      // tag the row's outer div so tooling (layout preview/editor) can map
      // DOM back to book.json; inert for print rendering
      add(row.page || 1, html.replace('<div class="sb-row', `<div data-sb-lesson="${lesson.lesson_no}" data-sb-row="${row.row}"` +
        ` data-sb-arr="${esc(row.arrangement)}"${row.preset ? ` data-sb-preset="${esc(row.preset)}"` : ''} class="sb-row`));
    }
  } else {
    // document-order fallback: blocks then images, stacked
    let rowsHtml = '';
    for (const b of (lesson.blocks || [])) rowsHtml += `<div class="sb-row sb-text-only">${renderBlockInner(b, lesson.lesson_no)}</div>`;
    for (const s of (lesson.image_slots || [])) rowsHtml += `<div class="sb-row sb-image-only">${renderImage(s, profile, imagesRel)}</div>`;
    add(1, rowsHtml);
  }

  // bottom-left furniture: chapter number + NCTB page cross-reference
  // (D-006 সহায়িকা posture — the cross-ref must appear on every page).
  // The book's own sequential page number is added bottom-right by composeBook.
  const marker = `<div class="sb-lesson-no">${lessonMarker(lesson)}</div>`;

  // lesson.spread: distribute leftover vertical space between rows so a short
  // page fills the sheet instead of stacking at the top
  const cls = lesson.spread ? 'sb-lesson sb-spread' : 'sb-lesson';
  // gap_mm: tighten the space between rows on a dense lesson
  const style = lesson.gap_mm != null ? ` style="gap:${lesson.gap_mm}mm"` : '';
  return [...pageRows.keys()].sort((a, b) => a - b).map(no =>
    `<section class="${cls}"${style} data-lesson="${lesson.lesson_no}">${marker}${pageRows.get(no)}</section>`);
}

function composeLesson(lesson, book, profile, imagesRel) {
  return composeLessonPages(lesson, book, profile, imagesRel).join('');
}

/* ---------- base CSS (built new; encodes geometry + profile) ---------- */
function baseCss(profile) {
  const { SHEET } = geometry;
  const m = geometry.MARGIN;
  return `
  @page { size: ${SHEET.width_mm}mm ${SHEET.height_mm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: ${profile.background}; }
  * { box-sizing: border-box; }
  .sb-page {
    width: ${SHEET.width_mm}mm; height: ${SHEET.height_mm}mm;
    /* bottom margin +5mm: breathing room between content and the footer line;
       the fit guard measures against this, so no content can crowd the footer */
    padding: ${m.top_mm}mm ${m.outer_mm}mm ${m.bottom_mm + 5}mm ${m.inner_mm}mm;
    background: ${profile.background};
    page-break-after: always; overflow: hidden; position: relative;
  }
  .sb-lesson { display: flex; flex-direction: column; gap: 6mm; height: 100%; }
  .sb-lesson.sb-spread { justify-content: space-between; }
  .sb-page-no { position: absolute; bottom: 6mm; left: 0; right: 0; text-align: center;
    font: 400 10pt "NotoSerifBengali", serif; color: #444; }
  .sb-lesson-no { position: absolute; bottom: 6mm; left: ${m.inner_mm}mm;
    font: 400 10pt "NotoSerifBengali", serif; color: #444; }
  .sb-row { position: relative; }
  .sb-title { font: 500 26pt "NotoSerifBengali", serif; margin: 0 0 2mm;
    text-align: center; color: ${profile.greyscale ? '#000' : '#1B8FBF'}; }
  .sb-chapter { display: block; text-align: center;
    font: 700 16pt "NotoSerifBengali", serif; margin: 0 0 1mm;
    color: ${profile.greyscale ? '#000' : '#C0392B'}; }
  .sb-section { font: 500 16pt "NotoSerifBengali", serif; margin: 3mm 0 1mm;
    color: ${profile.greyscale ? '#000' : '#C0392B'}; }
  .sb-rhyme-title { font: 600 17pt "NotoSerifBengali", serif; margin: 1mm 0 2mm; }
  .sb-text, .sb-caption { font: 400 14pt "NotoSerifBengali", serif; line-height: 1.6; margin: 0; }
  .sb-caption { color: ${profile.greyscale ? '#000' : '#C0392B'};
    font-weight: ${profile.greyscale ? '600' : '400'}; }
  .sb-form-line { font: 400 13pt "NotoSerifBengali", serif; padding: 1.4mm 0;
    display: flex; align-items: baseline; gap: 2mm; }
  .sb-rule { flex: 1; min-width: 20mm; border-bottom: 0.35mm solid #333; }
  .sb-dialogue { border-collapse: collapse; width: 100%; font: 400 14pt "NotoSerifBengali", serif; }
  .sb-dlg-who { font-weight: 500; padding: 1.5mm 3mm 1.5mm 0; vertical-align: top; white-space: nowrap; }
  .sb-dlg-colon { padding: 1.5mm 3mm 1.5mm 0; vertical-align: top; width: 1mm; }
  .sb-dlg-said { padding: 1.5mm 0; }
  .sb-qa-list { display: flex; flex-direction: column; gap: 1mm; font: 400 14pt "NotoSerifBengali", serif; }
  .sb-questions { font: 400 14pt "NotoSerifBengali", serif; line-height: 1.8; margin: 0; }
  .sb-bubbles { display: flex; flex-wrap: wrap; gap: 3mm; }
  .sb-bubble { font: 400 13pt "NotoSerifBengali", serif; background: ${profile.greyscale ? '#FFF' : '#E1F5EE'};
    border: 0.4mm solid ${profile.greyscale ? '#000' : '#5DCAA5'}; border-radius: 4mm; padding: 2mm 4mm; }
  .sb-img { max-width: 100%; height: auto; display: block; }
  .sb-grey { filter: grayscale(1) contrast(1.15); }
  .sb-image-only { display: flex; justify-content: center; }
  .sb-image-above-text .sb-below { margin-top: 4mm; }
  .sb-side-by-side { display: flex; }
  /* img_max_mm caps a tall illustration so it cannot push the column past the
     page. It sets --sb-img-w:auto too, so width follows the capped height and
     the aspect ratio is never distorted. */
  .sb-col-img img { max-width: 100%; height: auto; margin: 0 auto;
    width: var(--sb-img-w, 100%); max-height: var(--sb-img-max, none); }
  .sb-col-img-grid { display: flex; flex-wrap: wrap; gap: 3mm; justify-content: center; }
  .sb-txt-end { display: flex; justify-content: flex-end; }
  .sb-text-in-image { position: relative; }
  .sb-overlay { position: absolute; background: rgba(255,255,255,0.9);
    border: 0.3mm solid #999; border-radius: 3mm; }
  .sb-anchor-top-right { top: 3mm; right: 3mm; }
  .sb-anchor-top-left { top: 3mm; left: 3mm; }
  .sb-anchor-bottom-right { bottom: 3mm; right: 3mm; }
  .sb-anchor-bottom-left { bottom: 3mm; left: 3mm; }
  .sb-vector { border: 0.4mm dashed #999; padding: 8mm; text-align: center; color: #666;
    font: 400 12pt "NotoSerif", serif; }
  .sb-read-large { display: flex; gap: 16mm; flex-wrap: wrap; justify-content: center;
    font: 700 28pt "NotoSerifBengali", serif;
    color: ${profile.greyscale ? '#000' : '#C0392B'}; }
  .sb-sentences { text-align: center; }
  .sb-word-list { display: flex; margin: 1mm 0;
    font: 400 14pt "NotoSerifBengali", serif; }
  .sb-word-list span { flex: 1; text-align: center; }
  .sb-exercise { font: 500 14pt "NotoSerifBengali", serif; margin: 0;
    color: ${profile.greyscale ? '#000' : '#C0392B'}; }
  /* NCTB stacks the kar cells, one per line, centred on the page */
  .sb-kar-intro { display: flex; flex-direction: column; align-items: center; gap: 2mm;
    font: 400 15pt "NotoSerifBengali", serif; margin: 2mm 0; }
  .sb-kar-pair { display: inline-flex; align-items: center; gap: 4mm; }
  .sb-kar-pair > span:first-child { min-width: 20mm; }
  .sb-kar-box { display: inline-flex; align-items: center; justify-content: center;
    min-width: 14mm; height: 12mm; border: 0.4mm solid #333; border-radius: 1mm;
    font: 600 18pt "NotoSerifBengali", serif;
    color: ${profile.greyscale ? '#000' : '#C0392B'}; }
  .sb-picword-lg { text-align: center; font: 600 24pt "NotoSerifBengali", serif; margin: 2mm 0; }
  .sb-picword { display: inline-block; width: 50%; text-align: center;
    font: 400 14pt "NotoSerifBengali", serif; }
  .sb-kar-trace-row { display: flex; gap: 8mm; justify-content: center; margin: 3mm 0; }
  .sb-kar-trace { width: 26mm; height: 32mm; }
  .sb-kt-solid { fill: ${profile.greyscale ? '#000' : '#C0392B'}; }
  .sb-kar-chart { display: grid; grid-template-columns: 1fr 1fr; gap: 7mm 16mm;
    justify-items: center; margin: 3mm 0; }
  .sb-kar-cell { display: flex; gap: 2mm; }
  .sb-kar-solo { grid-column: 1 / -1; }
  .sb-kar-tile { width: 21mm; height: 21mm; display: flex; align-items: center;
    justify-content: center; border-radius: 1mm;
    font: 600 24pt "NotoSerifBengali", serif;
    ${profile.greyscale ? 'border: 0.4mm solid #000; background: #FFF;' : ''} }
  ${profile.greyscale ? '' : `.sb-kt-0 .sb-kar-tile { background: #DCC9EA; }
  .sb-kt-1 .sb-kar-tile { background: #C3D7F5; } .sb-kt-2 .sb-kar-tile { background: #C9E7C2; }
  .sb-kt-3 .sb-kar-tile { background: #F7E6A8; } .sb-kt-4 .sb-kar-tile { background: #F8C9A0; }
  .sb-kt-5 .sb-kar-tile { background: #F6C6CE; }`}
  .sb-vowel-grid { border-collapse: collapse; margin: 2mm auto; }
  .sb-vowel-grid td { border: 0.4mm solid #333; width: 26mm; height: 14mm; text-align: center;
    font: 600 20pt "NotoSerifBengali", serif; background: ${profile.greyscale ? '#FFF' : '#DCEEEA'};
    color: ${profile.greyscale ? '#000' : '#C0392B'}; }
  .sb-cv-solid { display: flex; gap: 7mm; justify-content: center; flex-wrap: wrap;
    font: 700 34pt "NotoSerifBengali", serif; margin: 3mm 0; }
  ${profile.greyscale
    ? '.sb-cv-0,.sb-cv-1,.sb-cv-2,.sb-cv-3,.sb-cv-4,.sb-cv-5,.sb-cv-6 { color: #000; }'
    : `.sb-cv-0 { color: #C0392B; } .sb-cv-1 { color: #1F7A8C; } .sb-cv-2 { color: #2E8B57; }
  .sb-cv-3 { color: #E67E22; } .sb-cv-4 { color: #7D3C98; } .sb-cv-5 { color: #C9A227; }
  .sb-cv-6 { color: #D81B60; }`}
  .sb-cv-outline { display: flex; gap: 6mm; justify-content: center; flex-wrap: wrap; margin: 4mm 0; }
  .sb-cv-svg { width: 35mm; height: 43mm; } /* 4 per row, as NCTB wraps them */
  .sb-outline-text { fill: none; stroke: ${profile.greyscale ? '#000' : '#555'}; stroke-width: 1.1; }
  .sb-word-row { display: flex; gap: 10mm; justify-content: center; flex-wrap: wrap;
    font: 600 22pt "NotoSerifBengali", serif; margin: 3mm 0; }
  .sb-bank { display: flex; gap: 8mm; justify-content: center; flex-wrap: wrap;
    font: 700 26pt "NotoSerifBengali", serif; margin: 2mm 0 5mm; }
  .sb-box-grid { display: flex; gap: 6mm; justify-content: center; flex-wrap: wrap; }
  .sb-write-box-lg { width: 41mm; height: 55mm; border: 0.35mm solid #888; border-radius: 1mm; }
  .sb-letter-row { display: flex; gap: 10mm; justify-content: center; flex-wrap: wrap;
    font: 600 22pt "NotoSerifBengali", serif; margin: 2mm 0; }
  .sb-arrange { display: flex; gap: 9mm; justify-content: center; flex-wrap: wrap; margin: 2mm 0; }
  .sb-arrange-col { display: flex; flex-direction: column; align-items: center; gap: 2mm;
    font: 600 22pt "NotoSerifBengali", serif; }
  .sb-write-box { width: 15mm; height: 15mm; border: 0.35mm solid #888; border-radius: 1mm; }
  .sb-trace { display: flex; flex-direction: column; gap: 3mm; }
  .sb-trace-row { display: flex; gap: 4mm; justify-content: center; flex-wrap: wrap; }
  .sb-trace-cell { border: 0.3mm solid #AAA; border-radius: 1mm; height: 24mm; }
  .sb-trace-svg { width: 100%; height: 100%; display: block; }
  /* grow to fill the page and space the letter rows evenly, as NCTB does */
  .sb-letter-rows { display: flex; flex-direction: column; gap: 4mm;
    flex: 1 1 auto; justify-content: space-evenly; }
  .sb-lr-row { display: flex; align-items: center; gap: 5mm; }
  /* cap row height so a tall picture can't stretch its letter row */
  .sb-lr-img img { width: 100%; max-height: 30mm; object-fit: contain; }
  .sb-lr-sent { flex: 1; font: 400 13pt "NotoSerifBengali", serif; line-height: 1.5; }
  .sb-lr-key { flex: 0 0 22mm; text-align: center; font: 400 13pt "NotoSerifBengali", serif; }
  /* the taught letter inside a word */
  .sb-hi { color: ${profile.greyscale ? '#000' : '#C0392B'};
    font-weight: ${profile.greyscale ? '700' : '600'}; }
  .sb-lr-letter { flex: 0 0 16mm; text-align: center;
    font: 700 22pt "NotoSerifBengali", serif;
    color: ${profile.greyscale ? '#000' : '#C0392B'}; }
 /* address form: tinted label column, blank cell to write in */
  .sb-label-form { border-collapse: collapse; width: 100%; margin: 3mm 0 6mm; }
  .sb-label-form td { border: 0.4mm solid #333; height: 16mm; }
  .sb-lf-label { width: 34%; padding: 0 3mm; white-space: pre-line;
    font: 400 13pt "NotoSerifBengali", serif;
    background: ${profile.greyscale ? '#FFFFFF' : '#FCF3C8'}; }
  .sb-lf-cell { background: ${profile.greyscale ? '#FFFFFF' : '#DCEEF8'}; }
  /* closing badge */
  .sb-end-badge-wrap { text-align: center; margin: 4mm 0; }
  .sb-end-badge { display: inline-block; padding: 2.5mm 12mm; border-radius: 8mm;
    font: 400 14pt "NotoSerifBengali", serif;
    color: ${profile.greyscale ? '#000' : '#FFFFFF'};
    background: ${profile.greyscale ? '#FFFFFF' : '#1B2C7A'};
    border: 0.4mm solid ${profile.greyscale ? '#000' : 'transparent'}; }
 /* the letter a word-game passes along */
  .sb-chain { color: ${profile.greyscale ? '#000' : '#E8720C'};
    font-weight: ${profile.greyscale ? '700' : '600'}; }
 /* term - meaning columns with the dash aligned */
  .sb-dash-pairs { display: flex; flex-direction: column; gap: 2mm; margin: 1mm 0 3mm;
    font: 400 13pt "NotoSerifBengali", serif; }
  .sb-dp2-row { display: flex; align-items: baseline; gap: 3mm; }
  .sb-dp2-term { flex: 0 0 32mm; }
  .sb-dp2-dash { flex: 0 0 auto; }
  .sb-dp2-def { flex: 1; }
 /* counting ladder: numeral then what it counts */
  .sb-numeral-list { display: flex; gap: 6mm; align-items: flex-start; flex: 1 1 auto; }
  .sb-nl-rows { flex: 1; columns: var(--nl-cols, 1); column-gap: 8mm; }
  .sb-nl-row { display: flex; align-items: baseline; gap: 4mm;
    break-inside: avoid; margin-bottom: 4mm; }
  .sb-nl-pic { flex: 0 0 auto; display: flex; align-items: center; }
  .sb-sprite { position: relative; overflow: hidden; display: inline-block; flex: 0 0 auto; }
  .sb-sprite img { position: absolute; max-width: none; height: auto; }
  .sb-nl-label { flex: 1; }
  .sb-nl-num { flex: 0 0 12mm; text-align: right;
    font: 700 19pt "NotoSerifBengali", serif;
    color: ${profile.greyscale ? '#000' : '#C0392B'}; }
  .sb-nl-label { font: 400 14pt "NotoSerifBengali", serif;
    color: ${profile.greyscale ? '#000' : '#C0392B'}; }
  .sb-nl-img img { width: 100%; }
  /* several "word ______" items across one line */
  .sb-inline-blanks { display: flex; flex-wrap: wrap; gap: 4mm 10mm; margin: 2mm 0 3mm;
    font: 400 14pt "NotoSerifBengali", serif; }
  .sb-ib-item { display: flex; align-items: baseline; gap: 2mm; min-width: 46mm; }
  .sb-ib-item .sb-rule { min-width: 28mm; }
  /* bordered fill-in grid */
  .sb-word-grid { border-collapse: collapse; margin: 2mm 0 3mm; width: 100%; }
  .sb-word-grid td { border: 0.35mm solid #333; height: 13mm; width: 20%;
    text-align: center; font: 400 14pt "NotoSerifBengali", serif; }
 /* heading + numbered write-on lines */
  .sb-numbered-rows { display: flex; flex-direction: column; gap: 8mm; margin: 2mm 0 3mm; }
  .sb-numbered-rows .sb-instruction { margin: 0; }
  .sb-numbered-rows .sb-nb-item { gap: 3mm; }
  .sb-numbered-rows .sb-ruled-line { flex: 1; }
 /* a word, then a rule to write a sentence with it */
  .sb-word-write { display: flex; flex-direction: column; gap: 4mm;
    margin: 2mm 0 3mm 8mm; font: 400 13pt "NotoSerifBengali", serif; }
  .sb-ww-row { display: flex; align-items: baseline; gap: 3mm; }
  .sb-ww-word { flex: 0 0 18mm; }
  .sb-ww-row .sb-ruled-line { flex: 1; }
 /* caption-and-picture ladder, picture alternating sides */
  .sb-zigzag { display: flex; flex-direction: column; gap: 4mm; }
  .sb-zz-row { display: flex; align-items: center; gap: 5mm; }
  .sb-zz-txt { flex: 1; }
  .sb-zz-img img { width: 100%; max-height: var(--sb-zz-cap, none); }
  /* week-as-a-train */
  .sb-train { display: flex; align-items: flex-end; gap: 1mm; margin: 3mm 0 4mm;
    justify-content: center; }
  .sb-train-engine { width: 24mm; height: 18mm; flex: 0 0 auto; }
  .sb-car { display: flex; flex-direction: column; align-items: stretch; flex: 1 1 0; min-width: 0; }
  .sb-car-body { border: 0.5mm solid; border-radius: 1.2mm; padding: 1.6mm 1mm;
    text-align: center; font: 400 8.5pt "NotoSerifBengali", serif; background: #FFFFFF; }
  .sb-car-wheels { height: 3mm; margin: 0.6mm 2mm 0;
    background: radial-gradient(circle 1.4mm at 25% 50%, #E8A33D 98%, transparent 0),
                radial-gradient(circle 1.4mm at 75% 50%, #E8A33D 98%, transparent 0); }
  ${[0, 1, 2, 3, 4, 5, 6].map((i) => {
    const cols = ['#C0392B', '#1F8A4C', '#1F6FB2', '#7D5BA6', '#D98324', '#1F8A8A', '#B03A6E'];
    return `.sb-car-c${i} .sb-car-body { border-color: ${profile.greyscale ? '#333' : cols[i]}; }`;
  }).join('\n  ')}
  /* যুক্তবর্ণ table: word, the conjunct, then the two letters it is built from */
  .sb-conjunct { border-collapse: separate; border-spacing: 4mm 2.5mm; margin: 1mm 0; }
  .sb-conjunct td { font: 400 14pt "NotoSerifBengali", serif; vertical-align: middle; }
  .sb-cj-word, .sb-cj-conj { color: ${profile.greyscale ? '#000' : '#C0392B'}; }
  .sb-cj-conj { text-align: center; }
  .sb-cj-part { border: 0.35mm solid #333; width: 15mm; height: 12mm; text-align: center; }
  /* day pill -> arrow -> write box */
  .sb-day-pills { display: flex; flex-direction: column; gap: 3.5mm; margin: 3mm 0; }
  .sb-dp-row { display: flex; align-items: center; gap: 3mm; }
  .sb-dp-pill { flex: 0 0 38mm; height: 12mm; border-radius: 6mm;
    display: flex; align-items: center; justify-content: center;
    font: 400 13pt "NotoSerifBengali", serif;
    border: 0.3mm solid ${profile.greyscale ? '#666' : 'transparent'}; }
  .sb-dp-arrow { flex: 0 0 10mm; height: 6mm; position: relative; }
  .sb-dp-arrow::after { content: ''; position: absolute; right: 0; top: 50%;
    transform: translateY(-50%); border-left: 4mm solid currentColor;
    border-top: 3mm solid transparent; border-bottom: 3mm solid transparent; }
  .sb-dp-box { flex: 1; height: 12mm; border: 0.35mm solid #444; border-radius: 1mm; }
  ${[0, 1, 2, 3, 4, 5, 6].map((i) => {
    const fills = ['#B9C4E8', '#BFE0F5', '#C6E4C6', '#FBF0B8', '#F8D4A8', '#F8C4C4', '#D9C6E8'];
    const arrows = ['#2E3E8C', '#2E9BD6', '#1F8A4C', '#E8C21A', '#E07A1F', '#D6342C', '#7D3BA6'];
    return `.sb-dp-c${i} { background: ${profile.greyscale ? '#FFFFFF' : fills[i]}; }\n` +
      `  .sb-dp-a${i} { color: ${profile.greyscale ? '#333' : arrows[i]}; }`;
  }).join('\n  ')}
 /* short reading lines with NCTB leading */
  .sb-spaced { font: 400 14pt "NotoSerifBengali", serif; line-height: 2.1; margin: 1mm 0 3mm; }
  /* fill-in lines: "..." becomes a rule to write on */
  .sb-fill-gap { font: 400 14pt "NotoSerifBengali", serif; margin: 1mm 0 3mm; }
  .sb-gap-line { display: flex; align-items: baseline; gap: 1.5mm;
    line-height: 2.1; white-space: pre-wrap; }
  .sb-ruled-many { gap: 14mm; }
 /* red instruction line above an exercise */
  .sb-instruction { font: 400 13pt "NotoSerifBengali", serif; margin: 2mm 0 1mm;
    color: ${profile.greyscale ? '#000' : '#C0392B'}; }
  /* two word columns to join with a drawn line */
  .sb-match-cols { display: flex; flex-direction: column; gap: 3mm;
    font: 400 14pt "NotoSerifBengali", serif; margin: 2mm 0 2mm 12mm; }
  .sb-mc-row { display: flex; }
  .sb-mc-l { flex: 0 0 34mm; }
  /* rhyme page: centred title + byline, stepped verse lines */
  .sb-poem-title { text-align: center; font: 600 20pt "NotoSerifBengali", serif;
    color: ${profile.greyscale ? '#000' : '#1B7BA8'}; margin: 1mm 0; }
  .sb-byline { text-align: center; font: 600 13pt "NotoSerifBengali", serif;
    margin: 0 0 3mm; }
  .sb-verse { font: 400 14pt "NotoSerifBengali", serif; line-height: 1.62;
    margin: 0 0 3mm; }
  .sb-verse-line { padding-left: 14mm; }
  .sb-verse-in { padding-left: 34mm; }   /* NCTB steps every second line in */
  .sb-note-right { text-align: right; font: 400 12pt "NotoSerifBengali", serif;
    margin: 0 0 2mm; }
  /* a prompt line followed by a rule to write the next line on */
  .sb-prompt-blank { display: flex; flex-direction: column; gap: 2mm; margin: 2mm 0; }
  .sb-pb-item { display: flex; flex-direction: column; gap: 5mm; }
  .sb-pb-prompt { font: 400 14pt "NotoSerifBengali", serif; }
  /* numbered write-on lines in columns */
  .sb-numbered-blanks { display: grid; gap: 7mm 10mm; margin: 3mm 0;
    grid-template-columns: repeat(var(--nb-cols, 2), 1fr); }
  .sb-nb-item { display: flex; align-items: baseline; gap: 2mm; }
  .sb-nb-num { font: 400 14pt "NotoSerifBengali", serif; }
  .sb-nb-item .sb-ruled-line { flex: 1; }
  /* bordered alphabet chart */
  .sb-letter-grid { border-collapse: collapse; margin: 3mm auto;
    border: 0.7mm solid #000; }
  .sb-letter-grid td { border: 0.35mm solid #000; width: 30mm; height: 21mm;
    text-align: center; vertical-align: middle;
    font: 400 24pt "NotoSerifBengali", serif; }
  /* coloured letter tiles with a dotted copy box under each */
  .sb-tile-write { display: flex; flex-direction: column; gap: 2mm; margin: 3mm 0; }
  .sb-tw-line { display: grid; grid-template-columns: repeat(var(--tw-cols, 5), 1fr);
    gap: 4mm; }
  .sb-tw-tile, .sb-tw-box { height: 21mm; border-radius: 1.5mm;
    display: flex; align-items: center; justify-content: center; }
  .sb-tw-tile { font: 400 22pt "NotoSerifBengali", serif;
    border: 0.3mm solid ${profile.greyscale ? '#666' : 'transparent'}; }
  .sb-tw-box { border: 0.4mm dashed #999; background: #FFFFFF; }
  .sb-tw-c0 { background: ${profile.greyscale ? '#FFFFFF' : '#D9C6E8'}; }
  .sb-tw-c1 { background: ${profile.greyscale ? '#FFFFFF' : '#C3DFF5'}; }
  .sb-tw-c2 { background: ${profile.greyscale ? '#FFFFFF' : '#C6E4C6'}; }
  .sb-tw-c3 { background: ${profile.greyscale ? '#FFFFFF' : '#F8C4B0'}; }
  .sb-tw-c4 { background: ${profile.greyscale ? '#FFFFFF' : '#FBF0B8'}; }
  /* word + sentence columns */
  .sb-ws-pair { display: flex; gap: 6mm; font: 400 14pt "NotoSerifBengali", serif;
    line-height: 1.6; }
  .sb-ws-word { flex: 0 0 26mm; }
  /* the model sentence the child copies */
  .sb-model-sent { font: 400 20pt "NotoSerifBengali", serif; margin: 2mm 0 4mm; }
  .sb-ruled { display: flex; flex-direction: column; gap: 9mm; margin: 3mm 0; }
  .sb-ruled-line { display: block; border-bottom: 0.35mm solid #444; }
  /* ruled trace panel — tinted lanes, flat white in the photocopy edition */
  .sb-trace-panel { border: 0.35mm solid; border-radius: 1mm;
    padding: 3mm 4mm; margin: 2mm 0; }
  .sb-tp-lane { display: flex; justify-content: space-around; align-items: stretch;
    height: 20mm; position: relative; }
  .sb-tp-lane::before, .sb-tp-lane::after { content: ''; position: absolute;
    left: 0; right: 0; border-bottom: 0.3mm solid var(--tp-rule, #C9B87A); }
  .sb-tp-lane::before { top: 27.8%; }   /* মাত্রা bar height */
  .sb-tp-lane::after  { top: 66.7%; }   /* baseline (y=72 of the 108 viewBox) */
  /* the model lane shows only the baseline, as NCTB does */
  .sb-tp-model::before { border-bottom: none; }
  .sb-tp-cell { flex: 0 1 auto; width: 34mm; }
  .sb-tp-svg { width: 100%; height: 100%; display: block; }
  /* word-build boxes — NCTB pastel tiles, flat white in the photocopy edition */
  .sb-wordbuild { display: flex; justify-content: space-around; align-items: center;
    gap: 10mm; flex-wrap: wrap; margin: 4mm 0; }
  .sb-wb-group { display: flex; align-items: center; gap: 2mm; }
  .sb-wb-rows { display: flex; flex-direction: column; gap: 2mm; }
  .sb-wb-r { display: flex; align-items: center; gap: 2mm; }
  .sb-wb-tile { display: flex; align-items: center; justify-content: center;
    width: 11mm; height: 11mm; border: 0.3mm solid #666; border-radius: 0.8mm;
    font: 600 15pt "NotoSerifBengali", serif; }
  .sb-wb-box { height: 11mm; border: 0.3mm solid #666; border-radius: 0.8mm;
    background: #FFFFFF; }
  .sb-wb-lead { background: ${profile.greyscale ? '#FFFFFF' : '#D9C6E0'}; }
  .sb-wb-t0 { background: ${profile.greyscale ? '#FFFFFF' : '#BFE0DA'}; }
  .sb-wb-t1 { background: ${profile.greyscale ? '#FFFFFF' : '#FBF0C0'}; }
  .sb-wb-t2 { background: ${profile.greyscale ? '#FFFFFF' : '#C3DFF5'}; }
  .sb-image-grid { display: block; }
  .sb-grid-inner { display: flex; flex-wrap: wrap; justify-content: center; align-items: stretch; }
  .sb-grid-cell { display: flex; flex-direction: column; }
  .sb-grid-cell img { width: 100%; }
  /* one slice of a composite: the img is N× the cell width, shifted left by
     i cells; height follows from the width so the crop is undistorted */
  .sb-slice { position: relative; overflow: hidden; }
  .sb-slice img { position: absolute; top: 0; max-width: none; height: auto; }
  /* captions sit on one baseline even when the pictures differ in height */
  .sb-grid-cap { text-align: center; margin-top: auto; padding-top: 1.5mm;
    font: 400 14pt "NotoSerifBengali", serif; }
  .sb-leftover-words .sb-word-list { justify-content: center; gap: 12mm; margin-top: 2mm; }
  .sb-leftover-words .sb-word-list span { flex: 0 0 auto; }
  .sb-image-text-image { display: flex; }
  .sb-iti-text { text-align: center; } /* sentences sit centered between their pictures */
  .sb-iti-img img { width: 100%; }
  .sb-image-text-image .sb-bubbles { flex-direction: column; align-items: center; }
  .sb-img-half { overflow: hidden; }
  .sb-img-half img { width: 200%; max-width: none; }
  .sb-half-right img { margin-left: -100%; }
  .sb-panel-captions { display: flex; flex-wrap: wrap; gap: 4mm; justify-content: center;
    align-items: flex-start; }
  .sb-panel-group { display: flex; flex-direction: column; gap: 1mm; }
  .sb-band { position: relative; overflow: hidden; }
  .sb-band img { position: absolute; width: 100%; height: auto; left: 0; }
  .sb-panel-cap { font: 400 13pt "NotoSerifBengali", serif; text-align: center; margin: 0; }
  .sb-quad-grid { display: grid; grid-template-columns: 1fr 1fr; }
  .sb-quad { position: relative; overflow: hidden; }
  .sb-quad img { position: absolute; width: 200%; max-width: none; height: auto; }
  .sb-bubble-abs { position: absolute; transform: translate(-50%, -50%);
    font: 400 12pt "NotoSerifBengali", serif; text-align: center; max-width: 30%; }
  `;
}

/**
 * Compose a full book HTML document for one profile.
 * Each lesson gets its own .sb-page (one lesson per page for now; the fit guard
 * and a future paginator can split long lessons). Lessons omitted from the
 * bw-photocopy edition (print_only_omit) render a teacher-note page instead.
 */
function composeBook(book, profileId, opts = {}) {
  const profile = PROFILES[profileId];
  if (!profile) throw new Error(`unknown profile: ${profileId}`);
  const imagesRel = opts.imagesRel || 'images-compliant';
  const fontCss = opts.fontCss || '';   // base64 @font-face injected by build step

  let pages = '';
  let pageNo = 0; // the book's own sequential page number (bottom-right)
  const wrap = s => `<div class="sb-page">${s}<div class="sb-page-no">${bnDigits(++pageNo)}</div></div>`;
  for (const lesson of book.lessons) {
    const res = resolveForProfile(profileId, lesson.bw_treatment);
    if (!res.render) {
      pages += wrap(`<section class="sb-lesson"><div class="sb-lesson-no">${lessonMarker(lesson)}</div>` +
        `<h1 class="sb-title">${esc(lesson.nctb_title_bn)}</h1>` +
        `<p class="sb-caption">এই পাঠটি রঙিন সংস্করণে দেখুন (এই পাঠে রঙনির্ভর কার্যক্রম আছে)।</p></section>`);
      continue;
    }
    pages += composeLessonPages(lesson, book, profile, imagesRel).map(wrap).join('');
  }

  // one shared dot pattern for every tracing glyph (single dotted letters —
  // stroking a font outline would draw both sides of each stroke)
  const dotDefs = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>` +
    // Two pitches. A কারচিহ্ন is one simple stroke, so a wide pitch keeps it a
    // single dotted line. A full letter (ট, ঠ…) has curls and counters: at
    // that pitch the dots scatter and the shape stops reading, so letter cells
    // use a finer pitch that follows the form.
    `<pattern id="sb-dots" patternUnits="userSpaceOnUse" width="5" height="5">` +
    `<circle cx="2.5" cy="2.5" r="1.45" fill="${profile.greyscale ? '#000' : '#777'}"/></pattern>` +
    `<pattern id="sb-dots-fine" patternUnits="userSpaceOnUse" width="2.8" height="2.8">` +
    `<circle cx="1.4" cy="1.4" r="0.95" fill="${profile.greyscale ? '#000' : '#777'}"/></pattern>` +
    `</defs></svg>`;

  return `<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8">` +
    `<style>${fontCss}</style><style>${baseCss(profile)}</style></head>` +
    `<body>${dotDefs}${pages}</body></html>`;
}

module.exports = { composeBook, composeLesson, composeLessonPages, TEMPLATES };
