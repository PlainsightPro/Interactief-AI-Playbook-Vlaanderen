"""Extract structured content + images from the AI Playbook PDF.

Output:
  data/playbook.json  - hierarchical tree of pillars/activities with text & image refs
  img/p{N}-{idx}.{ext} - extracted images
"""

import json
import re
import hashlib
from pathlib import Path
import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = Path(r"C:\Users\DavidLoos\Downloads\AI_Playbook_kernactiviteiten_wlvopb (1).pdf")
IMG_DIR = ROOT / "img"
DATA_DIR = ROOT / "data"
IMG_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)


def slugify(text: str) -> str:
    s = text.lower()
    s = re.sub(r"[^a-z0-9\s\-_]", "", s)
    s = re.sub(r"\s+", "-", s).strip("-")
    return s[:80]


def parse_section_number(title: str):
    """Extract leading section number like '1.1.2' from a TOC title.
    Returns (number_or_None, cleaned_title) with tabs/newlines flattened."""
    flat = re.sub(r"[\t\r\n]+", " ", title).strip()
    flat = re.sub(r"\s{2,}", " ", flat)
    m = re.match(r"^\s*(\d+(?:\.\d+)*)[.\s]\s*(.*)$", flat)
    if m:
        return m.group(1), m.group(2).strip()
    return None, flat


BOILERPLATE_LINES = {
    "TERUG NAAR HET STAPPENPLAN",
    "TERUG NAAR DE INHOUD",
    "TERUG NAAR HET BEGIN",
}

PILLAR_HEADER_PATTERNS = [
    re.compile(r"^\s*VISIE\s*&\s*STRATEGIE\s*$", re.I),
    re.compile(r"^\s*INNOVATIE\s*$", re.I),
    re.compile(r"^\s*BETROUWBARE\s*AI\s*$", re.I),
    re.compile(r"^\s*MENS\s*&\s*ORGANISATIE\s*$", re.I),
    re.compile(r"^\s*AI[\s\-]ARCHITECTUUR\s*$", re.I),
]


def normalize_whitespace(text: str) -> str:
    lines = [line.rstrip() for line in text.splitlines()]
    cleaned = []
    for raw in lines:
        s = raw.strip()
        if s in BOILERPLATE_LINES:
            continue
        if any(p.match(s) for p in PILLAR_HEADER_PATTERNS):
            continue
        # Standalone page numbers (one or two digits, sometimes with surrounding whitespace)
        if re.fullmatch(r"\d{1,3}", s):
            continue
        # Caps section header with leading number (e.g. "3.\tBETROUWBARE AI" or "5. AI-ARCHITECTUUR")
        if re.fullmatch(r"\d+\.[\s\t]+[A-Z][A-Z &\-]+", s):
            continue
        cleaned.append(raw)
    # Collapse multiple blank lines
    result = []
    for line in cleaned:
        if result and not line.strip() and not result[-1].strip():
            continue
        result.append(line)
    return "\n".join(result).strip()


def strip_eindproduct_matrix(text: str) -> str:
    """Pillar pages start with a 'EINDPRODUCT × profile' matrix where 'a' marks applicability.
    Drop everything before the first prose paragraph (a line longer than 60 chars ending with period or comma)."""
    if "EINDPRODUCT" not in text[:600]:
        return text
    lines = text.splitlines()
    start_idx = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if len(stripped) > 60 and re.search(r"[.,:;]\s*$", stripped):
            start_idx = i
            break
        # Also stop at common section labels
        if re.match(r"^(Introductie|Inleiding|Overzicht)\b", stripped, re.I):
            start_idx = i
            break
    return "\n".join(lines[start_idx:]).strip() or text


def extract_text_range(doc, start_page_0idx: int, end_page_0idx: int) -> str:
    parts = []
    for p in range(start_page_0idx, min(end_page_0idx + 1, len(doc))):
        try:
            parts.append(doc[p].get_text("text"))
        except Exception:
            pass
    return normalize_whitespace("\n".join(parts))


def _is_pdf_artifact(data: bytes) -> bool:
    """True for tiny near-monochrome shapes (callouts, arrows, dividers extracted from the PDF chrome)."""
    if len(data) >= 10000:
        return False
    try:
        from io import BytesIO
        from PIL import Image
        img = Image.open(BytesIO(data)).convert("RGB")
    except Exception:
        return False
    return len(set(img.getdata())) <= 5


