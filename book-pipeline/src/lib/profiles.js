'use strict';
/**
 * profiles.js — study-book render profiles (standalone, D-020 / D-016).
 *
 * TWO editions, both first-class, both ALWAYS rendered from the same JSON:
 *   - print-colour : full colour, TRUE WHITE background (not storybook cream —
 *                    a সহায়িকা sits next to a white NCTB book). 300 DPI PNG.
 *   - bw-photocopy : greyscale / pure black-line, true white, high-contrast,
 *                    tuned so the school copier doesn't muddy midtones. The
 *                    bulk-distribution edition; must survive a real copier pass.
 *
 * The cream flatten used for sellable storybooks is WRONG here and is used in
 * NEITHER profile. Layout is identical across profiles — only colour handling,
 * background, and image treatment differ (D-016).
 *
 * bw_treatment resolution (per lesson, SCHEMA):
 *   native_safe    -> render in B/W as-is
 *   redesigned     -> render the B/W-safe scheme (pattern/outline/shading)
 *   print_only_omit-> OMIT from bw-photocopy; carry a teacher note pointing to
 *                     the colour master / NCTB original
 */

const BACKGROUND_WHITE = '#FFFFFF';   // true white, both profiles

const PROFILES = {
  'print-colour': {
    id: 'print-colour',
    colour: true,
    background: BACKGROUND_WHITE,
    image_format: 'png',
    image_dpi: 300,
    greyscale: false,
    // no crop marks — borderless-within-margin, single A4 sheets
    marks: false,
    note: 'colour master',
  },
  'bw-photocopy': {
    id: 'bw-photocopy',
    colour: false,
    background: BACKGROUND_WHITE,
    image_format: 'png',
    image_dpi: 300,
    greyscale: true,
    high_contrast: true,     // tuned for copier midtone survival
    marks: false,
    note: 'bulk-distribution; must survive the school copier',
  },
};

// Both editions always build. A book is not "assembled" until both pass audits.
const ALWAYS_RENDER = ['print-colour', 'bw-photocopy'];

/**
 * Given a lesson's bw_treatment, decide how it participates in a profile.
 * Returns { render: bool, mode: 'as-is'|'bw-scheme'|'omit', teacherNote: bool }.
 */
function resolveForProfile(profileId, bwTreatment) {
  if (profileId === 'print-colour') {
    return { render: true, mode: 'as-is', teacherNote: false };
  }
  // bw-photocopy
  switch (bwTreatment) {
    case 'native_safe':     return { render: true,  mode: 'as-is',     teacherNote: false };
    case 'redesigned':      return { render: true,  mode: 'bw-scheme', teacherNote: false };
    case 'print_only_omit': return { render: false, mode: 'omit',      teacherNote: true  };
    default:                return { render: true,  mode: 'as-is',     teacherNote: false };
  }
}

module.exports = { PROFILES, ALWAYS_RENDER, BACKGROUND_WHITE, resolveForProfile };
