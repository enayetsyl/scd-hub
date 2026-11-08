/**
 * D-#1072 — a published pop-up notice's people also get a SCHOOL_NOTICE notification.
 *
 *   audience   exactly the notice's frozen rows: staff + login guardians notified; no-login
 *              guardians, STUDENT (no guardian) rows and the sender's test rows skipped
 *   refs       screenTarget stored (the lockstep rule — a ref missing from the sub-schema is
 *              silently stripped) and validated as "Tab/Screen"
 *   re-run     safe: the key carries notice + person, so nobody is told twice
 *   guards     a DRAFT notice is refused
 *
 * In-memory MongoDB, real services. Rows are written raw (the audience machinery has its own
 * suite); every uniquely-indexed field is set and indexes are built first.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { PopupNotice } from "../modules/popup-notices/models/PopupNotice";
import { PopupNoticeRecipient } from "../modules/popup-notices/models/PopupNoticeRecipient";
import { Notification } from "../modules/notifications/models/Notification";
import { notifyPopupRecipients } from "../modules/popup-notices/services/popupNotify";

jest.setTimeout(120_000);

let mongod: MongoMemoryServer;
const sender = new Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([PopupNotice.init(), PopupNoticeRecipient.init(), Notification.init()]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await Promise.all([PopupNotice.deleteMany({}), PopupNoticeRecipient.deleteMany({}), Notification.deleteMany({})]);
});

async function notice(status: "DRAFT" | "PUBLISHED") {
  return PopupNotice.create({
    titleBn: "নতুন সুবিধা",
    bodyBn: "বার্তা",
    endsOn: "2026-11-14",
    status,
    createdBy: sender,
    updatedBy: sender,
  });
}

function row(noticeId: Types.ObjectId, recipientKind: "USER" | "GUARDIAN" | "STUDENT", extra: Record<string, unknown> = {}) {
  return { noticeId, recipientKind, recipientId: new Types.ObjectId(), reachable: true, test: false, ...extra };
}

const TEXT = { titleBn: "নতুন: সাহায্য ও নির্দেশিকা", bodyBn: "পাতার ওপরের ? চাপুন।", screenTarget: "HelpTab/HelpHome" };

describe("notifyPopupRecipients (D-#1072)", () => {
  test("notifies exactly the reachable, non-test people of the notice", async () => {
    const n = await notice("PUBLISHED");
    const teacher = row(n._id, "USER");
    const guardian = row(n._id, "GUARDIAN");
    await PopupNoticeRecipient.insertMany([
      teacher,
      guardian,
      row(n._id, "GUARDIAN", { reachable: false }),
      row(n._id, "STUDENT", { reachable: false }),
      row(n._id, "USER", { test: true }),
    ]);

    const res = await notifyPopupRecipients(sender.toString(), n._id.toString(), TEXT);
    expect(res).toEqual({ reachable: 2, created: 2, withoutLogin: 2 });

    const rows = await Notification.find({}).lean();
    expect(rows).toHaveLength(2);
    const staffRow = rows.find((r) => r.recipientUserId?.equals(teacher.recipientId));
    const guardianRow = rows.find((r) => r.recipientGuardianId?.equals(guardian.recipientId));
    expect(staffRow).toBeDefined();
    expect(guardianRow).toBeDefined();
    for (const r of rows) {
      expect(r.kind).toBe("SCHOOL_NOTICE");
      expect(r.titleBn).toBe(TEXT.titleBn);
      expect(r.refs?.screenTarget).toBe("HelpTab/HelpHome");
    }
  });

  test("a re-run tells nobody twice", async () => {
    const n = await notice("PUBLISHED");
    await PopupNoticeRecipient.insertMany([row(n._id, "USER"), row(n._id, "GUARDIAN")]);
    await notifyPopupRecipients(sender.toString(), n._id.toString(), TEXT);
    const again = await notifyPopupRecipients(sender.toString(), n._id.toString(), TEXT);
    expect(again).toEqual({ reachable: 2, created: 0, withoutLogin: 0 });
    expect(await Notification.countDocuments({})).toBe(2);
  });

  test("a draft notice is refused, and so is a malformed page", async () => {
    const draft = await notice("DRAFT");
    await expect(notifyPopupRecipients(sender.toString(), draft._id.toString(), TEXT)).rejects.toThrow(/not PUBLISHED/);
    const n = await notice("PUBLISHED");
    await expect(
      notifyPopupRecipients(sender.toString(), n._id.toString(), { ...TEXT, screenTarget: "HelpTab" }),
    ).rejects.toThrow(/Tab\/Screen/);
  });

  test("no page = a plain message with no screenTarget", async () => {
    const n = await notice("PUBLISHED");
    await PopupNoticeRecipient.insertMany([row(n._id, "USER")]);
    await notifyPopupRecipients(sender.toString(), n._id.toString(), { titleBn: "শিরোনাম", bodyBn: "বার্তা" });
    const r = await Notification.findOne({}).lean();
    expect(r?.refs?.screenTarget).toBeUndefined();
  });
});
