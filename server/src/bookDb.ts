/**
 * bookDb — the BOOK PLANE's own MongoDB connection (SB-1, D-#404).
 *
 * Book production references no student, guardian or staff row except a `userId`
 * for attribution, so it gets a SEPARATE connection rather than a separate
 * collection prefix. That makes the isolation **structural rather than
 * remembered** — the same posture ADR-005 takes for the corpus plane, where the
 * firewall is wiring and not a rule someone has to keep in mind.
 *
 * Consequences, all designed around rather than worked around:
 *   - **No `populate` or `$lookup` crosses the boundary.** A `userId` is stored as
 *     a bare ObjectId and resolved in the resolver against the MAIN connection.
 *     A `.populate("User")` from a book model cannot work and must not be added.
 *   - **No transaction spans the two.** A lesson merge is one write in one
 *     database; the audit row is already fire-and-forget.
 *   - Jest mocks the models, so no test opens this connection.
 *
 * Host: a self-hosted `mongod` on the app VM (D-#413), its WiredTiger cache
 * pinned to 1 GB — the default would claim ~11 GB for a database holding under
 * 100 MB of JSON and then contend with the SB-4 renderer for it.
 *
 * `connectDb()` (the identity/operational plane) is untouched by this file.
 */
import mongoose, { type Connection } from "mongoose";

/**
 * The book-plane connection object. Created UNOPENED at import time so models can
 * register on it immediately; `connectBookDb()` opens it at boot. Mongoose buffers
 * operations issued before the socket is up, so import order never matters.
 */
export const bookConnection: Connection = mongoose.createConnection();

let opened = false;

export class BookDbNotConfiguredError extends Error {
  constructor(msg = "BOOK_MONGODB_URI is not set") {
    super(msg);
    this.name = "BookDbNotConfiguredError";
  }
}

/**
 * Open the book-plane connection. Idempotent.
 *
 * Deliberately NOT called from `connectDb()`: the book plane is optional at boot,
 * so a school running without book production is not forced to provision a second
 * database. The caller decides — and a missing URI is a loud, named error rather
 * than a silent fallback onto the identity connection, which is the one mistake
 * this whole separation exists to prevent.
 */
export async function connectBookDb(uri?: string): Promise<void> {
  if (opened) return;
  const bookUri = uri ?? process.env.BOOK_MONGODB_URI;
  if (!bookUri) throw new BookDbNotConfiguredError();
  await bookConnection.openUri(bookUri);
  opened = true;
}

export async function disconnectBookDb(): Promise<void> {
  if (!opened) return;
  await bookConnection.close();
  opened = false;
}

/** True once the book plane is available — lets a resolver answer "not configured"
 *  instead of hanging on a buffered query that will never drain. */
export function isBookDbReady(): boolean {
  return opened && bookConnection.readyState === 1;
}
