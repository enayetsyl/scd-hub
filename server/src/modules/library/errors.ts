/** Domain error for library rule violations — message is the user-facing
 *  (Bangla) text the desk/app surfaces (NFR-5). */
export class LibraryError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "LibraryError";
  }
}
