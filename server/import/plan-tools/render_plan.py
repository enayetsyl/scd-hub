#!/usr/bin/env python3
"""
render_plan.py — SCD Book Lesson-Plan renderer (SCD edition 2, derived from the Project 03 renderer).
Validated JSON  ->  teacher-facing Bangla Markdown (deliverable stays Markdown; JSON is internal scaffolding).

SCD edition 1 changes vs the Project 03 copy (Chapter-Plan and multi-period Session-Plan
output is otherwise byte-identical):
  (a) PROJECT_LABEL / BUILD_NOTE constants for the internal footer;
  (b) production_core pin -> "SCD-Guide-v1";
  (c) single-period standalone Session Plan now renders ALL seven Spine fields
      (the Project 03 copy emitted only Objective + Must-Cover — the D-038 gap).
SCD edition 2 adds: Nursery, KG and Classes 6–10 class names; subject ISL (ইসলাম শিক্ষা).

Section order, frozen heading strings, Closing order, the flow-card frozen cells, and the
numeral system are produced BY THIS TEMPLATE, not chosen by the chat — that is what removes
format/structure drift. Derived from LOCKED_ChapterPlan_Layout_Instruction_v3_3 (§A/§B/§C)
and LOCKED_SessionPlan_Layout_Instruction_v11 (§A/§C/§D/§E). Layouts are authoritative.
"""

CURRENT_BUILD_TARGET = {
    "chapter_layout": "v3.3",
    "session_layout": "v11",
    "production_core": "SCD-Guide-v3",
}

PROJECT_LABEL = "SCD Book Lesson Plans (P09)"   # change if the Project is named differently
BUILD_NOTE = "Rendered from validated JSON via render_plan.py SCD edition 2 (build-from-JSON; Markdown deliverable)."

_BN = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")

# Class name keyed on class_level ('NUR', 'KG' or 1–10).
CLASS_NAME = {"NUR": "নার্সারি", "KG": "কেজি",
              1: "প্রথম শ্রেণি", 2: "দ্বিতীয় শ্রেণি", 3: "তৃতীয় শ্রেণি",
              4: "চতুর্থ শ্রেণি", 5: "পঞ্চম শ্রেণি", 6: "ষষ্ঠ শ্রেণি",
              7: "সপ্তম শ্রেণি", 8: "অষ্টম শ্রেণি", 9: "নবম শ্রেণি", 10: "দশম শ্রেণি"}

SUBJECT_NAME = {"BAN": "বাংলা", "ENG": "English", "MATH": "গণিত", "SCI": "বিজ্ঞান",
                "BGS": "বাংলাদেশ ও বিশ্বপরিচয়", "ISL": "ইসলাম শিক্ষা"}

SEGMENT_DISPLAY = {  # frozen bilingual headings (§E / corpus)
    "Opening": "সূচনা / Opening",
    "Hook": "Hook",
    "DirectInstruction": "সরাসরি পাঠদান / Direct Instruction",
    "GuidedPractice": "পরিচালিত অনুশীলন / Guided Practice",
    "IndependentPractice": "স্বাধীন অনুশীলন / Independent Practice",
    "ExitCheck": "Exit-Check",
    "Closing": "সমাপ্তি / Closing",
}
MANDATORY_SEGMENTS = {"Opening", "Hook", "ExitCheck", "Closing"}


def is_eng(plan):
    return plan["subject"] == "ENG"


def num(n, plan):
    """Surface integer: Latin on an English plan, Bangla numerals otherwise (§C numeral rule)."""
    s = str(n)
    return s if is_eng(plan) else s.translate(_BN)


def mins(n, plan):
    return f"(≈{num(n, plan)} min)" if is_eng(plan) else f"(≈{num(n, plan)} মিনিট)"


def mand_label(mandatory):
    # Frozen flow-card cell text — exactly these two strings, all subjects incl. English (§E).
    return "✅ আবশ্যিক" if mandatory else "নমনীয়"


def _checkbox(items, plan):
    out = []
    for i, it in enumerate(items, 1):
        out.append(f"- [ ] **{num(i, plan)}.** {it}\n")
    return "\n".join(out)


def _plain_numbered(items, plan):
    # literal Bangla/Latin numeral + blank line between items (§C)
    return "\n\n".join(f"{num(i, plan)}. {it}" for i, it in enumerate(items, 1))


