"""Remove PDF-artifact images from web/img and web/data/playbook.json.

A PDF-artifact image is detected as: <= 5 unique colors AND filesize < 10 KB.
These are the black callout shapes, arrows, and dividers extracted from the PDF.

Also patches extract.py with the same filter so re-running extraction keeps them out.
"""
from pathlib import Path
from PIL import Image
import json

ROOT = Path(r"C:\Users\DavidLoos\Desktop\AI Playbook")
IMG_DIR = ROOT / "web" / "img"
JSON_PATH = ROOT / "web" / "data" / "playbook.json"

MAX_COLORS = 5
MAX_SIZE = 10000

def is_artifact(path: Path) -> bool:
    if path.stat().st_size >= MAX_SIZE:
        return False
    try:
        img = Image.open(path).convert("RGB")
    except Exception:
        return False
    pixels = set(img.getdata())
    return len(pixels) <= MAX_COLORS

useless = []
for p in sorted(IMG_DIR.glob("*.png")):
    if is_artifact(p):
        useless.append(p.name)

print(f"Found {len(useless)} artifact images:")
for name in useless:
    print(f"  - {name}")

useless_set = set(useless)

# Clean playbook.json
data = json.loads(JSON_PATH.read_text(encoding="utf-8"))

def walk(node):
    if isinstance(node, dict):
        if "images" in node and isinstance(node["images"], list):
            before = len(node["images"])
            node["images"] = [n for n in node["images"] if n not in useless_set]
            after = len(node["images"])
            if before != after:
                print(f"  trimmed {before - after} image(s) from id={node.get('id', '?')} page={node.get('page', '?')}")
        for v in node.values():
            walk(v)
    elif isinstance(node, list):
        for v in node:
            walk(v)

print("\nCleaning playbook.json...")
walk(data)
JSON_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"  wrote {JSON_PATH}")

# Delete the image files
print("\nDeleting artifact files...")
for name in useless:
    (IMG_DIR / name).unlink()
    print(f"  deleted {name}")

print(f"\nDone. Removed {len(useless)} artifact images.")