def extract_images_for_pages(doc, start_page_0idx: int, end_page_0idx: int, seen_hashes: dict):
    """Extract images appearing on these pages. Returns list of image filenames."""
    images = []
    for p in range(start_page_0idx, min(end_page_0idx + 1, len(doc))):
        page = doc[p]
        for img_index, img in enumerate(page.get_images(full=True)):
            xref = img[0]
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.n - pix.alpha >= 4:  # CMYK → convert
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                data = pix.tobytes("png")
                pix = None
            except Exception:
                continue
            if _is_pdf_artifact(data):
                continue
            h = hashlib.sha1(data).hexdigest()[:10]
            if h in seen_hashes:
                fname = seen_hashes[h]
            else:
                fname = f"p{p + 1}-{img_index}-{h}.png"
                (IMG_DIR / fname).write_bytes(data)
                seen_hashes[h] = fname
            if fname not in images:
                images.append(fname)
    return images


def render_page_image(doc, page_0idx: int, out_name: str, dpi: int = 110) -> str:
    """Render a full page as PNG (used for diagram/matrix pages)."""
    page = doc[page_0idx]
    pix = page.get_pixmap(dpi=dpi)
    out_path = IMG_DIR / out_name
    pix.save(str(out_path))
    return out_name


def build_tree(toc):
    """Build a hierarchical tree from a flat TOC list of (level, title, page)."""
    root = {"children": []}
    stack = [(0, root)]
    for level, title, page in toc:
        node = {
            "level": level,
            "title": title.strip(),
            "page": page,  # 1-indexed
            "children": [],
        }
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack[-1][1]["children"].append(node)
        stack.append((level, node))
    return root["children"]


def annotate_end_pages(nodes, fallback_end_page):
    """Each node gets end_page = next sibling's start_page - 1, recursively."""
    for i, node in enumerate(nodes):
        if i + 1 < len(nodes):
            node["end_page"] = nodes[i + 1]["page"] - 1
        else:
            node["end_page"] = fallback_end_page
        if node["children"]:
            annotate_end_pages(node["children"], node["end_page"])
            # Parent's own text region ends just before its first child
            node["own_end_page"] = node["children"][0]["page"] - 1
        else:
            node["own_end_page"] = node["end_page"]


def flatten_for_data(nodes, doc, seen_hashes, parent_path=None):
    parent_path = parent_path or []
    result = []
    for node in nodes:
        num, clean_title = parse_section_number(node["title"])
        path = parent_path + [clean_title]
        section_id = slugify(num or clean_title)
        if num:
            section_id = num.replace(".", "-")
        start = node["page"] - 1
        own_end = node["own_end_page"] - 1
        full_end = node["end_page"] - 1
        own_text = extract_text_range(doc, start, own_end)
        full_text = extract_text_range(doc, start, full_end)
        if node["level"] == 1:
            own_text = strip_eindproduct_matrix(own_text)
            full_text = strip_eindproduct_matrix(full_text)
        images = extract_images_for_pages(doc, start, own_end, seen_hashes)
        children = flatten_for_data(node["children"], doc, seen_hashes, path)
        result.append({
            "id": section_id,
            "number": num,
            "title": clean_title,
            "level": node["level"],
            "path": path,
            "page": node["page"],
            "own_text": own_text,
            "full_text": full_text,
            "images": images,
            "children": children,
        })
    return result


# Manual mapping of which activities are relevant per profile, derived from PDF stappenplans (pages 6-9).
# Each entry: (section_number, phase). Phase IDs: 1=verkennen, 2=keuzes, 3=capaciteiten, 4=implementeren, 5=evalueren
PROFILE_PHASE_MAP = {
    "verkenner": {
        "1.1": 2, "1.1.1": 2,
        "2.1.1": 1, "2.2.1": 1,
        "2.2.3": 4,
        "3.1": 1, "3.2": 1, "3.6": 2,
        "4.1.1": 1, "4.1.2": 3, "4.1.3": 3,
        "4.1.6": 4, "4.1.7": 4,
        "5.1": 1, "5.1.4": 2,
    },
    "piloot": {
        "1.1": 2, "1.1.1": 2, "1.1.2": 2, "1.1.3": 2, "1.2": 2, "1.3": 2, "1.4": 5,
        "2.1.1": 1, "2.1.2": 2, "2.1.3": 4, "2.1.4": 5,
        "2.2.1": 1, "2.2.2": 2, "2.2.3": 4, "2.2.4": 4, "2.2.5": 5,
        "3.1": 1, "3.2": 1, "3.3": 2, "3.4": 2, "3.5": 2, "3.6": 2,
        "3.7": 4, "3.8": 5,
        "4.1.1": 1, "4.1.2": 1, "4.1.3": 3, "4.1.4": 2, "4.1.5": 3,
        "4.1.6": 4, "4.1.7": 4, "4.1.8": 5,
        "4.2.1": 1, "4.2.2": 2, "4.2.3": 4, "4.2.4": 5, "4.2.5": 5,
        "5.1": 1, "5.1.4": 2, "5.2": 3, "5.3": 4, "5.4": 5,
    },
    "expert": {
        "1.1": 2, "1.1.1": 2, "1.1.2": 2, "1.1.3": 2, "1.2": 2, "1.3": 2, "1.4": 5,
        "2.1.1": 1, "2.1.2": 2, "2.1.3": 4, "2.1.4": 5,
        "2.2.1": 1, "2.2.2": 2, "2.2.3": 4, "2.2.4": 4, "2.2.5": 5,
        "3.1": 1, "3.2": 1, "3.3": 2, "3.4": 2, "3.5": 2, "3.6": 2,
        "3.7": 4, "3.8": 5,
        "4.1.1": 1, "4.1.2": 1, "4.1.3": 3, "4.1.4": 2, "4.1.5": 3,
        "4.1.6": 4, "4.1.7": 4, "4.1.8": 5,
        "4.2.1": 1, "4.2.2": 2, "4.2.3": 4, "4.2.4": 5, "4.2.5": 5,
        "5.1": 1, "5.1.4": 2, "5.2": 3, "5.3": 4, "5.4": 5, "5.5": 5, "5.6": 5,
    },
}

