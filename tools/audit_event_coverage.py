#!/usr/bin/env python3
from __future__ import annotations

import argparse
import calendar
import datetime as dt
import re
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "firmware/src/EventCatalog.cpp"

@dataclass(frozen=True)
class Event:
    idx: int
    id: str
    name: str
    kind: str
    rule: str
    month: int
    day: int
    weekday: int
    nth: int
    offset: int
    duration: int

EVENT_RE = re.compile(
    r'^\{"(?P<id>evt\d+)","(?P<name>[^"]+)",EventKind::(?P<kind>\w+),RuleType::(?P<rule>\w+),'
    r'(?P<month>-?\d+),(?P<day>-?\d+),(?P<weekday>-?\d+),(?P<nth>-?\d+),(?P<offset>-?\d+),'
    r'(?P<duration>\d+),Effect::\w+,C\d\([^\n]*\),(?P<colors>\d+)\s*\},?$', re.M
)
SPECIAL_RE = re.compile(r'\{"(?P<id>evt\d+)",(?P<year>\d{4}),(?P<month>\d+),(?P<day>\d+)\}')


def load_catalog():
    text = CATALOG.read_text()
    events = []
    for i, m in enumerate(EVENT_RE.finditer(text)):
        g = m.groupdict()
        events.append(Event(i, g['id'], g['name'], g['kind'], g['rule'], *(int(g[k]) for k in ('month','day','weekday','nth','offset','duration'))))
    if not events:
        raise SystemExit("No events parsed")
    special = {}
    for m in SPECIAL_RE.finditer(text):
        g = m.groupdict()
        special[(g['id'], int(g['year']))] = dt.date(int(g['year']), int(g['month']), int(g['day']))
    return events, special


def cpp_wday(d: dt.date) -> int:
    return (d.weekday() + 1) % 7  # Python Monday=0; C tm_wday Sunday=0


def easter_date(year: int) -> dt.date:
    # Gregorian algorithm identical to EventCatalog.cpp.
    a=year%19; b=year//100; c=year%100; d=b//4; e=b%4; f=(b+8)//25; g=(b-f+1)//3
    h=(19*a+b-d-g+15)%30; i=c//4; k=c%4; l=(32+2*e+2*i-h-k)%7; m=(a+11*h+22*l)//451
    month=(h+l-7*m+114)//31; day=((h+l-7*m+114)%31)+1
    return dt.date(year, month, day)


def event_start(e: Event, year: int, special) -> dt.date | None:
    if e.rule == 'Month':
        return dt.date(year, e.month, 1)
    if e.rule == 'Fixed':
        return dt.date(year, e.month, e.day)
    if e.rule == 'NthWeekday':
        first = dt.date(year, e.month, 1)
        day = 1 + ((e.weekday - cpp_wday(first) + 7) % 7) + 7 * (e.nth - 1)
        return dt.date(year, e.month, day) + dt.timedelta(days=e.offset)
    if e.rule == 'LastWeekday':
        day = calendar.monthrange(year, e.month)[1]
        last = dt.date(year, e.month, day)
        day -= (cpp_wday(last) - e.weekday + 7) % 7
        return dt.date(year, e.month, day) + dt.timedelta(days=e.offset)
    if e.rule == 'EasterOffset':
        return easter_date(year) + dt.timedelta(days=e.offset)
    if e.rule == 'MonthEnd':
        return dt.date(year, e.month, calendar.monthrange(year, e.month)[1])
    if e.rule in ('YearTable', 'Hanukkah'):
        key = ('evt202' if e.rule == 'Hanukkah' else e.id, year)
        return special.get(key)
    raise ValueError(e.rule)


def active_on(e: Event, day: dt.date, special) -> bool:
    if e.rule == 'Month':
        return e.month == day.month
    for sy in (day.year - 1, day.year):
        start = event_start(e, sy, special)
        if start is None:
            continue
        if start <= day < start + dt.timedelta(days=max(1, e.duration)):
            return True
    return False


def window_on(e: Event, day: dt.date, special, lead=2, trail=0) -> bool:
    if e.kind != 'Holiday' or e.rule == 'Month' or active_on(e, day, special):
        return False
    for sy in (day.year - 1, day.year, day.year + 1):
        start = event_start(e, sy, special)
        if start is None:
            continue
        duration = max(1, e.duration)
        if start - dt.timedelta(days=lead) <= day < start + dt.timedelta(days=duration + trail):
            return True
    return False


def current_pick(events, day, special):
    exact_holiday = None
    exact_other = None
    holiday_window = None
    seasonal = None
    monthly = []
    for e in events:
        active = active_on(e, day, special)
        if active:
            if e.kind == 'Seasonal':
                if seasonal is None: seasonal = e
                continue
            if e.rule == 'Month':
                monthly.append(e)
                continue
            if e.kind == 'Holiday':
                if exact_holiday is None: exact_holiday = e
            elif exact_other is None:
                exact_other = e
            continue
        if window_on(e, day, special) and holiday_window is None:
            holiday_window = e
    if exact_holiday: return exact_holiday
    if exact_other: return exact_other
    if holiday_window: return holiday_window
    if monthly:
        yday = day.timetuple().tm_yday - 1
        return monthly[(yday + day.year) % len(monthly)]
    if seasonal: return seasonal
    return None


def audit(start_year=2026, end_year=2037):
    events, special = load_catalog()
    selected = {e.id: [] for e in events}
    active_years = {e.id: set() for e in events}
    for year in range(start_year, end_year + 1):
        day = dt.date(year, 1, 1)
        while day.year == year:
            for e in events:
                if active_on(e, day, special):
                    active_years[e.id].add(year)
            pick = current_pick(events, day, special)
            if pick:
                selected[pick.id].append(day)
            day += dt.timedelta(days=1)
    never = [e for e in events if active_years[e.id] and not selected[e.id]]
    year_misses = []
    for e in events:
        picked_years = {d.year for d in selected[e.id]}
        for year in sorted(active_years[e.id] - picked_years):
            year_misses.append((e, year))
    print(f"Parsed {len(events)} built-in events")
    print(f"Audit horizon: {start_year}-{end_year}")
    print(f"Events never selected by current resolver: {len(never)}")
    for e in never:
        print(f"  NEVER {e.id} {e.name} [{e.kind}/{e.rule}]")
    print(f"Event-year occurrences with no selected run: {len(year_misses)}")
    for e, year in year_misses[:250]:
        print(f"  MISS {year} {e.id} {e.name}")
    if len(year_misses) > 250:
        print(f"  ... {len(year_misses)-250} more")
    return len(never), len(year_misses)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--start-year', type=int, default=2026)
    ap.add_argument('--end-year', type=int, default=2037)
    ap.add_argument('--require-full', action='store_true')
    args = ap.parse_args()
    never, misses = audit(args.start_year, args.end_year)
    if args.require_full and (never or misses):
        raise SystemExit(1)

if __name__ == '__main__':
    main()
