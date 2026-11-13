/**
 * ONE hardened way to read pictures out of a zip, shared by the media upload of a version (BL-1), the
 * upload link `media_zip` (BL-4) and anything later: the number of entries is capped, dotfiles and
 * `__MACOSX` are skipped, an entry's DECLARED uncompressed size is checked BEFORE it is inflated, and the
 * running total is capped, so a small zip cannot expand into memory. Types come from the extension +
 * magic bytes (`detectLcMime`), never from a client; SVG is not an image here.
 */
import JSZip from "jszip";
import { BOOK_LC_LIMITS } from "@scd/shared";
import { BookLcError } from "./errors";
import { allowedMimesFor, capFor, capRefusalBn, detectLcMime } from "./files";

export const ZIP_MAX_ENTRIES = 5000;

/** Forward slashes, no leading "./" or "/". */
export const normZipPath = (p: string): string => p.split("\\").join("/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");

const junk = (p: string): boolean => p.split("/").some((seg) => seg.startsWith(".") || seg === "__MACOSX");

export interface MediaZip {
  entries: Map<string, JSZip.JSZipObject>;
  /** Inflated bytes read so far (the budget is the zip cap). */
  budget: { used: number; max: number };
}

export async function openMediaZip(buf: Buffer): Promise<MediaZip> {
  const cap = capFor("book_lc_media", "application/zip", { zip: true });
  if (buf.length > cap) throw new BookLcError("CAP", capRefusalBn(cap));
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new BookLcError("BAD_ZIP", "ছবির zip খোলা যায়নি");
  }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length > ZIP_MAX_ENTRIES) throw new BookLcError("BAD_ZIP", "ছবির zip-এ অনেক বেশি ফাইল");
  const entries = new Map<string, JSZip.JSZipObject>();
  for (const f of files) {
    const key = normZipPath(f.name);
    if (!key || junk(key)) continue;
    entries.set(key, f);
  }
  return { entries, budget: { used: 0, max: BOOK_LC_LIMITS.mediaZipBytes } };
}

/** Inflate one entry: declared size first, then type by extension + bytes, then the per-picture cap. */
export async function readMediaEntry(z: MediaZip, key: string): Promise<{ data: Buffer; mime: string; base: string }> {
  const entry = z.entries.get(key);
  if (!entry) throw new BookLcError("BAD_ZIP", `ছবির zip-এ নেই: ${key}`);
  const base = key.split("/").pop()!;
  const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declared !== "number") throw new BookLcError("BAD_ZIP", `ছবির zip-এর ${base} পড়া যায়নি`);
  const one = capFor("book_lc_media", "image/png");
  if (declared > one) throw new BookLcError("CAP", `${base}: ${capRefusalBn(one)}`);
  z.budget.used += declared;
  if (z.budget.used > z.budget.max) throw new BookLcError("CAP", "ছবির zip খুলে খুব বড় হয়ে যায়");
  const data = await entry.async("nodebuffer");
  const mime = detectLcMime(base, data, allowedMimesFor("book_lc_media"));
  if (!mime) throw new BookLcError("BAD_MEDIA", `ছবির ধরন চলবে না: ${base}`);
  if (data.length > capFor("book_lc_media", mime)) throw new BookLcError("CAP", `${base}: ${capRefusalBn(capFor("book_lc_media", mime))}`);
  return { data, mime, base };
}

/** A file name as one safe segment: letters, digits, dot, dash, underscore (no folders, no leading dot). */
export function safeFileName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  const cleaned = last.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned || "file";
}
