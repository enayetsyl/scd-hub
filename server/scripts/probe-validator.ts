import { readFileSync } from "fs";
import { validateBook } from "../src/modules/support-book/services/validator/index";
const book = JSON.parse(readFileSync("C:/Users/HP/Downloads/studybook-pipeline/content/C1-BAN/book.json", "utf8"));
const inv = JSON.parse(readFileSync("C:/Users/HP/Downloads/SB-Governance — Support Book Programme/letter_inventory_C1-BAN.json", "utf8"));
const r = validateBook({ book, classLevel: book.class, subject: book.subject, letterInventory: inv });
console.log(`RED ${r.redCount}  GREY ${r.greyCount}  passed=${r.passed}`);
const byCheck: Record<string, { RED: number; GREY: number }> = {};
for (const f of r.findings) { byCheck[f.check] ??= { RED: 0, GREY: 0 }; byCheck[f.check][f.severity as "RED" | "GREY"]++; }
for (const [c, v] of Object.entries(byCheck).sort()) console.log(`  ${c.padEnd(22)} RED=${v.RED} GREY=${v.GREY}`);
console.log("--- sample RED per check ---");
const seen = new Set<string>();
for (const f of r.findings.filter((x) => x.severity === "RED")) {
  if (seen.has(f.check)) continue; seen.add(f.check);
  console.log(`  [${f.check}] ${f.message.slice(0, 130)}`);
}
