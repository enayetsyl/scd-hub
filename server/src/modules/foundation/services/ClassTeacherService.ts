/**
 * ClassTeacherService (CT-1, D-#42/#53) — the section daily-coordinator + support
 * teacher assignments, each appended to the immutable ClassTeacherAssignment log.
 * The class teacher stays the single coordinator gate (`assertIsClassTeacher`);
 * support teachers are recorded helpers, not granted the gate.
 */
import { Types } from "mongoose";
import { Section, type ISection } from "../models/Section";
import { User } from "../models/User";
import { ClassTeacherAssignment, type IClassTeacherAssignment } from "../models/ClassTeacherAssignment";

async function assertTeacher(userId: string): Promise<void> {
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("User not found");
  if (user.role !== "TEACHER") throw new Error("Must be a TEACHER");
}

async function appendLog(
  sectionId: string,
  role: "class_teacher" | "support",
  teacherId: string | null,
  op: "assigned" | "cleared" | "removed",
  actorId: string,
): Promise<void> {
  await ClassTeacherAssignment.create({
    sectionId: new Types.ObjectId(sectionId),
    role,
    teacherId: teacherId ? new Types.ObjectId(teacherId) : undefined,
    op,
    actorId: new Types.ObjectId(actorId),
    at: new Date(),
  });
}

/** Assign or clear (userId=null) the section's class teacher (CT1.1) + log it (CT1.6). */
export async function assignClassTeacher(
  sectionId: string,
  userId: string | null,
  actorId: string,
): Promise<ISection> {
  const section = await Section.findById(sectionId);
  if (!section) throw new Error("Section not found");
  if (userId) {
    await assertTeacher(userId);
    section.classTeacherId = new Types.ObjectId(userId);
  } else {
    section.classTeacherId = undefined;
  }
  await section.save();
  await appendLog(sectionId, "class_teacher", userId, userId ? "assigned" : "cleared", actorId);
  return Section.findById(sectionId).lean() as unknown as ISection;
}

/** Add/remove a support teacher on the section (CT1.5) + log it (CT1.6). Support is
 *  NOT the coordinator gate. */
export async function setSupportTeacher(
  sectionId: string,
  userId: string,
  add: boolean,
  actorId: string,
): Promise<ISection> {
  const section = await Section.findById(sectionId);
  if (!section) throw new Error("Section not found");
  if (add) await assertTeacher(userId);
  const current = section.supportTeacherIds ?? [];
  if (add) {
    if (!current.some((id) => id.toString() === userId)) {
      section.supportTeacherIds = [...current, new Types.ObjectId(userId)];
    }
  } else {
    section.supportTeacherIds = current.filter((id) => id.toString() !== userId);
  }
  await section.save();
  await appendLog(sectionId, "support", userId, add ? "assigned" : "removed", actorId);
  return Section.findById(sectionId).lean() as unknown as ISection;
}

/** The append-only assignment history for a section, newest first (CT1.6). */
export async function classTeacherHistory(sectionId: string): Promise<IClassTeacherAssignment[]> {
  return ClassTeacherAssignment.find({ sectionId })
    .sort({ at: -1 })
    .lean() as unknown as IClassTeacherAssignment[];
}

/** The sections a teacher is class teacher of (CT1.2). */
export async function mySectionsAsClassTeacher(userId: string): Promise<ISection[]> {
  return Section.find({ classTeacherId: userId, active: true }).lean() as unknown as ISection[];
}
