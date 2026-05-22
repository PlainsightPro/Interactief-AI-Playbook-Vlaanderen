"""Scan playbook images and flag ones that are likely PDF-extraction artifacts.

Two heuristics:
1. Single-color / near-single-color (variance < threshold).
2. Mostly black/dark shapes (mean luminance < threshold) AND small filesize.
3. Very low entropy (small palette).
"""
from pathlib import Path
from PIL import Image
import statistics

IMG_DIR = Path(r"C:\Users\DavidLoos\Desktop\AI Playbook\img")

def analyze(path: Path):
    try:
        img = Image.open(path).convert("RGB")
    except Exception as e:
        return {"path": path.name, "error": str(e)}
    w, h = img.size
    pixels = list(img.getdata())
    # Sample if large
    if len(pixels) > 20000:
        step = len(pixels) // 20000
        pixels = pixels[::step]
    lum = [0.299 * r + 0.587 * g + 0.114 * b for (r, g, b) in pixels]
    mean_lum = statistics.fmean(lum)
    stdev_lum = statistics.pstdev(lum) if len(lum) > 1 else 0
    unique_colors = len(set(pixels))
    size = path.stat().st_size
    # Heuristic: mostly black (< 60 mean), small file, few colors
    is_dark_blob = mean_lum < 60 and unique_colors < 50
    is_single_color = stdev_lum < 5
    return {
        "name": path.name,
        "size": size,
        "wh": f"{w}x{h}",
        "mean_lum": round(mean_lum, 1),
        "stdev_lum": round(stdev_lum, 1),
        "unique_colors": unique_colors,
        "dark_blob": is_dark_blob,
        "single_color": is_single_color,
    }

results = []
for p in sorted(IMG_DIR.glob("*.png")):
    r = analyze(p)
    results.append(r)

print(f"{'name':40} {'size':>8} {'wh':>10} {'lum':>6} {'std':>6} {'uniq':>5} flags")
for r in results:
    flags = []
    if r.get("dark_blob"): flags.append("DARK")
    if r.get("single_color"): flags.append("FLAT")
    print(f"{r['name']:40} {r['size']:>8} {r['wh']:>10} {r['mean_lum']:>6} {r['stdev_lum']:>6} {r['unique_colors']:>5} {','.join(flags)}")

print()
print("=== USELESS (DARK or FLAT) ===")
for r in results:
    if r.get("dark_blob") or r.get("single_color"):
        print(f"  {r['name']}  ({r['wh']}, lum={r['mean_lum']}, uniq={r['unique_colors']})")
