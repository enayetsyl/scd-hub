/**
 * PB-1 (D-#1661) — GET /files/:id for a `bookpdf_page`, through the real files router.
 * The kind must NOT start with `book_` (that prefix dispatches to the book-production gate).
 *
 *   teacher with class_books:view            → 200
 *   teacher with only lesson_plans:read_book → 200
 *   guardian                                 → 403
 *   book_production:view only (no read action) → 403
 *   hidden book / PROCESSING book (teacher)  → 403; the manager still reads a hidden one
 *
 * In-memory MongoDB, Drive stubbed.
 */
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

jest.mock("../modules/platform/services/DriveStore", () => {
  const actual = jest.requireActual("../modules/platform/services/DriveStore");
  return { ...actual, downloadFromDrive: async () => Buffer.from("jpeg-bytes"), uploadToDrive: async () => "d", deleteFromDrive: async () => undefined };
});

import { filesRouter } from "../routes/files";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { BookPdf } from "../modules/book-pdf/models/BookPdf";
import { STORED_FILE_KINDS } from "../modules/platform/models/StoredFile";

jest.setTimeout(120_000);

const app = express();
app.use("/files", filesRouter);
const SECRET = process.env.JWT_SECRET ?? "dev-secret";
const tok = (role: string, extra: Record<string, unknown> = {}) => jwt.sign({ userId: new Types.ObjectId().toString(), role, ...extra }, SECRET);

let mongo: MongoMemoryServer;
let fileId: string;
let pdfId: Types.ObjectId;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([StoredFile.deleteMany({}), BookPdf.deleteMany({})]);
  const f = await StoredFile.create({
    kind: "bookpdf_page",
    mime: "image/jpeg",
    sizeBytes: 10,
    originalName: "p1.jpg",
    driveFileId: "drive-1",
    uploadedBy: new Types.ObjectId(),
  });
  fileId = f._id.toString();
  const row = await BookPdf.create({
    bookCode: "C3-BAN",
    classLevel: 3,
    subject: "BAN",
    titleBn: "বই",
    status: "READY",
    active: true,
    pageFileIds: [f._id],
    pageCount: 1,
    uploadedBy: new Types.ObjectId(),
  });
  pdfId = row._id;
});

const get = (token: string | null) => {
  const r = request(app).get(`/files/${fileId}`);
  return token ? r.set("Authorization", `Bearer ${token}`) : r;
};

it("the kind does not start with book_ (the book-production prefix gate)", () => {
  expect(STORED_FILE_KINDS).toContain("bookpdf_page");
  expect("bookpdf_page".startsWith("book_")).toBe(false);
});

it("a teacher reads a page (class_books:view), and so does a holder of only lesson_plans:read_book", async () => {
  expect((await get(tok("TEACHER"))).status).toBe(200);
  const onlyPlan = tok("TEACHER", { revokedPermissions: ["class_books:view"] });
  expect((await get(onlyPlan)).status).toBe(200);
});

it("a guardian and an anonymous caller are refused", async () => {
  expect((await get(tok("GUARDIAN"))).status).toBe(403);
  expect((await get(null)).status).toBe(403);
});

it("book_production:view alone does not open it", async () => {
  const t = tok("TEACHER", {
    grantedPermissions: ["book_production:view"],
    revokedPermissions: ["lesson_plans:read_book", "class_books:view", "class_books:manage"],
  });
  expect((await get(t)).status).toBe(403);
});

it("a hidden or still-processing book is closed to a teacher; the manager reads a hidden one", async () => {
  await BookPdf.updateOne({ _id: pdfId }, { $set: { active: false } });
  expect((await get(tok("TEACHER"))).status).toBe(403);
  expect((await get(tok("OFFICE"))).status).toBe(200);
  await BookPdf.updateOne({ _id: pdfId }, { $set: { active: true, status: "PROCESSING" } });
  expect((await get(tok("TEACHER"))).status).toBe(403);
});
