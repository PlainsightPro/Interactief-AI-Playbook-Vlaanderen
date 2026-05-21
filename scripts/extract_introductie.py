"""Extract full text from the AI Playbook Introductie PDF for inspection."""

from pathlib import Path
import fitz  # PyMuPDF

PDF_PATH = Path(r"C:\Users\DavidLoos\Desktop\AI Interactive Playbook\AI_Playbook_ortcsk.pdf")
OUT_TXT = Path(r"C:\Users\DavidLoos\Desktop\AI Playbook\_introductie_text.txt")


def main():
    doc = fitz.open(str(PDF_PATH))
    print(f"Total pages: {len(doc)}")

    toc = doc.get_toc()
    print(f"TOC entries: {len(toc)}")
    for level, title, page in toc:
        indent = "  " * (level - 1)
        print(f"  {indent}p{page}: {title}")

    lines = []
    lines.append(f"=== AI_Playbook_ortcsk.pdf ===")
    lines.append(f"Total pages: {len(doc)}")
    lines.append("")
    lines.append("=== TOC ===")
    for level, title, page in toc:
        indent = "  " * (level - 1)
        lines.append(f"{indent}p{page}: {title}")
    lines.append("")

    for i, page in enumerate(doc):
        lines.append("=" * 70)
        lines.append(f"PAGE {i + 1}")
        lines.append("=" * 70)
        text = page.get_text("text")
        lines.append(text)
        lines.append("")

        # Also list images present on this page
        images = page.get_images(full=True)
        if images:
            lines.append(f"[Page {i + 1} has {len(images)} image(s)]")
            for idx, img in enumerate(images):
                lines.append(f"  - image {idx}: xref={img[0]} w={img[2]} h={img[3]}")
            lines.append("")

    OUT_TXT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_TXT} ({OUT_TXT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
