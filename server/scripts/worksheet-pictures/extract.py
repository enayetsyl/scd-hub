"""
Extract the picture bank from the school's Nursery book PDFs (D-#746).

    python -I extract.py --book BAN  "<Nursery (Bengali) 2026 ... .pdf>"  --out <dir>
    python -I extract.py --book ENG  "<Nursery (English) ... .pdf>"         --out <dir>
    python -I extract.py --book MATH_B "<Nursery - Math [B] ... .pdf>"      --out <dir>
    python -I extract.py --book MATH_E "<Math (E) Nursery ... .pdf>"         --out <dir>

Then `node import.cjs <dir>/bundle.json` loads the bundle into Mongo.

What it does, per embedded image (poppler's `pdfimages`, page-numbered):
  * applies the image's soft mask onto white — the books place the same picture on
    blue/brown tiles with a mask, so masking is what makes those variants collapse
    into one clean picture;
  * drops fragments: either side < 90 px, aspect > 4:1, or near-uniform pixels;
  * de-duplicates per book by a 16×16 average hash (keeps the largest copy);
  * writes `image` (≤600 px PNG) and `thumb` (≤240 px JPEG) as base64 into
    bundle.json, with any curated tags from tags/<book>.json ("page:index" keys).

The output is a work file, never committed (it is the books' pictures).
"""
import argparse
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image
import numpy as np

MIN_SIDE = 90
MAX_ASPECT = 4.0
IMAGE_MAX = 600
THUMB_MAX = 240
HASH_DIST = 18


def list_images(pdf):
    out = subprocess.run(["pdfimages", "-list", pdf], capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.splitlines()[2:]:
        p = line.split()
        if len(p) < 4:
            continue
        rows.append({"page": int(p[0]), "num": int(p[1]), "type": p[2], "w": int(p[3]), "h": int(p[4])})
    return rows


def composite(img_path, mask_path):
    im = Image.open(img_path)
    if im.mode == "CMYK":
        im = im.convert("RGB")
    im = im.convert("RGBA")
    if mask_path and os.path.exists(mask_path):
        m = Image.open(mask_path).convert("L")
        if m.size != im.size:
            m = m.resize(im.size)
        im.putalpha(m)
    bg = Image.new("RGB", im.size, "white")
    bg.paste(im, mask=im.split()[-1])
    return bg


def ahash(im):
    g = np.asarray(im.convert("L").resize((16, 16), Image.LANCZOS), dtype=np.float32)
    return (g > g.mean()).flatten()


def is_blank(im):
    a = np.asarray(im.convert("L").resize((64, 64)), dtype=np.float32)
    return a.std() < 6 or (a > 245).mean() > 0.985


def encode(im, max_side, fmt):
    c = im.copy()
    c.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    if fmt == "JPEG":
        c.save(buf, "JPEG", quality=82, optimize=True)
    else:
        c.save(buf, "PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii"), c.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", required=True, choices=["BAN", "ENG", "MATH_B", "MATH_E", "ARABIC"])
    ap.add_argument("pdf")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    if not shutil.which("pdfimages"):
        sys.exit("pdfimages (poppler) is required")

    here = os.path.dirname(os.path.abspath(__file__))
    tags_path = os.path.join(here, "tags", f"{args.book}.json")
    tags = json.load(open(tags_path, encoding="utf-8")) if os.path.exists(tags_path) else {}

    os.makedirs(args.out, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="wsx_")
    try:
        # Copy first: poppler on Windows cannot open paths with [brackets].
        local = os.path.join(tmp, "book.pdf")
        shutil.copyfile(args.pdf, local)
        rows = list_images(local)
        subprocess.run(["pdfimages", "-png", local, os.path.join(tmp, "i")], check=True)

        kept = []  # (key, image, hash)
        for i, r in enumerate(rows):
            if r["type"] != "image":
                continue
            nxt = rows[i + 1] if i + 1 < len(rows) else None
            mask = os.path.join(tmp, "i-%03d.png" % nxt["num"]) if nxt and nxt["type"] in ("smask", "mask") else None
            path = os.path.join(tmp, "i-%03d.png" % r["num"])
            if not os.path.exists(path):
                continue
            w, h = r["w"], r["h"]
            if min(w, h) < MIN_SIDE or max(w, h) / max(1, min(w, h)) > MAX_ASPECT:
                continue
            im = composite(path, mask)
            if is_blank(im):
                continue
            hsh = ahash(im)
            dup = None
            for k, (key, prev, ph) in enumerate(kept):
                if int((ph != hsh).sum()) <= HASH_DIST:
                    dup = k
                    break
            key = "%d:%d" % (r["page"], r["num"])
            if dup is None:
                kept.append((key, im, hsh))
            elif im.size[0] * im.size[1] > kept[dup][1].size[0] * kept[dup][1].size[1]:
                # keep the bigger copy but the FIRST page it appeared on
                kept[dup] = (kept[dup][0] if kept[dup][0] in tags else key, im, hsh)

        items = []
        for key, im, _ in kept:
            page, num = (int(x) for x in key.split(":"))
            img_b64, size = encode(im, IMAGE_MAX, "PNG")
            thumb_b64, _ = encode(im, THUMB_MAX, "JPEG")
            t = tags.get(key, {})
            items.append({
                "book": args.book,
                "page": page,
                "imageIndex": num,
                "sourceKey": "%s:%d:%d" % (args.book, page, num),
                "word": t.get("word"),
                "wordEn": t.get("wordEn"),
                "letter": t.get("letter"),
                "uses": t.get("uses", ["COUNT"] if args.book.startswith("MATH") else []),
                # Bangla/English: only a reviewed (tagged) picture starts active — the books
                # split many photos into tiles, and an untagged fragment must never reach a
                # paper. Maths: every clean single object is a counting picture by default.
                "active": t.get("active", bool(t) or args.book.startswith("MATH")),
                "mime": "image/png",
                "width": size[0],
                "height": size[1],
                "image": img_b64,
                "thumb": thumb_b64,
            })

        bundle = os.path.join(args.out, "bundle.json")
        existing = json.load(open(bundle, encoding="utf-8")) if os.path.exists(bundle) else []
        existing = [x for x in existing if x["book"] != args.book] + items
        json.dump(existing, open(bundle, "w", encoding="utf-8"), ensure_ascii=False)
        tagged = sum(1 for x in items if x["letter"] or x["word"])
        print("%s: %d embedded -> %d kept, %d tagged -> %s" % (args.book, len(rows), len(items), tagged, bundle))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