def _kv_table(rows):
    head = "| বিষয় | মান |\n| --- | --- |\n"
    body = "\n".join(f"| {r['label']} | {r['value']} |" for r in rows)
    return head + body


def _spine_lines(sp, plan, chapter=True):
    """The seven Spine fields. chapter=True reproduces the Project 03 Chapter-Plan output exactly;
    chapter=False is the single-period standalone form (Session-Plan layout §E)."""
    L = []
    L.append("## শিখন-উদ্দেশ্য / Learning Objective\n")
    L.append(f"**{sp['objective']['text']}**\n")
    L.append(f"{sp['objective']['how_known']}\n")
    if sp["objective"].get("per_period_note"):
        L.append(f"{sp['objective']['per_period_note']}\n")

    L.append("## আবশ্যিক বিষয় / Must-Cover Content\n")
    L.append(f"{sp['must_cover']['lead']}\n")
    L.append(_plain_numbered(sp["must_cover"]["items"], plan) + "\n")
    if sp["must_cover"].get("example_words"):
        L.append(f"{sp['must_cover']['example_words']}\n")

    L.append("## ব্লুম-স্তর / Bloom's Levels\n")
    L.append(f"{sp['bloom']['arc']}\n")
    L.append("| স্তর | কতটা | কোথায় দেখা যায় |\n| --- | --- | --- |")
    for r in sp["bloom"]["table"]:
        L.append(f"| {r['level']} | {r['amount']} | {r['where']} |")
    L.append("")

    L.append("## Exit-Check — শেষমুহূর্তের যাচাই\n")
    if chapter:
        L.append("নিচের তালিকা থেকে প্রতিটি পিরিয়ডে একটি বেছে নিন; পরপর দুই পিরিয়ডে একই যাচাই নয়।\n")
    else:
        L.append("নিচের তালিকা থেকে একটি বেছে নিন; বাকিগুলো পুনরায় শেখানোর পর যাচাইয়ে কাজে লাগবে।\n")
    bank_lines = []
    for it in sp["exit_check"]["bank"]:
        tag = " *(মূল)*" if it.get("primary") else ""
        bank_lines.append(f"{num(it['id'], plan)}.{tag} {it['text']}")
    L.append("\n\n".join(bank_lines) + "\n")
    L.append(f"> **মনে রাখার মতো একটি বিষয়।** {sp['exit_check']['reminder']}\n")

    L.append("## ইসলামি দিক থেকে যা খেয়াল রাখবেন / Islamic-Alignment\n")
    L.append(f"{sp['islamic_alignment']['text']}\n")

    L.append("## পুনরালোচনা / Revision\n")
    if chapter:
        L.append(f"**আগে যা শিখে এসেছে।** {sp['revision']['before']}\n")
        L.append(f"**এই অধ্যায়ে যা ফিরে দেখা হবে।** {sp['revision']['within']}\n")
        L.append(f"**পরে কোথায় কাজে লাগবে।** {sp['revision']['later']}\n")
    else:
        # single-period layout: two lines (আগে / পরে)
        L.append(f"**আগে যা শিখেছে।** {sp['revision']['before']}\n")
        L.append(f"**পরে কোথায় কাজে লাগবে।** {sp['revision']['later']}\n")

    L.append("## বাড়ির কাজ / Homework\n")
    L.append(_kv_table(sp["homework"]["rows"]) + "\n")
    L.append(f"{sp['homework']['reason']}\n")
    return L


# ---------------------------------------------------------------- Chapter Plan

