/**
 * Stray academic-year report + guarded delete (YC-0, docs/prd-year-change.md Q4).
 * Used by server/scripts/delete-stray-year.ts (dry run / --apply); never runs by itself.
 */
import * as fs from "fs";
import * as path from "path";
import mongoose from "mongoose";
import { AcademicYear } from "../models/AcademicYear";

// Register every model file under modules/*/models (side-effect require) so a model added
// later is covered without editing this list.
function registerAllModels(): void {
  const modulesDir = path.resolve(__dirname, "../..");
  for (const mod of fs.readdirSync(modulesDir)) {
    const dir = path.join(modulesDir, mod, "models");
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(ts|js)$/.test(file) || file.endsWith(".d.ts")) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require(path.join(dir, file));
      } catch {
        /* a model file that cannot load standalone is skipped */
      }
    }
  }
}
registerAllModels();

const YEAR_PATHS = ["academicYearId", "academicYear"] as const;

export interface StrayYearCount {
  model: string;
  field: string;
  count: number;
}

export interface StrayYearReport {
  yearId: string;
  label: string;
  current: boolean;
  counts: StrayYearCount[];
  total: number;
}

/** Count rows referencing the year in every registered model that has a year path. */
export async function strayYearReport(label: string): Promise<StrayYearReport | null> {
  const year = await AcademicYear.findOne({ label });
  if (!year) return null;
  const counts: StrayYearCount[] = [];
  for (const name of mongoose.modelNames().sort()) {
    if (name === "AcademicYear") continue;
    const model = mongoose.model(name);
    for (const field of YEAR_PATHS) {
      if (!model.schema.path(field)) continue;
      counts.push({ model: name, field, count: await model.countDocuments({ [field]: year._id }) });
    }
  }
  const total = counts.reduce((a, c) => a + c.count, 0);
  return { yearId: String(year._id), label: year.label, current: year.current === true, counts, total };
}

/** Delete the year if (and only if) nothing references it. Returns the refusal reason or null. */
export async function deleteStrayYear(label: string, apply: boolean): Promise<{ refused: string | null; report: StrayYearReport | null }> {
  const report = await strayYearReport(label);
  if (!report) return { refused: `no academic year labelled "${label}"`, report };
  if (report.current) return { refused: `"${label}" is the CURRENT year — never deleted by this script`, report };
  if (report.total > 0) {
    return { refused: `"${label}" is still referenced by ${report.total} row(s) — nothing deleted`, report };
  }
  if (apply) {
    const res = await AcademicYear.deleteOne({ _id: report.yearId, current: { $ne: true } });
    if (res.deletedCount !== 1) {
      return { refused: `"${label}" was not deleted (it became the current year, or is already gone)`, report };
    }
  }
  return { refused: null, report };
}

