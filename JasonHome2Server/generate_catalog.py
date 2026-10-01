#!/usr/bin/env python3
"""Export the existing Jason Home event and color catalogs for the hosted UI."""
import json
import re
import runpy
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = runpy.run_path(str(root / "JasonHome/tools/generate_anderson_events.py"))
rows = source["events"]
designs = source["designs"]
categories = source["cat_defs"]
indexes = source["cat_index"]
major = set(source["major"])
special = source["specials"]

events = []
for i, row in enumerate(rows):
    eid, name, kind, rule, month, day, weekday, nth, offset, duration, effect, speed, modern, basic, major_colors = row
    design = designs[eid]
    events.append({
        "id": eid, "name": name, "kind": kind, "rule": rule,
        "month": month, "day": day, "weekday": weekday, "nth": nth,
        "offsetDays": offset, "durationDays": duration,
        "effect": effect, "speed": speed,
        "profiles": {
            "major": major_colors, "basic": basic,
            "expanded": [modern[j] for j in design["paletteOrder"]],
            "expandedEffect": design["effect"], "expandedSpeed": design["speed"],
        },
        "categoryIndex": indexes[i], "major": i in major,
        **({"factoryEffectName": "Garden Romance"} if eid == "evt134" else {}),
    })

palette_source = (root / "JasonHome/app/src/main/java/com/jasonhome/app/LightPresetCatalog.java").read_text()
block = palette_source.split("static final NamedColor[] ANDERSON = {", 1)[1].split("};", 1)[0]
palette = [
    {"index": i, "name": name, "color": "#" + code.upper(), "default": "#" + code.upper()}
    for i, (name, code) in enumerate(re.findall(r'new NamedColor\("([^"]+)",\s*0x([0-9A-Fa-f]{6}),\s*true\)', block))
]
assert len(events) >= 200 and len(palette) == 36 and len(categories) == 15
out = {
    "events": events,
    "categories": [
        {"index": i, "id": cid, "name": name, "color": color,
         "count": indexes.count(i)}
        for i, (cid, name, color) in enumerate(categories)
    ],
    "special": [
        {"id": eid, "year": year, "month": month, "day": day}
        for eid, year, month, day in special
    ],
    "palette": palette,
}
(Path(__file__).with_name("catalog.json")).write_text(json.dumps(out, separators=(",", ":")) + "\n")
print(f"Jason Home 2 catalog: {len(events)} events, {len(palette)} colors")
