# Help guides (prd-help-centre, D-#968–#973)

- `categories.json`: the category cards on the help home, shown in this order.
- `guides/<id>.json`: one guide per small task. The shape is `HelpGuideFile` in
  `shared/helpGuides.ts`, and `docs/prd-help-centre.md` §4 has an example.
- `shots/<id>/<name>.png`: clean screenshots, with no red boxes drawn in. The app draws the boxes
  from each step's `box`, given as `[x, y, w, h]` fractions of the picture.

Rules:

- Who sees a guide is set by `perms` (any-of, catalogue keys) **or** `audience` (`ALL_STAFF` | `GUARDIAN`).
- `"draft": true` hides a guide from everyone. Use it while a screenshot still needs prod.
- Screenshots come from prod with personal data replaced (D-#970). Never commit a picture the owner
  has not looked at.
- A new or changed feature adds or updates its guide in the same PR (D-#973).

Check: `npm run build --workspace=shared && node skills/_tools/verify_help_guides.mjs`
