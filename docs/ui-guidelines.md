# SCD Hub — UI Guidelines v1

**Status:** ADOPTED (docs-only; code adoption = slice UI-1)
**Owner:** Principal
**Date:** 2026-06-11
**Traceability:** D-#61 · ADR-010/014 (NativeWind) · ADR-005 (PII posture) · NFR-5 (Bangla labels) · D-#30/#36 (English codes convention)

---

## 0. Quick checklist (use this when reviewing any screen)

- [ ] All colors come from the token table (§3/§4) — no ad-hoc hex in screen code.
- [ ] Text + background pair meets WCAG AA: ≥ 4.5:1 normal text, ≥ 3:1 large text/icons.
- [ ] Font is Noto Sans Bengali everywhere; body ≥ 16sp; line-height ≥ 1.5 for body Bangla.
- [ ] No ALL-CAPS, no letter-spacing on Bangla text; codes/IDs/digits stay Latin (HW-0042, 240).
- [ ] Every tappable element ≥ 48×48dp hit area; ≥ 8dp gap between adjacent targets.
- [ ] One column; primary action in the lower half of the screen; destructive action never adjacent to it.
- [ ] Meaning never carried by color alone — always icon and/or text label too.
- [ ] Cards/list rows use 1dp borders, not shadows; no gradients or blur in lists.
- [ ] Works in both light and dark (tokens only — never a hard-coded light value).
- [ ] Icon-only controls have a Bangla `accessibilityLabel`; OS font scaling not disabled.
- [ ] No student/staff photos; avatars are initials circles.

---

## 1. Goal

One written contract for how every SCD Hub screen looks and behaves, so that screens built in different sessions stay consistent. Primary users are **teachers and guardians on low-to-mid-range Android phones**; secondary use is office/Principal on web. The system therefore optimizes, in order: **Bangla legibility → thumb reach → cheap rendering → visual identity** — decoration never outranks the first three.

## 2. Design principles

1. **Bangla-first.** Bangla is the default language of every label (NFR-5); English appears only as codes (HW-0042, ক/খ/গ ranks keep their existing forms). Typography rules are written for Bangla's needs (taller lines, no caps, no tracking) and Latin simply complies.
2. **Mobile-first Android.** Design at 360×800dp. The web build inherits the phone layout centered at max 720dp — never a separate desktop design.
3. **Calm and modest.** Restrained deep-green/gold palette, generous whitespace, no figurative or animate decorative imagery, no auto-playing media. Subtle geometric pattern is permitted only as an optional low-contrast surface texture and is off by default.
4. **Cheap to render.** Borders instead of shadows, flat fills instead of gradients, vector icons instead of images. Many guardian phones are low-end; a list must scroll smoothly on them.
5. **One token source.** Every color, size, and font value in code reads from `app/src/theme` (the existing themed StyleSheet system). This document and that token file are a **two-place sync**: a value changes in both or in neither. When NativeWind is re-enabled (ADR-010/014), its config maps to the **same** token file — never a second palette.

## 3. Color tokens — LIGHT theme

Logo note: the school mark is monochrome, so it never needs recoloring — it renders in `textPrimary` (ink) on light surfaces, `textPrimary` (off-white) on dark surfaces, or pure white on a `primary` header block. See §10.

| Token | Hex | Use |
|---|---|---|
| `bg` | `#F6F8F6` | Screen background |
| `surface` | `#FFFFFF` | Cards, sheets, inputs |
| `surfaceAlt` | `#ECF2EE` | Alternate rows, section headers, disabled fills |
| `border` | `#D3DCD6` | 1dp card/input/list borders |
| `textPrimary` | `#182420` | Headings, body |
| `textSecondary` | `#46554E` | Secondary text, helper lines |
| `textDisabled` | `#8B968F` | Disabled labels (never for information) |
| `primary` | `#156B45` | Filled buttons, active tab, links, selected states |
| `onPrimary` | `#FFFFFF` | Text/icon on `primary` |
| `primaryPressed` | `#0E4C31` | Pressed/active fill |
| `primaryContainer` | `#D8EBDF` | Selected chips, success banners, highlights |
| `onPrimaryContainer` | `#0B3B26` | Text on `primaryContainer` |
| `gold` | `#8F6400` | Sparing accent: "needs attention" badges, stars/highlights |
| `goldContainer` | `#F3E7C9` | Gold badge/banner fill |
| `onGoldContainer` | `#4A3400` | Text on `goldContainer` |
| `warning` | `#9A4D00` | Warning text/icon (band warnings, over-load) |
| `warningContainer` | `#FCE8D5` | Warning banner fill |
| `error` | `#B3261E` | Error text/icon, destructive buttons |
| `errorContainer` | `#F9DEDC` | Error banner/field fill |
| `onErrorContainer` | `#410E0B` | Text on `errorContainer` |
| `info` | `#155E96` | Informational text/icon |
| `infoContainer` | `#DCEAF7` | Info banner fill |
| `success` | = `primary` family | Success states reuse the primary green |

