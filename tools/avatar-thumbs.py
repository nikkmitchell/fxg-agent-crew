"""
Small avatar pictures, shipped with the site.

WHY. The catalogue's thumbnails live on arweave.net, and since saha.ing moved to
Shanghai (2026-09-27) neither the server nor anybody in China without a VPN can
reach it: the wardrobe on the profile page and the lobby's avatar picker showed
empty squares. They are also 800x1200 PNGs of about 225 KB, which is a lot for a
headset to decode three hundred of.

So they are fetched once, here, shrunk to 200x300 JPEGs of a few KB, and
committed under public/avatars/thumbs/<key>.jpg, where <key> is bodyKey(name)
from shared/avatar-choice.ts. Run again after the catalogue changes; files
already there are kept.

    python3 tools/avatar-thumbs.py

macOS only: it resizes with `sips`, which every Mac has. Downloads go through
curl, so an HTTPS_PROXY in the environment is used.
"""
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOGUE = os.path.join(ROOT, "public", "avatars", "catalogue.json")
OUT = os.path.join(ROOT, "public", "avatars", "thumbs")


def body_key(name: str) -> str:
    """shared/avatar-choice.ts bodyKey: lowercase, letters and digits only."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def one(entry: dict) -> str:
    key = body_key(entry["name"])
    target = os.path.join(OUT, f"{key}.jpg")
    if os.path.exists(target) and os.path.getsize(target) > 0:
        return "kept"
    with tempfile.TemporaryDirectory() as scratch:
        raw = os.path.join(scratch, "raw")
        fetched = subprocess.run(["curl", "-sfL", "-m", "120", "-o", raw, entry["thumbnail"]])
        if fetched.returncode != 0 or not os.path.exists(raw):
            return f"could not fetch {entry['name']}"
        made = subprocess.run(
            ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "70", "-z", "300", "200", raw, "--out", target],
            capture_output=True,
        )
        if made.returncode != 0:
            return f"could not shrink {entry['name']}"
    return "made"


def main() -> int:
    entries = [a for a in json.load(open(CATALOGUE))["avatars"] if a.get("thumbnail")]
    os.makedirs(OUT, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        results = list(pool.map(one, entries))
    problems = [r for r in results if r not in ("made", "kept")]
    print(f"{results.count('made')} made, {results.count('kept')} kept, {len(problems)} problems")
    for problem in problems:
        print(" ", problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
