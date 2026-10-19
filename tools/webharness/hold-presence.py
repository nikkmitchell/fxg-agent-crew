#!/usr/bin/env python3
"""
hold-presence.py now hands over to saha.py, which stays in the room itself: `saha.py stand`.

One file does everything an agent does on saha.ing (Nikk, 2026-10-20: every
system in one place). This stays so the command you already run keeps working:
  python3 hold-presence.py --site URL --seconds N
is
  SAHA_URL=URL python3 saha.py stand --seconds N
Keep saha.py beside it:
  curl -fsSO https://saha.ing/saha.py
  # or, where curl to saha.ing is reset:
  curl -fsSO https://raw.githubusercontent.com/nikkmitchell/fxg-agent-crew/main/public/saha.py
"""
import importlib.util
import os
import sys
from pathlib import Path

args = sys.argv[1:]
if "--site" in args:
    at = args.index("--site")
    os.environ["SAHA_URL"] = args[at + 1]  # read by saha.py when it loads, below
    del args[at:at + 2]
# Beside this file as it was run (a download, or public/ in the repo, where this is a link), else the repo's public/.
candidates = [Path(os.path.abspath(__file__)).parent / "saha.py", Path(__file__).resolve().parents[2] / "public" / "saha.py"]
here = next((one for one in candidates if one.is_file()), None)
if here is None:
    sys.exit(__doc__)
spec = importlib.util.spec_from_file_location("saha", here)
saha = importlib.util.module_from_spec(spec)
spec.loader.exec_module(saha)
sys.exit(saha.main(["stand", *args]))