def render_chapter(plan):
    cp = plan["chapter_plan"]
    d = plan["division"]
    subj_name = SUBJECT_NAME[plan["subject"]]
    cls = CLASS_NAME[plan["class_level"]]
    N = cp["period_count"]
    label = (" " + d["replacement_label"]) if d.get("replacement_label") else ""
    L = []

    # 1. Title (§B)
    L.append(f"# {d['anchor_word']} {num(d['number'], plan)}: {d['title']}{label} — {cls} {subj_name} ({num(N, plan)} পিরিয়ড)\n")

    # 2. Summary + prep
    s = cp["summary"]
    L.append("## এক নজরে ও শিক্ষকের প্রস্তুতি (শুরুতেই পড়ুন)\n")
    L.append(f"**এই অধ্যায়ে কী শেখাব।** {s['what_we_teach']}\n")
    L.append(f"**পিরিয়ড সংখ্যা।** {num(N, plan)} পিরিয়ড।\n")
    L.append(f"**সবচেয়ে জরুরি কথা।** {s['most_important']}\n")
    L.append(f"**ইসলামি দিক থেকে খেয়াল।** {s['islamic_note']}\n")
    L.append(f"**শিক্ষকের {num(len(s['prep_checklist']), plan)}-দফা প্রস্তুতি:**\n")
    L.append(_checkbox(s["prep_checklist"], plan) + "\n")

    # 3. Layer 1 Spine
    sp = cp["spine"]
    L.append("---\n\n# স্তর ১ — মূল কাঠামো / Layer 1 — Spine (পুরো অধ্যায়)\n")

    L.extend(_spine_lines(sp, plan, chapter=True))

    # 4. Session Map
    L.append("## কোন পিরিয়ডে কী / Session Map\n")
    L.append("নিচের ছকে পুরো অধ্যায়টি পিরিয়ড-ভিত্তিক ভাগ করা — কোন পিরিয়ডে কী শেখাবেন, কী দিয়ে যাচাই করবেন, কী বাড়ির কাজ দেবেন।\n")
    L.append("| # | পিরিয়ডের শিরোনাম | আজকের লক্ষ্য | আজ যা করব | আজকের Exit-Check | আজকের বাড়ির কাজ | আনুমানিক সময় |")
    L.append("| --- | --- | --- | --- | --- | --- | --- |")
    for row in cp["session_map"]:
        t = row["time"] if "≈" in row["time"] else f"≈{num(35, plan)} মিনিট"
        L.append(f"| {num(row['period'], plan)} | {row['title']} | {row['objective']} | {row['must_cover']} "
                 f"| যাচাই {num(row['exit_check_pointer'], plan)} | {row['homework']} | {t} |")
    L.append("")

    # 5. Overview card
    L.append("## 🟦 অধ্যায় এক নজরে / Chapter Overview Card\n")
    L.append(_kv_table(cp["overview_card"]["rows"]) + "\n")

    # 6. Internal footer
    L.append(_footer(plan))
    return "\n".join(L)


# ---------------------------------------------------------------- Session Plan

