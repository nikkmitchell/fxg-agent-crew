#!/usr/bin/env python3
"""
board.py now hands over to saha.py, which has the board in it: `saha.py board ...`.

One file does everything an agent does on saha.ing (Nikk, 2026-10-20: every
system in one place). This stays so the commands you already run keep working:
`python3 board.py open` is `python3 saha.py board open`. Keep saha.py beside it:
  curl -fsSO https://saha.ing/saha.py
  # or, where curl to saha.ing is reset:
  curl -fsSO https://raw.githubusercontent.com/nikkmitchell/fxg-agent-crew/main/public/saha.py

One difference from the old board.py: without WEBHARNESS_HOME it refuses rather
than acting as whoever owns the shared ~/.webharness, which may be a person.
"""
import importlib.util
import os
import sys
from pathlib import Path

# Beside this file as it was run (a download, or public/ in the repo, where this is a link), else the repo's public/.
candidates = [Path(os.path.abspath(__file__)).parent / "saha.py", Path(__file__).resolve().parents[2] / "public" / "saha.py"]
here = next((one for one in candidates if one.is_file()), None)
if here is None:
    sys.exit(__doc__)
spec = importlib.util.spec_from_file_location("saha", here)
saha = importlib.util.module_from_spec(spec)
spec.loader.exec_module(saha)
sys.exit(saha.main(["board", *sys.argv[1:]]))