Rules:

- New color pairs may not be invented in screen code. If a screen genuinely needs a new pair, it is added **here first**, contrast-verified (§9), then to the token file.
- `gold` is an accent, not a second brand color: at most one gold element per screen.
- Container colors always pair with their `on…` text token — never `textPrimary` assumed.

## 4. Color tokens — DARK theme

Dark mode is **in scope for v1**. Same token names; the theme object swaps values. Components read tokens only and never branch on scheme themselves.

| Token | Hex | Notes |
|---|---|---|
| `bg` | `#101513` | Not pure black (avoids smearing on OLED, keeps borders visible) |
| `surface` | `#1A211D` | |
| `surfaceAlt` | `#232C27` | |
| `border` | `#3A453F` | |
| `textPrimary` | `#E7ECE9` | |
| `textSecondary` | `#ADBAB2` | |
| `textDisabled` | `#6F7B74` | |
| `primary` | `#66C695` | Brand green lightened for dark — never the light-theme `#156B45` on dark surfaces |
| `onPrimary` | `#06301C` | |
| `primaryPressed` | `#84D4AA` | |
| `primaryContainer` | `#0E4C31` | |
| `onPrimaryContainer` | `#C7E9D5` | |
| `gold` | `#E2B95B` | |
| `goldContainer` | `#4A3400` | |
| `onGoldContainer` | `#F3E7C9` | |
| `warning` | `#EFA967` | |
| `warningContainer` | `#5A2D00` | |
| `error` | `#F2B8B5` | |
| `errorContainer` | `#8C1D18` | |
| `onErrorContainer` | `#F9DEDC` | |
| `info` | `#8FC3EF` | |
| `infoContainer` | `#0F4368` | |

Behavior:

- Theme follows the OS (`useColorScheme()`); default = system. An in-app manual override is a later nicety, not v1.
- The logo's dark variant is the off-white ink (`textPrimary` dark value); never invert the light hex by filter.

## 5. Typography

**Single family: Noto Sans Bengali** (weights 400 / 500 / 700), used for **all** text — Bangla, Latin codes, and digits. Reasons: complete conjunct/matra coverage, a matching Latin subset (no two-font seams inside one label like "HW-0042 জমা"), free (Google Fonts / `@expo-google-fonts/noto-sans-bengali`), and it is **already the PDF export font** (Slice 1) — so a homework sheet looks the same on screen and on paper. Fallback: platform system font.

Type scale (sizes in sp — they scale with OS settings):

| Role | Size / line-height | Weight | Use |
|---|---|---|---|
| `pageTitle` | 22 / 30 | 700 | Screen title |
| `sectionTitle` | 18 / 24 | 700 | Card/section headers |
| `body` | 16 / 24 | 400 | Default text |
| `bodyStrong` | 16 / 24 | 700 | Emphasis inside body |
| `secondary` | 14 / 21 | 400 | Helper text, metadata |
| `button` | 16 / 24 | 500 | Button labels |
| `chip` | 14 / 20 | 500 | Chips, badges |
| `caption` | 12 / 18 | 400 | Timestamps, footnotes — absolute floor |

Hard rules:

1. **Body Bangla never below 16sp**; nothing below 12sp; interactive labels ≥ 14sp. (Bangla glyphs read smaller than Latin at equal size.)
2. **Line-height ≥ 1.5× for body text** — conjuncts and matras clip at tight leading. Titles may compress to ~1.35×.
3. **No ALL-CAPS transformation anywhere.** Bangla has no case; forced uppercase corrupts mixed labels. Latin codes keep their written form.
4. **Letter-spacing = 0 on Bangla** — tracking breaks conjunct shaping.
5. **Digits, IDs, scores, dates, phone numbers use Latin digits 0–9** (the existing "Bangla labels + English codes" convention, D-#30/#36). Bangla numerals are not introduced.
6. **Never set `allowFontScaling={false}`.** Layouts must survive OS font scale up to 1.3× (text wraps; containers grow; nothing truncates meaning).

## 6. Spacing, layout, touch

- **Spacing scale (dp): 4, 8, 12, 16, 24, 32.** No off-scale values. Screen edge padding 16; card internal padding 16; vertical gap between cards 12; between form fields 16.
- **Touch targets ≥ 48×48dp**, even when the visible glyph is smaller (use `hitSlop`). Adjacent targets ≥ 8dp apart.
- **List rows ≥ 56dp tall**; one-line title + optional one-line secondary; chevron or single trailing action only.
- **One column.** No side-by-side panels on phone. **Top-level navigation is a grouped hamburger
  drawer** (D-#258, EximusEdu-familiar): module entries live under collapsible group headers
  (Academics, Trackers) plus flat standalone items (Attendance, Library, Finance, HR, …); deeper
  navigation stacks within each module. The drawer is **permanent** (always-visible left sidebar)
  at width ≥ 1024dp (laptop/desktop web) and a **slide-over** (☰ hamburger in the header) below
  that. The **☰ is always present**: on web it **collapses/expands** the permanent sidebar (drawer
  width goes 300↔0dp); on phone it opens the slide-over overlay. When the sidebar is collapsed the
  content **frame widens** from the `MAX_CONTENT_WIDTH` (720dp) cap to the wide cap
  (`MAX_WIDE_CONTENT_WIDTH`, 1400dp) so the body fills the freed space — the body expands/contracts
  with the sidebar. This is driven by a shared `SidebarProvider` (`state/SidebarContext`) that both
  the drawer (`AppTabs`) and the content `Screen` read. Drawer items are role-gated by the same `roleHasPermission` checks; route names are stable
  so notification deep-links resolve unchanged. The top-right header is the 🔔 bell + a 👤 account
  menu (name / language / report a problem / logout). Palette is unchanged — the drawer uses the
  existing tokens (active item = `primaryContainer`).
- **Thumb zone:** the screen's primary action (submit, confirm, declare) sits in the lower half — bottom-fixed button bar preferred on forms. A destructive action is never directly adjacent to the primary action.
- **Corner radius:** 12dp cards/buttons/inputs; 999 (pill) chips; 8dp small badges.
- **Web/desktop:** the same layout centered, `maxWidth` 720dp, `bg` filling the rest. Data-grid
  screens (the admin master routine grid) opt into a wider frame via `Screen wide` — `maxWidth` 1400dp.

## 7. Components

- **Buttons.** Primary = filled `primary`/`onPrimary`, height 48, radius 12. Secondary = 1dp `primary` border, `primary` text, transparent fill. Destructive = filled `error` and appears **only** on the confirming step (e.g., inside a confirm dialog), never as the first tap. Disabled = `surfaceAlt` fill + `textDisabled` label. A button label says what happens: "জমা দিন", not "ওকে".
- **Chips** (existing pattern kept). Pill radius; unselected = `surface` + `border` + `textPrimary`; selected = `primaryContainer` + `onPrimaryContainer` + 1dp `primary` border. Min height 36 with ≥48dp hit area.
- **Cards.** `surface`, radius 12, 1dp `border`. **No shadows/elevation** — borders are the depth cue (cheap on low-end GPUs and identical in dark mode).
- **Inputs.** Min height 48; **label above the field** (placeholder-only labels are forbidden — they vanish on input); helper/error line below in `secondary`/`error` with an icon. Error state = 1dp `error` border + message; never a red fill alone.
- **Status badges** (lifecycle states, ranks, results). `…Container` fill + `on…Container` text + the Bangla label from `shared/vocab` — **never a colored dot alone**. Suggested mapping: open/in-progress = `infoContainer`; needs-action (DUE, CHASE, resubmission) = `warningContainer`; blocked/over-ceiling/WRONG = `errorContainer`; done/CORRECT/approved = `primaryContainer`; attention/watch-list = `goldContainer`.
- **Banners.** Full-width inside content padding, container fill, leading icon, wrapping text, optional single action. One banner visible at a time; the most severe wins.
- **Empty states.** One Bangla sentence stating what is empty + one action button if the user can fill it. No illustrations required.
- **Loading.** Spinner + a Bangla line, or row skeletons for lists. Never a silent blank screen; never block the whole screen if partial content can show.
- **Icons.** One outlined set only — Material-style outlined icons via `@expo/vector-icons`. The current emoji tab icons (📒 📝 📅) are acceptable for v1 and migrate opportunistically; mixing emoji and vector icons **within one screen** is not allowed.
- **Avatars.** Initials circle (`primaryContainer` fill, `onPrimaryContainer` letter). **No student/staff photos in-app by default** — modest and consistent with the PII-conservative posture (ADR-005).

## 8. Motion

Minimal. Allowed: tab/stack transitions at platform defaults, pressed-state opacity/fill change, spinner. Not allowed: decorative entrance animations, parallax, animated charts on lists. Respect the OS reduced-motion setting where Expo exposes it.

## 9. Accessibility gates

1. Contrast: ≥ 4.5:1 normal text, ≥ 3:1 large text (≥18sp bold / ≥24sp) and meaningful icons. **Every new token pair is verified with a contrast checker before it enters §3/§4** — the tables above were chosen to those targets and the checker is the gate of record.
2. Meaning never by color alone (§7 badges rule).
3. Icon-only controls carry a Bangla `accessibilityLabel`.
4. Visible focus state on web (default outline acceptable).
5. OS font scaling honored (§5 rule 6).

## 10. Logo usage

- The mark is monochrome. Permitted renderings: ink (`textPrimary`) on `bg`/`surface`; off-white on dark surfaces; white on a `primary` block. Nothing else — no gradients, outlines, shadows, or partial recolors.
- Clear space ≥ ½ the mark's width on all sides; minimum rendered size 32dp.
- App icon: white mark centered on a `primary` `#156B45` square (standard Android adaptive-icon padding).

## 11. Adoption gap (current app vs this guideline)

| Area | Today | Target |
|---|---|---|
| Color values | Themed StyleSheet system with its own values | The §3/§4 token tables, light + dark |
| Dark mode | Not implemented | Token-swapped, follows OS |
| Font | System font in-app; NotoSansBengali only in PDFs | Noto Sans Bengali app-wide |
| Tab icons | Emoji | Acceptable now; one outlined set later |
| Shadows | Mixed | Borders only |
| Touch/typography audit | Unverified per screen | §0 checklist per screen |

## 12. Out of scope (v1)

In-app manual theme toggle; icon-set migration as its own task (opportunistic only); guardian-portal-specific styling (lands with the portal); animation system; tablet layouts; any change to the PDF pipeline (already Noto Sans Bengali).

## 13. Build slice UI-1 (the code adoption — separate session)

1. Create/refactor `app/src/theme` tokens to exactly §3–§6 (colors light+dark, spacing, type scale), exporting a theme object keyed by `useColorScheme()`.
2. Load Noto Sans Bengali 400/500/700 via expo-font at app start (splash holds until loaded); set as the default text style.
3. Sweep existing screens to tokens: remove ad-hoc hex/sizes, replace shadows with 1dp borders, enforce 48dp targets on buttons/chips/rows.
4. Verify: app `tsc --noEmit` clean + web bundle green; manual pass of the §0 checklist on Login, RoutineHome, HomeworkHome, RosterScreen in both themes.

## 14. Reused / unchanged

`shared/vocab` Bangla labels and English codes (NFR-5, D-#30/#36); the grouped hamburger-drawer
navigation structure (D-#258, §6 — superseded the original bottom-tab structure but kept every
route name + permission gate + screen IA); all screen information architecture; the PDF export
font; the NativeWind re-enable plan (ADR-010/014 — it maps onto these tokens, it does not replace them).
