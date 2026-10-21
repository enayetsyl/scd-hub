"""
Extract the picture bank from the school's Nursery book PDFs (D-#746).

    python -I extract.py --book BAN  "<Nursery (Bengali) 2026 ... .pdf>"  --out <dir>
    python -I extract.py --book ENG  "<Nursery (English) ... .pdf>"         --out <dir>
    python -I extract.py --book MATH_B "<Nursery - Math [B] ... .pdf>"      --out <dir>
    python -I extract.py --book MATH_E "<Math (E) Nursery ... .pdf>"         --out <dir>
    python -I extract.py --book ARABIC "<রওদাতুল আতফাল ১ম ভাগ.pdf>"          --out <dir>
    python -I extract.py --book ARABIC_KG "<রওদাতুল আতফাল ২য় ভাগ.pdf>"       --out <dir>

Then `node import.cjs <dir>/bundle.json` loads the bundle into Mongo.

What it does, per embedded image (poppler's `pdfimages`, page-numbered):
  * applies the image's soft mask onto white — the books place the same picture on
    blue/brown tiles with a mask, so masking is what makes those variants collapse
    into one clean picture;
  * drops fragments: either side < 90 px, aspect > 4:1, or near-uniform pixels;
  * de-duplicates per book by a 16×16 average hash (keeps the largest copy);
  * writes `image` (≤600 px PNG) and `thumb` (≤240 px JPEG) as base64 into
    bundle.json, with any curated tags from tags/<book>.json ("page:index" keys).

The Arabic books are page scans, so their pictures are cut by hand instead: every
tags/ARABIC.json / tags/ARABIC_KG.json entry carries a `scan` box and is lifted off the sky-blue page
(`lift_from_scan`).

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
from collections import deque

from PIL import Image
import numpy as np

# Books printed as page scans (one image per page): their pictures come only from the
# hand-drawn `scan` boxes in tags/<book>.json, never from the embedded images.
SCANNED_BOOKS = {"ARABIC", "ARABIC_KG"}
# Lift settings a scanned book's tags start from (a tag's own value wins). Book 2's word
# pages are paler than book 1's, so its page is also "near-white" and "near the box edge's
# own colour" (Euclidean distance in RGB).
SCAN_DEFAULTS = {"ARABIC_KG": {"white": 226, "near": 34}}

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


def render_region(pdf, page, rect_pt, tmp, dpi=300):
    """Render [x, y, w, h] (PDF points, top-left origin) of one page and trim the white
    margin — for a picture the book stores as several tiles side by side."""
    k = dpi / 72.0
    x, y, w, h = rect_pt
    stem = os.path.join(tmp, "region_%d" % page)
    subprocess.run(
        ["pdftoppm", "-r", str(dpi), "-png", "-f", str(page), "-l", str(page),
         "-x", str(int(x * k)), "-y", str(int(y * k)), "-W", str(int(w * k)), "-H", str(int(h * k)),
         "-singlefile", pdf, stem],
        check=True,
    )
    im = Image.open(stem + ".png").convert("RGB")
    ink = Image.eval(im.convert("L"), lambda v: 255 if v < 243 else 0).getbbox()
    if ink:
        pad = 6
        im = im.crop((max(0, ink[0] - pad), max(0, ink[1] - pad), min(im.width, ink[2] + pad), min(im.height, ink[3] + pad)))
    return im


def compose_tiles(tmp, layout):
    """Darken-composite the listed pdfimages tiles at their [num, x, y] offsets, then trim."""
    parts = [(Image.open(os.path.join(tmp, "i-%03d.png" % n)).convert("L"), x, y) for n, x, y in layout]
    w = max(x + p.width for p, x, _ in parts)
    h = max(y + p.height for p, _, y in parts)
    canvas = np.full((h, w), 255, dtype=np.uint8)
    for p, x, y in parts:
        a = np.asarray(p, dtype=np.uint8)
        canvas[y:y + a.shape[0], x:x + a.shape[1]] = np.minimum(canvas[y:y + a.shape[0], x:x + a.shape[1]], a)
    im = Image.fromarray(canvas).convert("RGB")
    ink = Image.eval(im.convert("L"), lambda v: 255 if v < 243 else 0).getbbox()
    if ink:
        im = im.crop((max(0, ink[0] - 6), max(0, ink[1] - 6), min(im.width, ink[2] + 6), min(im.height, ink[3] + 6)))
    return im


def whiten(im, level):
    """Turn every pixel at least `level` light in all channels white, then trim — for a picture
    the book embedded on a baked-in grey checkerboard (the BALL, owner 2026-10-17)."""
    a = np.asarray(im.convert("RGB")).copy()
    a[a.min(axis=2) >= level] = 255
    im = Image.fromarray(a)
    ink = Image.eval(im.convert("L"), lambda v: 255 if v < 243 else 0).getbbox()
    if ink:
        im = im.crop((max(0, ink[0] - 6), max(0, ink[1] - 6), min(im.width, ink[2] + 6), min(im.height, ink[3] + 6)))
    return im


def _grow(m):
    o = m.copy()
    o[1:] |= m[:-1]
    o[:-1] |= m[1:]
    o[:, 1:] |= m[:, :-1]
    o[:, :-1] |= m[:, 1:]
    return o


def _reach(seed, allowed):
    """Grow `seed` through 4-connected `allowed` pixels."""
    cur = seed & allowed
    while True:
        nxt = _grow(cur) & allowed
        if (nxt == cur).all():
            return cur
        cur = nxt


def _components(m):
    """4-connected labels of a boolean mask -> (label array, sizes; label n has sizes[n-1])."""
    lab = np.zeros(m.shape, dtype=np.int32)
    sizes = []
    h, w = m.shape
    for y0, x0 in zip(*np.nonzero(m)):
        if lab[y0, x0]:
            continue
        n = len(sizes) + 1
        lab[y0, x0] = n
        q = deque([(y0, x0)])
        c = 0
        while q:
            y, x = q.popleft()
            c += 1
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < h and 0 <= xx < w and m[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    q.append((yy, xx))
        sizes.append(c)
    return lab, sizes


def lift_from_scan(page_im, box, keep=0.05, pockets=True, white=None, near=None, raw=False):
    """Cut [x0, y0, x1, y1] (scan pixels) out of a scanned page and lift the picture off the
    book's sky-blue page (রওযাতুল আতফাল ১, scanned one image per page):
      * the page is pale sky blue — blue clearly above red, and light; only the sky reachable
        from the box edge is page, so blue INSIDE a picture (an iris) survives;
      * enclosed sky pockets of any real size (between a horse's legs, inside a padlock's
        shackle) are page too, unless `pockets` is off (a light-blue iris); then the
        pale-blue anti-alias fringe is eaten twice. The page measures blue - red ~45 and
        the book's white turbans and grey robes ~5-15, hence the 28 / 20 cut-offs;
      * of what is left, only parts at least `keep` × the largest survive — the printed word
        beside the picture and stray grid dots go."""
    x0, y0, x1, y1 = box
    if raw:
        # A picture printed as a framed scene (book 2's river): keep the box as it is.
        return page_im.crop((x0, y0, x1, y1)).convert("RGB")
    a = np.asarray(page_im.crop((x0, y0, x1, y1)).convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    sky = (b - r >= 28) & (b >= 170) & (g >= 160)
    border = np.zeros(sky.shape, dtype=bool)
    border[0] = border[-1] = True
    border[:, 0] = border[:, -1] = True
    # Book 2's word pages are paler, with white clouds behind some pictures: `white` also
    # counts near-white (every channel >= white) as page, from the box edge only.
    if white:
        sky = sky | (a.min(axis=2) >= white)
    if near:
        edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
        med = np.median(edge, axis=0)
        sky = sky | (np.sqrt(((a - med) ** 2).sum(axis=2)) < near)
    page = _reach(border, sky)
    if pockets:
        holes, sizes = _components(sky & ~page)
        page |= np.isin(holes, [i + 1 for i, s in enumerate(sizes) if s >= 80])
    fringe = (b - r >= 20) & (b >= 150)
    for _ in range(2):
        page |= _grow(page) & fringe
    fg = ~page
    parts, sizes = _components(fg)
    if sizes:
        big = max(sizes)
        fg = np.isin(parts, [i + 1 for i, s in enumerate(sizes) if s >= keep * big])
    a[~fg] = 255
    im = Image.fromarray(a.astype(np.uint8))
    ys, xs = np.nonzero(fg)
    if len(xs):
        im = im.crop((max(0, xs.min() - 6), max(0, ys.min() - 6), min(im.width, xs.max() + 7), min(im.height, ys.max() + 7)))
    return im


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
    ap.add_argument("--book", required=True, choices=["BAN", "ENG", "MATH_B", "MATH_E", "ARABIC", "ARABIC_KG"])
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
        # A scanned book's pages are JPEGs: dump them as stored (-j), since re-encoding
        # 85 full-page scans as PNG takes over a quarter of an hour.
        fmt = "-j" if args.book in SCANNED_BOOKS else "-png"
        subprocess.run(["pdfimages", fmt, local, os.path.join(tmp, "i")], check=True)

        kept = []  # (key, image, hash)
        for i, r in enumerate(rows):
            if r["type"] != "image" or args.book in SCANNED_BOOKS:
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

        # Pictures the book DRAWS (vector art — the numerals ১, ৫, ৬০ on the এ/ঞ/ষ pages) or
        # only shows as tiles have no single embedded image: a tag whose key names no embedded
        # image ("14:9001") and carries `render` becomes a page-region crop of its own.
        image_keys = {"%d:%d" % (r["page"], r["num"]) for r in rows}
        for key, t in tags.items():
            if (key not in image_keys and t.get("render")) or (args.book in SCANNED_BOOKS and t.get("scan")):
                kept.append((key, None, None))
        # a scanned book is one image per page: page number -> that image's number
        page_image = {r["page"]: r["num"] for r in rows if r["type"] == "image"}

        items = []
        for key, im, _ in kept:
            page, num = (int(x) for x in key.split(":"))
            t = tags.get(key, {})
            if t.get("scan"):
                # A scanned book (Arabic): "<page>:<n>" is the n-th picture on that page,
                # cut by hand from the page scan — [x0, y0, x1, y1] in scan pixels.
                scan = Image.open(os.path.join(tmp, "i-%03d.jpg" % page_image[page]))
                o = {**SCAN_DEFAULTS.get(args.book, {}), **t}
                im = lift_from_scan(scan, t["scan"], o.get("keep", 0.05), o.get("pockets", True), o.get("white"), o.get("near"), o.get("raw", False))
            elif t.get("tiles"):
                # The book's PDF places this picture's tiles slightly APART, so even its own
                # page shows white seams (the মৎস্য fish, owner 2026-10-17): butt the tiles
                # together as cut — [[image number, x, y], ...] in tile pixels.
                im = compose_tiles(tmp, t["tiles"])
            elif t.get("render"):
                # The book split this picture into tiles (the hilsa, owner 2026-10-17):
                # take the whole picture from the rendered page instead of one tile.
                im = render_region(local, page, t["render"], tmp)
            if t.get("whiten"):
                im = whiten(im, t["whiten"])
            img_b64, size = encode(im, IMAGE_MAX, "PNG")
            thumb_b64, _ = encode(im, THUMB_MAX, "JPEG")
            items.append({
                "book": args.book,
                "page": page,
                "imageIndex": num,
                "sourceKey": "%s:%d:%d" % (args.book, page, num),
                "word": t.get("word"),
                "wordEn": t.get("wordEn"),
                "letter": t.get("letter"),
                # the letter page it sits on (ব্যাঙ → ঙ): what picture–letter MATCH pairs with
                "pageLetter": t.get("pageLetter"),
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
