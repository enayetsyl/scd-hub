# Dev copy runbook (AL-2, LEAD ONLY, on the VM)

Spec: `docs/prd-academic-loop-2027.md` section 9.2 (D-#1677). Copies prod into the dev database and masks it.
Nothing here is typed with a secret: `$PROD_URI` and `$DEV_URI` come from the VM's env files; read them in the shell
(`node -e` / `dotenv`), never paste them into a message or a file. Remember the prod `.env` trap (an unquoted `&`
empties the URI when the file is sourced with `. ./.env`).

Run from the dev checkout root. `<dev-db>` is the dev database name (must end in `_dev`).

## 1. Stop the dev API, check the guard
```
pm2 stop <dev-api-process>          # whatever the dev service is called on the VM
echo "$OUTGOING_NOTIFICATIONS"      # must NOT be "on"
```
The dev DB name must end in `_dev`. The dev `.env` must hold none of `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `WEB_PUSH_VAPID_PRIVATE_KEY` or a Telegram token (AL-1, section 9.1).

## 2. Refuse the wrong target
Compare the restore URI with the prod URI by host + DB name only (never print either):
```
node -e '
const id=u=>{const m=/^mongodb(?:\+srv)?:\/\/(?:[^@\/]*@)?([^\/?]+)\/?([^?]*)/.exec(u||"");return m?m[1].toLowerCase()+"/"+m[2]:null};
const a=id(process.env.PROD_URI), b=id(process.env.DEV_URI);
if(!a||!b||a===b||!b.endsWith("_dev")){console.error("REFUSED: wrong target");process.exit(1)}
console.log("target ok (dev db ends in _dev, differs from prod)")'
```
Stop here if it prints REFUSED.

## 3. Empty the old dev operational + mastery-seed data
`dev-mask.ts --apply` (step 7) wipes these, but when `mongorestore --drop` is skipped for a collection, wipe first so
nothing stale survives. The list (exact collection names) is generated, not typed:
```
npx tsx server/scripts/dev-copy-collections.ts --wipe
```
(tracker items/records, class tests/results, class notes, lesson deliveries, attendance, mastery papers/results/evidence/
states/assignments/sheets/actions, integrity cases, `QuestionUse`, notifications, audits, print requests; the old
`@mastery.test` users are removed by the mask script.) Models a later slice has not built yet are listed as "skipped".

## 4. Dump prod, read-only (to a path OUTSIDE the repo)
The unmasked dump holds real personal data: it must never sit inside the checkout. The `--nsInclude=<db>.<coll>` tokens are
GENERATED from the models (bare, no quotes), read into a bash array so nothing is re-split or re-quoted:
```
DUMP="$HOME/tmp-devcopy-$(date +%Y%m%d)"; umask 077; mkdir -m 700 "$DUMP"
mapfile -t INC < <(npx tsx server/scripts/dev-copy-collections.ts <prod-db>)
printf '%s\n' "${INC[@]}" | head -3   # eyeball: --nsInclude=<prod-db>.users ...  (no quotes)
mongodump --uri "$PROD_URI" "${INC[@]}" --out "$DUMP"
```
`mongodump` only reads. Never copied: push devices / web-push subscriptions, notifications, audits, AI settings/keys/usage,
HR/payroll/finance, files, login throttles, sessions, chat.

## 5. Restore into dev, check counts, delete the dump
`mongorestore` matches `--nsInclude` against the SOURCE (prod) names, then renames with `--nsFrom/--nsTo`:
```
mongorestore --uri "$DEV_URI" --drop --nsInclude="<prod-db>.*" --nsFrom="<prod-db>.*" --nsTo="<dev-db>.*" "$DUMP"
```
`--drop` only drops the collections it restores. Run it ONLY after step 2 printed "target ok".
Count check (dump count vs dev count per collection, with MONGODB_URI pointing at dev); every row must say `ok`:
```
npx tsx server/scripts/dev-copy-collections.ts --verify-restore "$DUMP" <prod-db>
```
Then delete the unmasked dump straight away and prove it is gone (before the mask even runs):
```
rm -rf "$DUMP"; test ! -e "$DUMP" && echo "no dump left"
```
If the count check fails, delete the dump anyway and start over from step 4.

## 6. Mask, before the API starts
```
export DEV_TEST_PASSWORD='...'            # the one shared tester password; give it out of band, never commit it
npx tsx server/scripts/dev-mask.ts        # dry run: counts what it would wipe / mask
npx tsx server/scripts/dev-mask.ts --apply
```
It refuses unless the DB name ends in `_dev`, outgoing is closed and `MONGODB_URI` differs from `PROD_MONGODB_URI`.
It must end with `residue 0` and exit 0; otherwise do NOT start the API (re-run it, or drop the dev DB and start over).
Names stay (the owner wants the real roster). Fakes are derived from a hash of the real value (the same real value gets the
same fake in every collection, even after a half-failed run), so re-running with the same `DEV_TEST_PASSWORD` is safe. A RAW gate
scans every string of users / guardians / staffprofiles / students for real phones and emails, even in fields the schema no
longer knows, and masks them; `dob` and `biometricId` are cleared.

## 7. Start the dev API and check it
```
pm2 start <dev-api-process>
curl -s https://<dev-host>/readyz         # shows "outgoing OFF" and which keys are present (booleans only)
```
Log in once with one fake login (a masked phone `01000xxxxxx` + the shared test password).

## 8. Fake 2027 activity (after the year-change rehearsal, or scenario 0 on 2026 first)
STOP the dev API first (`pm2 stop <dev-api-process>`) and start it again after the last command below: the generator tags its
rows by a createdAt window, and a running API would let testers' rows fall inside it.
```
npx tsx server/scripts/dev-fake-2027.ts                       # dry run: prints the manifest
npx tsx server/scripts/dev-fake-2027.ts --apply --allow-2026  # scenario 0 on the 2026 year (before the rehearsal)
npx tsx server/scripts/dev-fake-2027.ts --apply               # after the 2027 year change made by a year-change run
npx tsx server/scripts/dev-fake-2027.ts --remove <runId> --apply
```
A re-run first removes every earlier run. Re-copying prod (steps 1-7) wipes the rehearsed year: re-run the rehearsal.
The generator turns `classNoteQuestionOn` on if it is off (config, not run data; `--remove` leaves it on).
Then: `pm2 start <dev-api-process>`.

## 9. Never
Never run `server/scripts/seed.ts` on dev or prod (it deletes identity rows). Never take a help-guide picture or doc from
the dev site (the repo is public). The dev site stays behind its basic auth.