PHASE_NAMES = {
    1: "Verkennen & experimenteren",
    2: "Keuzes maken",
    3: "Capaciteiten ontwikkelen",
    4: "Implementeren",
    5: "Evalueren & opschalen",
}


def enrich_profiles(section, by_number):
    """Attach profiles[] + phase to each leaf, recursively."""
    num = section.get("number")
    section["profiles"] = []
    section["phase_by_profile"] = {}
    if num:
        for profile_id, mapping in PROFILE_PHASE_MAP.items():
            if num in mapping:
                section["profiles"].append(profile_id)
                section["phase_by_profile"][profile_id] = mapping[num]
    # Propagate to ancestors via children iteration in the caller
    for child in section.get("children", []):
        enrich_profiles(child, by_number)
        # Inherit child's profiles into parent
        for p in child["profiles"]:
            if p not in section["profiles"]:
                section["profiles"].append(p)


def index_by_number(sections, out=None):
    out = out if out is not None else {}
    for s in sections:
        if s.get("number"):
            out[s["number"]] = s
        index_by_number(s.get("children", []), out)
    return out


def main():
    print(f"Opening: {PDF_PATH}")
    doc = fitz.open(str(PDF_PATH))
    print(f"Pages: {len(doc)}")
    raw_toc = doc.get_toc()
    print(f"TOC entries: {len(raw_toc)}")

    # Filter out the 4 "Stappenplan" intro entries (they are not real pillars)
    # The 5 pillars are level-1 entries numbered 1..5
    pillar_toc = []
    for level, title, page in raw_toc:
        if level == 1 and re.match(r"^\d+\.", title.strip()):
            pillar_toc.append((level, title, page))
        elif level > 1:
            pillar_toc.append((level, title, page))

    print(f"Filtered TOC (pillars + descendants): {len(pillar_toc)}")

    tree = build_tree(pillar_toc)
    annotate_end_pages(tree, fallback_end_page=len(doc))

    seen_hashes = {}
    pillars = flatten_for_data(tree, doc, seen_hashes)

    by_number = index_by_number(pillars)
    for pillar in pillars:
        enrich_profiles(pillar, by_number)

    # Render the 4 stappenplan pages as hero images (pages 6-9, 1-indexed)
    stappenplan_pages = {
        "verkenner": 6,
        "piloot": 7,
        "expert": 8,
        "persoonlijk": 9,
    }
    stappenplan_images = {}
    for profile, page in stappenplan_pages.items():
        if page - 1 < len(doc):
            fname = f"stappenplan-{profile}.png"
            render_page_image(doc, page - 1, fname, dpi=140)
            stappenplan_images[profile] = fname

    output = {
        "meta": {
            "title": "AI Playbook — Kernactiviteiten",
            "subtitle": "Digitaal Vlaanderen — versie mei 2026",
            "pages": len(doc),
            "phases": PHASE_NAMES,
            "profiles": {
                "verkenner": "AI Verkenner",
                "piloot": "AI Piloot",
                "expert": "AI Expert",
            },
            "stappenplan_images": stappenplan_images,
            "image_count": len(seen_hashes),
        },
        "pillars": pillars,
    }

    out_path = DATA_DIR / "playbook.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out_path} ({out_path.stat().st_size:,} bytes)")
    print(f"Extracted {len(seen_hashes)} unique images to {IMG_DIR}")


if __name__ == "__main__":
    main()
