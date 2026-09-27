#!/usr/bin/env python3
"""Protect the untouched profiles and validate every expanded holiday design."""
from pathlib import Path
import collections
import hashlib
import json
import runpy

ROOT = Path(__file__).resolve().parents[2]
d = runpy.run_path(str(ROOT / "JasonHome/tools/generate_anderson_events.py"))
baseline = {"events": d["events"], "categories": d["cat_index"],
            "major": d["major"], "specials": d["specials"]}
digest = hashlib.sha256(json.dumps(baseline, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
# Captured from 5.4.8 / 3d96f73 before editing. Includes every legacy color,
# effect, speed, identity, date, category, special date and major membership.
assert digest == "db7efc637a8059e2a450db040ce64c5890aa48af05844392509ba0a1b7a689c2", "Legacy profile/calendar drift"
assert len(d["events"]) == len(d["designs"]) == 210
assert len({e[1] for e in d["events"]}) == 210

changed = 0
families = collections.Counter()
for e in d["events"]:
    design = d["designs"][e[0]]
    palette = [e[12][i] for i in design["paletteOrder"]]
    assert set(palette) == set(e[12]), e[1] + ": event palette changed"
    assert any(palette), e[1] + ": all lamps would be off"
    assert not (design["effect"] == "Solid / Static" and len(set(palette)) > 1), e[1] + ": static drops all but Color 1"
    if any(word in e[1].lower() for word in ("epilepsy", "purple day", "remembrance", "memorial", "pow/mia", "gold star")):
        assert design["effect"] == "Breath" and design["speed"] == 1, e[1] + ": expected quiet, slow tribute"
    changed += (design["effect"], design["speed"], palette) != (e[10], e[11], e[12])
    families[design["effect"]] += 1

# These are the production read paths for cards, Preview, Oracle sync and the
# direct fallback. Both must select the new defaults ONLY for EXPANDED_COLORS.
bridge = (ROOT / "JasonHome/app/src/main/java/com/jasonhome/app/AndersonApiBridge.java").read_text()
schedule = (ROOT / "JasonHome/app/src/main/java/com/jasonhome/app/AndersonSchedule.java").read_text()
assert "e.defaultEffect(schedule.mode()==AndersonSchedule.Mode.EXPANDED_COLORS)" in bridge
assert "e.defaultSpeed(schedule.mode()==AndersonSchedule.Mode.EXPANDED_COLORS)" in bridge
assert 'boolean expanded=mode()==Mode.EXPANDED_COLORS;' in schedule
assert 'appPrefs.getString(p+"effect",e.defaultEffect(expanded))' in schedule
assert 'appPrefs.getInt(p+"speed",e.defaultSpeed(expanded))' in schedule
assert 'prefs.getString("event_"+e.id+"_effect"' in bridge  # retained saved edits
print(f"Expanded holiday regression: PASS; 210 designs, {changed} changed recipes; both Basic profiles identical to 5.4.8")
print("Motion families:", dict(sorted(families.items())))