def render_session(plan):
    spn = plan["session_plan"]
    d = plan["division"]
    subj_name = SUBJECT_NAME[plan["subject"]]
    cls = CLASS_NAME[plan["class_level"]]
    multi = spn["session_form"] == "multi_period"
    L = []

    # 1. Title (§D)
    if multi:
        mm, NN = spn["period_index"], spn["period_of"]
        L.append(f"# পিরিয়ড {num(mm, plan)}: {spn.get('session_title', d['title'])} — {cls} {subj_name} ({num(mm, plan)}/{num(NN, plan)})\n")
    else:
        L.append(f"# {d['anchor_word']} {num(d['number'], plan)}: {d['title']} — {cls} {subj_name}\n")

    # 2. Summary + prep
    sm = spn["summary"]
    L.append("## এক নজরে ও শিক্ষকের প্রস্তুতি (শুরুতেই পড়ুন)\n")
    L.append(f"{sm['paragraph']}\n")
    L.append("**শিক্ষকের প্রস্তুতি:**\n")
    L.append(_checkbox(sm["prep_checklist"], plan) + "\n")

    # 3. §3.0 header (multi) OR inlined Spine (single)
    if multi:
        h = spn["session_header"]
        L.append("## এই পিরিয়ডে / This Session\n")
        L.append(f"**আজকের লক্ষ্য।** {h['objective']}\n")
        L.append(f"**আজ যা করব।** {h['must_cover']}\n")
        L.append(f"**আজকের Exit-Check।** {h['exit_check_text']}\n")
        L.append(f"**আজকের বাড়ির কাজ।** {h['homework']}\n")
        L.append(f"**ইসলামি দিক থেকে এক কথা।** {h['islamic_one_liner']}\n")
    else:
        # single-period standalone inlines ALL seven Spine fields (SCD edition 1 fix)
        L.append("# স্তর ১ — মূল কাঠামো / Layer 1 — Spine\n")
        L.extend(_spine_lines(spn["spine"], plan, chapter=False))

    # 4. Layer 2 Lesson Flow
    lf = spn["lesson_flow"]
    L.append("## স্তর ২ — পাঠ-প্রবাহ / Layer 2 — Lesson Flow\n")
    L.append(f"{lf['intro']}\n")
    for seg in lf["segments"]:
        mlab = "আবশ্যিক" if seg["mandatory"] else "নমনীয়"
        L.append(f"### {seg['display']} {mins(seg['minutes'], plan)} — {mlab}\n")
        if seg.get("is_checkbox") and isinstance(seg["body"], list):
            L.append(_checkbox(seg["body"], plan) + "\n")
        elif isinstance(seg["body"], list):
            L.append("\n".join(f"- {b}" for b in seg["body"]) + "\n")
        else:
            L.append(f"{seg['body']}\n")

    # 5. Layer 3 Flex Zone
    fz = spn["flex_zone"]
    L.append("## স্তর ৩ — মুক্ত-অঞ্চল / Layer 3 — Flex Zone\n")
    L.append(f"{fz['intro']}\n")
    for eb in fz["example_banks"]:
        L.append(f"**{eb['heading']}**\n")
        L.append("\n".join(f"- {it}" for it in eb["items"]) + "\n")
    L.append("**শিশুকে দিয়ে আবিষ্কার করানোর কিছু উপায়:**\n")
    L.append(_plain_numbered(fz["discovery_ways"], plan) + "\n")
    L.append(f"> **আবিষ্কার কাজ না করলে কী করবেন।** {fz['fallback']}\n")

    # 6. Replacement section (multi NEEDS-REPLACEMENT only)
    rs = spn.get("replacement_section")
    if rs:
        L.append("## ইসলামি দিক থেকে যা খেয়াল রাখবেন (এই পিরিয়ডের বদলি লেখা)\n")
        L.append(f"{rs['intro']}\n")
        L.append("\n".join(f"> {ln}" if ln.strip() else ">" for ln in rs["inline_content"].split("\n")) + "\n")
        L.append(f"**চিত্রণ।** {rs['illustration']}\n")
        L.append(f"**শিক্ষকের নোট।** {rs['teacher_note']}\n")
        L.append(f"**যে মূল্যবোধ ধারিত হলো।** {rs['positive_value']}\n")

    # 7. Flow card
    fc = spn["flow_card"]
    L.append("## 🟩 এক নজরে পুরো ক্লাস\n")
    L.append("| # | ধাপ | সময় | এক লাইনে কী করবেন | আবশ্যিক? |")
    L.append("| --- | --- | --- | --- | --- |")
    seg_by_name = {s["name"]: s for s in lf["segments"]}
    for i, row in enumerate(fc["rows"], 1):
        seg = seg_by_name[row["segment"]]
        disp = SEGMENT_DISPLAY[row["segment"]]
        cell = f"**{disp}**" if seg["mandatory"] else disp
        t = f"≈{num(seg['minutes'], plan)} min" if is_eng(plan) else f"≈{num(seg['minutes'], plan)} মি"
        L.append(f"| {num(i, plan)} | {cell} | {t} | {row['one_line']} | {mand_label(seg['mandatory'])} |")
    L.append("")
    L.append(f"> **মনে রাখুন:** {fc['remember_strip']}\n")

    # 8. Internal footer
    L.append(_footer(plan))
    return "\n".join(L)


def _footer(plan):
    f = plan.get("footer", {})
    lines = ["<!-- INTERNAL FOOTER"]
    lines.append(f"Project: {PROJECT_LABEL}")
    lines.append(f"Work-product: {plan['plan_type']}")
    lines.append(f"Subject/Division: C{plan['class_level']} {plan['subject']} "
                 f"{plan['division']['anchor_word']} {plan['division']['number']}")
    lines.append(f"Curation tag: {plan['curation_tag']}")
    lines.append(f"Built to: ChapterPlan Layout {CURRENT_BUILD_TARGET['chapter_layout']} + "
                 f"SessionPlan Layout {CURRENT_BUILD_TARGET['session_layout']} + "
                 f"Production Core {CURRENT_BUILD_TARGET['production_core']}")
    for k, v in f.items():
        lines.append(f"{k}: {v}")
    lines.append(BUILD_NOTE)
    lines.append("-->")
    return "\n".join(lines)


def render(plan):
    return render_chapter(plan) if plan["plan_type"] == "chapter_plan" else render_session(plan)


if __name__ == "__main__":
    import sys, json
    plan = json.load(open(sys.argv[1], encoding="utf-8"))
    print(render(plan))
