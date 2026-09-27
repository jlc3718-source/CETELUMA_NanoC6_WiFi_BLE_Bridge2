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


# Craumer Home Expanded Colors (3.0.29+) curation.
# The original/basic tables remain untouched. These defaults combine documented
# awareness/observance colors with the now-supported motion families. Explicit
# entries cover the major holidays and campaigns; the fallback gives every
# remaining event a deliberate effect/speed instead of the old Jump-only default.
EXPANDED_OVERRIDES = {
    "New Year's Day": ("Twinkle / Sparkle",3,[0xFFD700,0xFFFFFA,0xA0A5AF]),
    "World Braille Day": ("Pulse Wave",2,[0xE08700,0x0096FF]),
    "Epiphany": ("Twinkle / Sparkle",1,[0xFFFFFA,0xFFD700]),
    "Orthodox Christmas": ("Candy Cane",2,[0xFF0000,0xFFFFFA,0xFFD700]),
    "National Human Trafficking Awareness Day": ("Breath",1,[0x245BFF]),
    "Martin Luther King Jr. Day": ("Wipe / Fill",2,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "International Holocaust Remembrance Day": ("Solid / Static",1,[0x245BFF,0xFFFFFA,0xFFD700]),
    "Black History Month": ("Wipe / Fill",2,[0xFF0000,0x000000,0x28FF00,0xFFD700]),
    "American Heart Month": ("Pulse Wave",2,[0xFF0000]),
    "National Freedom Day": ("Wipe / Fill",2,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "Groundhog Day": ("Wipe / Fill",2,[0x8B4513,0x28FF00]),
    "National Wear Red Day": ("Pulse Wave",2,[0xFF0000]),
    "Valentine's Day": ("Breath",2,[0xFF0000,0xFF0024,0xFF507A]),
    "Presidents' Day / Washington's Birthday": ("Chase",2,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "Mardi Gras / Shrove Tuesday": ("Chase",3,[0x5B00E6,0x28FF00,0xFFD700]),
    "Lunar New Year": ("Chase",3,[0xFF0000,0xFFD700]),
    "Ash Wednesday": ("Solid / Static",1,[0x6A0DAD]),
    "Ramadan": ("Breath",1,[0x0B6623,0xFFD700]),
    "International Women's Day": ("Gradient Sweep",2,[0x5B00E6,0x28FF00,0xFFFFFA]),
    "St. Patrick's Day": ("Chase",3,[0x28FF00,0xFFD700]),
    "Eid al-Fitr": ("Twinkle / Sparkle",2,[0x0B6623,0xFFD700,0xFFFFFA]),
    "World Down Syndrome Day": ("Candy Cane",2,[0x0096FF,0xFFD700]),
    "Purple Day / Epilepsy Awareness": ("Breath",1,[0x5B00E6]),
    "National Vietnam War Veterans Day": ("Solid / Static",1,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "International Transgender Day of Visibility": ("Wipe / Fill",2,[0x0096FF,0xFF4FA3,0xFFFFFA]),
    "Autism Acceptance Month": ("Wipe / Fill",2,[0xFF0000,0xFFD700]),
    "Sexual Assault Awareness Month": ("Breath",1,[0x00B4B4]),
    "Child Abuse Prevention Month": ("Breath",1,[0x245BFF]),
    "Parkinson's Awareness Month": ("Breath",1,[0xFF0000]),
    "Donate Life Month": ("Gradient Sweep",2,[0x0096FF,0x28FF00]),
    "April Fools' Day": ("Twinkle / Sparkle",4,[0xFFD700,0x5B00E6,0xFF4FA3,0x00FFFF]),
    "Passover": ("Breath",1,[0x245BFF,0xFFFFFA]),
    "Good Friday": ("Solid / Static",1,[0xFF0000,0x6A0DAD]),
    "Easter Sunday": ("Twinkle / Sparkle",2,[0xFFFFFA,0xFFD700,0xFF4FA3,0xB464FF]),
    "Yom HaShoah / Holocaust Remembrance Day": ("Solid / Static",1,[0x245BFF,0xFFFFFA,0xFFD700]),
    "Earth Day": ("Gradient Sweep",2,[0x28FF00,0x0096FF]),
    "Arbor Day": ("Wipe / Fill",2,[0x0B6623,0x8B4513]),
    "Mental Health Awareness Month": ("Breath",1,[0x28FF00]),
    "Jewish American Heritage Month": ("Breath",1,[0x245BFF,0xFFFFFA]),
    "Cinco de Mayo": ("Chase",3,[0x28FF00,0xFFFFFA,0xFF0000]),
    "Mother's Day": ("Breath",1,[0xFF4FA3,0xFF507A,0xFFFFFA]),
    "Peace Officers Memorial Day": ("Solid / Static",1,[0x001478,0x245BFF]),
    "Armed Forces Day": ("Chase",2,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "International Day Against Homophobia, Biphobia & Transphobia": ("Rainbow Flow",3,[0xFF0000,0xFF7A00,0xFFD700,0x28FF00,0x0096FF,0x5B00E6]),
    "Memorial Day": ("Solid / Static",1,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "Eid al-Adha": ("Twinkle / Sparkle",2,[0x0B6623,0xFFD700,0xFFFFFA]),
    "Pride Month": ("Rainbow Flow",3,[0xFF0000,0xFF7A00,0xFFD700,0x28FF00,0x0096FF,0x5B00E6]),
    "D-Day Remembrance": ("Solid / Static",1,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "Flag Day": ("Chase",2,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "Juneteenth": ("Wipe / Fill",2,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "Father's Day": ("Breath",1,[0x001478,0x0096FF,0xFFFFFA]),
    "Disability Pride Month": ("Gradient Sweep",2,[0xFF0000,0xFFD700,0xFFFFFA,0x0096FF,0x28FF00,0x000000]),
    "Independence Day": ("Strobe",4,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "Parents' Day": ("Breath",1,[0x0096FF,0xFF507A,0xFFFFFA]),
    "National Korean War Veterans Armistice Day": ("Solid / Static",1,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "Purple Heart Day": ("Breath",1,[0x5B00E6,0xFFD700]),
    "Suicide Prevention Awareness Month": ("Breath",1,[0x00B4B4,0x5B00E6]),
    "Childhood Cancer Awareness Month": ("Twinkle / Sparkle",1,[0xFFD700]),
    "Prostate Cancer Awareness Month": ("Breath",1,[0x0096FF]),
    "Ovarian Cancer Awareness Month": ("Breath",1,[0x00B4B4]),
    "Blood Cancer Awareness Month": ("Breath",1,[0xFF0000]),
    "National Recovery Month": ("Breath",1,[0x5B00E6]),
    "Labor Day": ("Wipe / Fill",2,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "988 Day": ("Breath",1,[0x00B4B4,0x5B00E6]),
    "World Suicide Prevention Day": ("Breath",1,[0x00B4B4,0x5B00E6,0xFFD700]),
    "Patriot Day / 9-11 Remembrance": ("Solid / Static",1,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "Rosh Hashanah": ("Twinkle / Sparkle",1,[0xFFFFFA,0x245BFF,0xFFD700]),
    "Grandparents Day": ("Breath",1,[0xFFD700,0xFF507A,0x0096FF]),
    "Hispanic Heritage Month": ("Gradient Sweep",2,[0xFF0000,0xFFFFFA,0x28FF00,0xFFD700,0x0096FF]),
    "Constitution Day & Citizenship Day": ("Wipe / Fill",2,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "National POW/MIA Recognition Day": ("Solid / Static",1,[0x000000,0xFFFFFA]),
    "Yom Kippur": ("Solid / Static",1,[0xFFFFFA]),
    "Gold Star Mother's & Family Day": ("Solid / Static",1,[0xFFD700,0x001478,0xFFFFFA]),
    "Breast Cancer Awareness Month": ("Breath",1,[0xFF0024,0xFF4FA3]),
    "Domestic Violence Awareness Month": ("Breath",1,[0x5B00E6]),
    "ADHD Awareness Month": ("Pulse Wave",2,[0xFF7A00]),
    "National Bullying Prevention Month": ("Breath",1,[0xFF7A00]),
    "Down Syndrome Awareness Month": ("Candy Cane",2,[0x0096FF,0xFFD700]),
    "Cybersecurity Awareness Month": ("Pulse Wave",2,[0x0096FF,0x28FF00]),
    "LGBTQ+ History Month": ("Rainbow Flow",3,[0xFF0000,0xFF7A00,0xFFD700,0x28FF00,0x0096FF,0x5B00E6]),
    "Filipino American History Month": ("Gradient Sweep",2,[0x0D00FF,0xFF0000,0xFFFFFA,0xFFD700]),
    "Pregnancy & Infant Loss Awareness Month": ("Breath",1,[0xFF4FA3,0x0096FF]),
    "World Mental Health Day": ("Breath",1,[0x28FF00]),
    "National Coming Out Day": ("Rainbow Flow",3,[0xFF0000,0xFF7A00,0xFFD700,0x28FF00,0x0096FF,0x5B00E6]),
    "Indigenous Peoples' Day / Columbus Day": ("Gradient Sweep",2,[0xFF0000,0xFF7A00,0x8B4513,0xFFD700,0x40E0D0]),
    "White Cane Safety Day": ("Wipe / Fill",1,[0xFFFFFA,0xFF0000]),
    "Pregnancy & Infant Loss Remembrance Day": ("Breath",1,[0xFF4FA3,0x0096FF]),
    "Spirit Day": ("Breath",1,[0x5B00E6]),
    "Dussehra": ("Chase",3,[0xFFD700,0xFF7A00,0xFF0000]),
    "World Stroke Day": ("Breath",1,[0x245BFF,0xFFFFFA]),
    "Halloween": ("Strobe",3,[0xFF7A00,0x5B00E6,0x28FF00,0x000000]),
    "Native American Heritage Month": ("Gradient Sweep",2,[0xFF0000,0xFF7A00,0x8B4513,0x40E0D0]),
    "National Diabetes Month": ("Breath",1,[0x0096FF]),
    "Lung Cancer Awareness Month": ("Breath",1,[0xFFFFFA]),
    "Pancreatic Cancer Awareness Month": ("Breath",1,[0x5B00E6]),
    "Epilepsy Awareness Month": ("Breath",1,[0x5B00E6]),
    "All Saints' Day": ("Twinkle / Sparkle",1,[0xFFFFFA,0xFFD700]),
    "All Souls' Day": ("Breath",1,[0x5B00E6,0xFFFFFA]),
    "Election Day": ("Wipe / Fill",2,[0xFF0000,0xFFFFFA,0x0D00FF]),
    "Diwali / Deepavali": ("Twinkle / Sparkle",3,[0xFFD700,0xFF7A00,0xFF0000,0xFF00FF]),
    "Veterans Day": ("Solid / Static",1,[0xFF0000,0xFFFFFA,0x0D00FF,0xFFD700]),
    "Transgender Day of Remembrance": ("Solid / Static",1,[0x0096FF,0xFF4FA3,0xFFFFFA]),
    "Thanksgiving": ("Wipe / Fill",2,[0xFF7A00,0xFFA000,0x8B4513,0xFFD700]),
    "Native American Heritage Day": ("Gradient Sweep",2,[0xFF0000,0xFF7A00,0x8B4513,0x40E0D0]),
    "World AIDS Day": ("Breath",1,[0xFF0000]),
    "International Day of Persons with Disabilities": ("Gradient Sweep",2,[0x5B00E6,0x0096FF]),
    "Hanukkah": ("Twinkle / Sparkle",2,[0x245BFF,0xFFFFFA,0xA0A5AF]),
    "Pearl Harbor Remembrance Day": ("Solid / Static",1,[0xFF0000,0xFFFFFA,0x001478]),
    "Human Rights Day": ("Breath",1,[0x0096FF,0xFFFFFA]),
    "Winter Solstice": ("Gradient Sweep",1,[0xFFFFFA,0x00B4B4,0x0096FF,0x0D00FF]),
    "Christmas Eve": ("Candy Cane",2,[0xFF0000,0x28FF00,0xFFD700]),
    "Christmas Day": ("Candy Cane",2,[0xFF0000,0x28FF00,0xFFFFFA,0xFFD700]),
    "Kwanzaa": ("Wipe / Fill",2,[0xFF0000,0x000000,0x28FF00]),
    "New Year's Eve": ("Strobe",4,[0xFFD700,0xA0A5AF,0xFFFFFA,0x5B00E6]),
}

SOLEMN_WORDS=("remembrance","memorial","holocaust","pow/mia","yom kippur","good friday","ash wednesday","gold star")
CELEBRATION_WORDS=("heritage","pride","festival","day","holiday")

def curate_expanded_event(e):
    eid,name,kind,rule,month,day,weekday,nth,offset,duration,effect,speed,modern,basic,major_cols=e
    if name in EXPANDED_OVERRIDES:
        effect,speed,modern=EXPANDED_OVERRIDES[name]
    else:
        lower=name.lower()
        # Every remaining expanded event gets a deliberate motion family.
        if any(w in lower for w in SOLEMN_WORDS):
            effect,speed="Solid / Static",1
        elif rule=="Month":
            if len(modern)>=4 or "heritage" in lower or "pride" in lower:
                effect,speed="Gradient Sweep",2
            elif len(modern)==1:
                effect,speed="Breath",1
            else:
                effect,speed="Breath",2
        elif kind=="Seasonal":
            effect,speed="Gradient Sweep",2
        elif kind=="Holiday":
            if len(modern)>=4:
                effect,speed="Gradient Sweep",2
            elif len(modern)>=2:
                effect,speed="Wipe / Fill",2
            else:
                effect,speed="Breath",1
        elif len(modern)>=4:
            effect,speed="Gradient Sweep",2
        elif len(modern)>=2:
            effect,speed="Pulse Wave",2
        else:
            effect,speed="Breath",1
    speed=max(1,min(5,int(speed)))
    modern=[int(c)&0xFFFFFF for c in modern[:8]]
    return (eid,name,kind,rule,month,day,weekday,nth,offset,duration,effect,speed,modern,basic,major_cols)

events=[curate_expanded_event(e) for e in events]

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
