#!/usr/bin/env python3
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[2]
catalog=(ROOT/"firmware/src/EventCatalog.cpp").read_text()
colors=(ROOT/"firmware/src/EventColorThemes.cpp").read_text()
categories=(ROOT/"firmware/src/EventCategories.cpp").read_text()
out=ROOT/"JasonHome/app/src/main/java/com/jasonhome/app/AndersonEventData.java"

block=catalog[catalog.index("const EventDef EVENTS[]"):catalog.index("const size_t EVENT_COUNT")]
lines=[x.strip() for x in block.splitlines() if x.strip().startswith('{"evt')]
pat=re.compile(r'^\{"([^"]+)","([^"]+)",EventKind::(\w+),RuleType::(\w+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(\d+),Effect::(\w+),(\d+),C\d\(([^)]*)\)\s*\},?$')

speed_start=catalog.index("static const uint8_t EVENT_SPEEDS[]")
speed_body=catalog[catalog.index("{",speed_start)+1:catalog.index("};",speed_start)]
speeds=[int(x) for x in re.findall(r'\d+',speed_body)]

def cblock(name):
    s=colors.index(name)
    a=colors.index("{",s)
    b=colors.index("};",a)
    return colors[a+1:b]

def nums(s):
    return [int(x) for x in re.findall(r'\d+',s)]

def hexes(s):
    return [int(x,16) for x in re.findall(r'0x[0-9A-Fa-f]+',s)]

def rows(s):
    return [nums(m.group(1)) for m in re.finditer(r'\{([^}]*)\}',s)]

orig_dict=hexes(cblock("ORIGINAL_COLOR_DICTIONARY"))
orig_idx=rows(cblock("ORIGINAL_EVENT_COLOR_INDEX"))
orig_count=nums(cblock("ORIGINAL_EVENT_COLOR_COUNT"))
major=nums(cblock("MAJOR_US_EVENT_INDEX"))
federal=nums(cblock("MAJOR_US_FEDERAL_EVENT_INDEX"))
federal_count=nums(cblock("MAJOR_US_EVENT_COLOR_COUNT"))
federal_idx=rows(cblock("MAJOR_US_EVENT_COLOR_INDEX"))
preset_defaults=hexes(cblock("PRESET_DEFAULTS"))
federal_row={idx:i for i,idx in enumerate(federal)}

special_start=catalog.index("static const SpecialDate SPECIAL_DATES[]")
special_end=catalog.index("};",special_start)
specials=[]
for m in re.finditer(r'\{"(evt\d+)",(\d+),(\d+),(\d+)\}',catalog[special_start:special_end]):
    specials.append((m.group(1),int(m.group(2)),int(m.group(3)),int(m.group(4))))

cat_defs=[]
for m in re.finditer(r'\{"([^"]+)",\s*"([^"]+)",\s*"(#[0-9A-Fa-f]{6})"\}',categories):
    cat_defs.append((m.group(1),m.group(2),m.group(3)))
cat_start=categories.index("static constexpr uint8_t EVENT_CATEGORY_INDEX")
cat_open=categories.index("{",cat_start)
cat_close=categories.index("};",cat_open)
cat_index=[int(x) for x in re.findall(r'\d+',categories[cat_open+1:cat_close])]
if len(cat_defs)!=15:
    raise SystemExit("Expected 15 Anderson event categories")

def jstr(s):
    return s.replace("\\","\\\\").replace('"','\\"')

def iarr(a):
    return "new int[]{"+",".join("0x%06X"%v if v>255 else str(v) for v in a)+"}"

events=[]
id_to_index={}
for i,line in enumerate(lines):
    m=pat.match(line)
    if not m:
        raise SystemExit("Could not parse event: "+line)
    eid,name,kind,rule,month,day,weekday,nth,offset,duration,effect,count,cols=m.groups()
    modern=[int(x.strip(),16) for x in cols.split(",") if x.strip()]
    n=orig_count[i]
    basic=[orig_dict[orig_idx[i][k]] for k in range(n)]
    major_cols=list(basic)
    if i in federal_row:
        row=federal_row[i]
        major_cols=[preset_defaults[federal_idx[row][k]] for k in range(federal_count[row])]
    events.append((eid,name,kind,rule,int(month),int(day),int(weekday),int(nth),int(offset),int(duration),effect,speeds[i],modern,basic,major_cols))
    id_to_index[eid]=i

if len(cat_index)!=len(events):
    raise SystemExit("Anderson event category map count does not match event count")

java=[]
java.append("package com.jasonhome.app;\n")
java.append("final class AndersonEventData {")
java.append("  static final class Event {")
java.append("    final String id,name,kind,rule,effect;")
java.append("    final int month,day,weekday,nth,offsetDays,durationDays,speed;")
java.append("    final int[] modernColors,basicColors,majorColors;")
java.append("    Event(String id,String name,String kind,String rule,int month,int day,int weekday,int nth,int offsetDays,int durationDays,String effect,int speed,int[] modernColors,int[] basicColors,int[] majorColors){")
java.append("      this.id=id;this.name=name;this.kind=kind;this.rule=rule;this.month=month;this.day=day;this.weekday=weekday;this.nth=nth;this.offsetDays=offsetDays;this.durationDays=durationDays;this.effect=effect;this.speed=speed;this.modernColors=modernColors;this.basicColors=basicColors;this.majorColors=majorColors;")
java.append("    }")
java.append("  }")
java.append("  static final class Category {")
java.append("    final String id,name,color;")
java.append("    Category(String id,String name,String color){this.id=id;this.name=name;this.color=color;}")
java.append("  }")
java.append("  static final Category[] CATEGORIES=new Category[]{")
for cid,cname,ccolor in cat_defs:
    java.append('    new Category("%s","%s","%s"),' % (jstr(cid),jstr(cname),ccolor))
java.append("  };")
java.append("  static final int[] CATEGORY_INDEX=new int[]{"+",".join(map(str,cat_index))+"};")
java.append("  static final Event[] EVENTS=new Event[]{")
for e in events:
    eid,name,kind,rule,month,day,weekday,nth,offset,duration,effect,speed,modern,basic,major_cols=e
    java.append('    new Event("%s","%s","%s","%s",%d,%d,%d,%d,%d,%d,"%s",%d,%s,%s,%s),' % (
        eid,jstr(name),kind,rule,month,day,weekday,nth,offset,duration,effect,speed,iarr(modern),iarr(basic),iarr(major_cols)))
java.append("  };")
java.append("  static final int[] MAJOR=new int[]{"+",".join(map(str,major))+"};")
java.append("  static final int[][] SPECIAL=new int[][]{")
for eid,year,month,day in specials:
    if eid in id_to_index:
        java.append("    new int[]{%d,%d,%d,%d},"%(id_to_index[eid],year,month,day))
java.append("  };")
java.append("  private AndersonEventData(){}")
java.append("}")
out.write_text("\n".join(java))
print("generated",len(events),"events",len(specials),"special dates ->",out)
