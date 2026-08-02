'use strict';
/**
 * geometry.js — study-book page geometry (standalone, D-020).
 *
 * Single source of truth for physical dimensions. The validator and composer
 * import from here; nothing downstream hardcodes a millimetre or a pixel.
 *
 * Locked decisions (Principal, 2026-07-18):
 *   - Sheet = trim = A4 portrait, 210 × 297 mm. No bleed (borderless-within-margin).
 *   - Safe margin 12 mm all sides, uniform.
 *   - Double-sided, mirror margins: inner/outer named separately so a binding
 *     gutter is a one-number change later; today inner = outer = 12 mm (no gutter).
 *   - 300 DPI minimum. Image short-side floor derives from the CONTENT width
 *     (borderless-within-margin — image sits inside the margin, not full bleed).
 *   - Copier non-printable dead-zone (~5 mm) < 12 mm margin, so content never clips.
 */

const MM_PER_IN = 25.4;

const SHEET = { width_mm: 210, height_mm: 297 };          // A4 portrait
const BLEED_MM = 0;                                        // borderless-within-margin

// Mirror-margin model. inner = binding side, outer = fore-edge. Equal today.
const MARGIN = {
  top_mm: 12,
  bottom_mm: 12,
  inner_mm: 12,   // binding side (left on odd pages, right on even)
  outer_mm: 12,   // fore-edge
};

const DPI = { min: 300 };

// Derived content box (same on every page because inner === outer today).
const CONTENT = {
  width_mm:  SHEET.width_mm  - MARGIN.inner_mm - MARGIN.outer_mm,   // 186
  height_mm: SHEET.height_mm - MARGIN.top_mm   - MARGIN.bottom_mm,  // 273
};

// Image short-side floor in px: content width at min DPI.
const IMAGE = {
  short_side_floor_px: Math.ceil((CONTENT.width_mm / MM_PER_IN) * DPI.min), // 2197
};

/**
 * Per-page margins under the mirror model.
 * pageNumber is 1-based. Odd pages: binding (inner) on the LEFT.
 * Even pages: binding on the RIGHT. With inner === outer this is symmetric,
 * but the function is correct if a gutter is added later.
 */
function marginsForPage(pageNumber) {
  const odd = (pageNumber % 2) === 1;
  return {
    top_mm: MARGIN.top_mm,
    bottom_mm: MARGIN.bottom_mm,
    left_mm:  odd ? MARGIN.inner_mm : MARGIN.outer_mm,
    right_mm: odd ? MARGIN.outer_mm : MARGIN.inner_mm,
  };
}

// Geometry assertion tolerance (refuse to render if laid-out page is off by more).
const ASSERT_TOLERANCE_MM = 0.5;

module.exports = {
  MM_PER_IN, SHEET, BLEED_MM, MARGIN, DPI, CONTENT, IMAGE,
  ASSERT_TOLERANCE_MM,
  marginsForPage,
  // convenience for the composer's @page CSS
  sheetCssMm() { return { width: `${SHEET.width_mm}mm`, height: `${SHEET.height_mm}mm` }; },
};
