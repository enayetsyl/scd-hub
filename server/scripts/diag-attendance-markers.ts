/**
 * READ-ONLY diagnostic (writes NOTHING) — why is the Nursery/KG marker not the
 * first-period teacher?
 *
 * Marker resolution (D-#278) is: admin OVERRIDE → routine first-class teacher →
 * class-teacher fallback. If legacy `SectionAttendanceAssignment` rows are still active
 * — they were the NORMAL path before D-#278, not deliberate overrides — they silently
 * defeat the new routine-derived marker. This prints which of the three is winning for
 * each Nursery/KG section, so the fix is chosen on evidence rather than a guess.
 *
 *   npx tsx server/scripts/diag-attendance-markers.ts [YYYY-MM-DD]
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import { mongoose } from "../src/db";

const URI = process.env.MONGODB_URI!;
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

async function main(): Promise<void> {
  const arg = process.argv[2];
  const date = arg ? new Date(`${arg}T00:00:00`) : new Date();
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const dayOfWeek = DAY_NAMES[date.getDay()];

  const conn = await mongoose.createConnection(URI).asPromise();
  try {
    console.log(`READ-ONLY. Date: ${dateKey} (${dayOfWeek})\n`);

    const classes = await conn.collection("classes").find({}).toArray();
    const byId = new Map(classes.map((c) => [String(c._id), c]));
    const nkClassIds = classes.filter((c) => (c.level as number) <= 0).map((c) => c._id);

    const sections = await conn
      .collection("sections")
      .find({ classId: { $in: nkClassIds }, active: true })
      .toArray();

    console.log("=== NURSERY / KG SECTIONS — who marks? ===");
    for (const sec of sections) {
      const cls = byId.get(String(sec.classId));
      const label = `${cls?.nameBn ?? "?"} / ${sec.nameBn ?? sec.code}`;

      // 1. Admin override?
      const override = await conn.collection("sectionattendanceassignments").findOne({
        sectionId: sec._id,
        active: true,
        fromKey: { $lte: dateKey },
        toKey: { $gte: dateKey },
      });

      // 2. Routine first period.
      const slots = await conn
        .collection("routineslots")
        .find({
          groupType: "section",
          groupId: sec._id,
          dayOfWeek,
          active: true,
          isBreak: false,
          effectiveFrom: { $lte: date },
        })
        .sort({ periodNumber: 1 })
        .toArray();
      const live = slots.filter((s) => !s.effectiveTo || new Date(s.effectiveTo as Date) >= date);
      const first = live.find((s) => s.teacherId);

      const nameOf = async (id: unknown): Promise<string> => {
        if (!id) return "—";
        const u = await conn.collection("users").findOne({ _id: id as never });
        return (u?.name as string) ?? "?";
      };

      const overrideName = override ? await nameOf(override.teacherId) : null;
      const routineName = first ? await nameOf(first.teacherId) : null;
      const ctName = sec.classTeacherId ? await nameOf(sec.classTeacherId) : null;

      const winner = override
        ? `OVERRIDE  -> ${overrideName}`
        : routineName
          ? `ROUTINE   -> ${routineName} (period ${first!.periodNumber})`
          : `CLASSTCHR -> ${ctName ?? "NOBODY"}`;

      console.log(`\n  ${label}`);
      console.log(`    live slots today : ${live.length}`);
      console.log(`    routine P1 teacher: ${routineName ?? "(none — no slot with a teacher)"}`);
      console.log(`    class teacher     : ${ctName ?? "(unset)"}`);
      if (override) {
        console.log(`    ⚠ ACTIVE OVERRIDE : ${overrideName}  [${override.fromKey}..${override.toKey}]`);
      }
      console.log(`    => MARKER: ${winner}`);
    }

    const totalOverrides = await conn.collection("sectionattendanceassignments").countDocuments({
      active: true,
      fromKey: { $lte: dateKey },
      toKey: { $gte: dateKey },
    });
    console.log(`\n=== ACTIVE marker overrides covering ${dateKey} (all sections): ${totalOverrides} ===`);
    if (totalOverrides > 0) {
      console.log(
        "If these are LEGACY rows (assigned before D-#278, when the admin assigning a marker\n" +
          "WAS the normal path), they are defeating the new first-period-teacher rule. Revoking\n" +
          "them hands marking back to the routine. Nothing here is deliberate unless you set it.",
      );
    }
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
