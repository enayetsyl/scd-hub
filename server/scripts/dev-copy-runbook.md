# Dev copy runbook (AL-2, LEAD ONLY, on the VM)

Spec: `docs/prd-academic-loop-2027.md` section 9.2 (D-#1677). Copies prod into the dev database and masks it.
Nothing here is typed with a secret: `$PROD_URI` and `$DEV_URI` come from the VM's env files; read them in the shell
(`node -e` / `dotenv`), never paste them into a message or a file. Remember the prod `.env` trap (an unquoted `&`
empties the URI when the file is sourced with `. ./.env`).

Run from the dev checkout root. `<dev-db>` is the dev database name (must end in `_dev`).

## 1. Stop the dev API, check the guard
```
sudo systemctl stop scdhub-dev      # the dev API (systemd unit on the VM)
echo "$OUTGOING_NOTIFICATIONS"      # must NOT be "on"
```
Read the URIs with node, never by sourcing `.env` (an unquoted `&` empties the value):
`getenv(){ node -e 'const fs=require("fs");const [k,f]=process.argv.slice(1);const l=fs.readFileSync(f,"utf8").split("\n").find(x=>x.startsWith(k+"="));process.stdout.write(l?l.slice(k.length+1).trim():"")' "$1" "$2"; }`
then `export PROD_URI="$(getenv MONGODB_URI /opt/scdhub/prod/.env)" DEV_URI="$(getenv MONGODB_URI /opt/scdhub/dev/.env)"`.
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
The unmasked dump holds real personal data: it must never sit inside the checkout. `mongodump` (100.x) has **no**
`--nsInclude`, so dump one collection at a time; the names are GENERATED from the models, and the URI loses its database
path (a database in the URI clashes with `--db` / the restore's `--nsInclude`):
```
DUMP="$HOME/tmp-devcopy-$(date +%Y%m%dT%H%M%S)"; umask 077; mkdir -m 700 "$DUMP"
trap 'rm -rf "$DUMP"' EXIT
nodb(){ node -e 'process.stdout.write(process.argv[1].replace(/\/([^\/?]+)(\?|$)/, "/$2"))' "$1"; }
NODB_PROD="$(nodb "$PROD_URI")"; NODB_DEV="$(nodb "$DEV_URI")"
mapfile -t COLLS < <(npx tsx server/scripts/dev-copy-collections.ts --names 2>/dev/null | grep -E '^[a-z0-9_.-]+$')
echo "collections: ${#COLLS[@]}"
for c in "${COLLS[@]}"; do mongodump --quiet --uri "$NODB_PROD" --db <prod-db> --collection "$c" --out "$DUMP"; done
```
The list includes `yearchangeruns`: prod's prepared 2027 run (Prepare, 21 Nov 2026) comes across with its 2027 classes,
sections, PLANNED enrolments and copied routine, so the dev rehearsal is that run's cut-over.
`mongodump` only reads. Never copied: push devices / web-push subscriptions, notifications, audits, AI settings/keys/usage,
HR/payroll/finance, files, login throttles, sessions, chat.

## 5. Restore into dev, check counts, delete the dump
`mongorestore` matches `--nsInclude` against the SOURCE (prod) names, then renames with `--nsFrom/--nsTo`:
```
mongorestore --quiet --uri "$NODB_DEV" --drop --nsInclude="<prod-db>.*" --nsFrom="<prod-db>.*" --nsTo="<dev-db>.*" "$DUMP"
```
`--drop` only drops the collections it restores. Run it ONLY after step 2 printed "target ok".
Count check (dump count vs dev count per collection, with MONGODB_URI pointing at dev); every row must say `ok`:
```
MONGODB_URI="$DEV_URI" npx tsx server/scripts/dev-copy-collections.ts --verify-restore "$DUMP" <prod-db>
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
same fake in every collection, even after a half-failed run; values already fake are marked taken first, and a second guardian login holding the same number in another format gets its own fake), so re-running with the same `DEV_TEST_PASSWORD` is safe. A RAW gate
scans every string of users / guardians / staffprofiles / students for real phones and emails, even in fields the schema no
longer knows, and masks them; `dob` and `biometricId` are cleared.

## 7. Start the dev API and check it
```
sudo systemctl start scdhub-dev
curl -s https://<dev-host>/readyz         # shows "outgoing OFF" and which keys are present (booleans only)
```
Log in once with one fake login (a masked phone `01000xxxxxx` + the shared test password).

## 8. Fake 2027 activity (after the year-change rehearsal, or scenario 0 on 2026 first)
STOP the dev API first (`sudo systemctl stop scdhub-dev`) and start it again after the last command below: the generator tags its
rows by a createdAt window, and a running API would let testers' rows fall inside it.
```
npx tsx server/scripts/dev-fake-2027.ts                       # dry run: prints the manifest
npx tsx server/scripts/dev-fake-2027.ts --apply --allow-2026  # scenario 0 on the 2026 year (before the rehearsal)
npx tsx server/scripts/dev-fake-2027.ts --apply               # after the 2027 year change made by a year-change run
npx tsx server/scripts/dev-fake-2027.ts --remove <runId> --apply
```
A re-run first removes every earlier run. Re-copying prod (steps 1-7) wipes the rehearsed year: re-run the rehearsal.
The generator turns `classNoteQuestionOn` on if it is off (config, not run data; `--remove` leaves it on).
Then: `sudo systemctl start scdhub-dev`.

## 9. Never
Never run `server/scripts/seed.ts` on dev or prod (it deletes identity rows). Never take a help-guide picture or doc from
the dev site (the repo is public). The dev site stays behind its basic auth.
