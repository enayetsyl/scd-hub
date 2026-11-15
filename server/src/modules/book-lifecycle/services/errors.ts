/** A refused book-lifecycle action — a Bangla sentence for the person, never a fault (exposed by
 *  the GraphQL error mask through EXPECTED_ERROR_NAMES). `code` lets tests and the app tell reasons apart. */
export class BookLcError extends Error {
  code: string;
  constructor(code: string, msg: string) {
    super(msg);
    this.name = "BookLcError";
    this.code = code;
  }
}
