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
    return (d.weekday() + 1) % 7


def easter_date(year: int) -> dt.date:
    a=year%19; b=year//100; c=year%100; d=b//4; e=b%4; f=(b+8)//25; g=(b-f+1)//3
    h=(19*a+b-d-g+15)%30; i=c//4; k=c%4; l=(32+2*e+2*i-h-k)%7; m=(a+11*h+22*l)//451
    return dt.date(year, (h+l-7*m+114)//31, ((h+l-7*m+114)%31)+1)


def event_start(e: Event, year: int, special) -> dt.date | None:
    if e.rule == 'Month': return dt.date(year, e.month, 1)
    if e.rule == 'Fixed': return dt.date(year, e.month, e.day)
    if e.rule == 'NthWeekday':
        first = dt.date(year, e.month, 1)
        day = 1 + ((e.weekday - cpp_wday(first) + 7) % 7) + 7 * (e.nth - 1)
        return dt.date(year, e.month, day) + dt.timedelta(days=e.offset)
    if e.rule == 'LastWeekday':
        day = calendar.monthrange(year, e.month)[1]
        last = dt.date(year, e.month, day)
        day -= (cpp_wday(last) - e.weekday + 7) % 7
        return dt.date(year, e.month, day) + dt.timedelta(days=e.offset)
    if e.rule == 'EasterOffset': return easter_date(year) + dt.timedelta(days=e.offset)
    if e.rule == 'MonthEnd': return dt.date(year, e.month, calendar.monthrange(year, e.month)[1])
    if e.rule in ('YearTable', 'Hanukkah'):
        return special.get(('evt202' if e.rule == 'Hanukkah' else e.id, year))
    raise ValueError(e.rule)


def active_on(e: Event, day: dt.date, special) -> bool:
    if e.rule == 'Month': return e.month == day.month
    for sy in (day.year - 1, day.year):
        start = event_start(e, sy, special)
        if start is not None and start <= day < start + dt.timedelta(days=max(1, e.duration)):
            return True
    return False


def window_on(e: Event, day: dt.date, special, lead=2, trail=0) -> bool:
    if e.kind != 'Holiday' or e.rule == 'Month' or active_on(e, day, special): return False
    for sy in (day.year - 1, day.year, day.year + 1):
        start = event_start(e, sy, special)
        if start is None: continue
        if start - dt.timedelta(days=lead) <= day < start + dt.timedelta(days=max(1, e.duration) + trail): return True
    return False


def current_pick(active, windows, day):
    exact_holiday = next((e for e in active if e.rule != 'Month' and e.kind == 'Holiday'), None)
    if exact_holiday: return exact_holiday
    exact_other = next((e for e in active if e.rule != 'Month' and e.kind != 'Seasonal'), None)
    if exact_other: return exact_other
    if windows: return windows[0]
    monthly = [e for e in active if e.rule == 'Month']
    if monthly:
        yday = day.timetuple().tm_yday - 1
        return monthly[(yday + day.year) % len(monthly)]
    return next((e for e in active if e.kind == 'Seasonal'), None)


def summarize(events, active_years, selected, label):
    never = [e for e in events if active_years[e.id] and not selected[e.id]]
    misses = []
    for e in events:
        picked_years = {d.year for d in selected[e.id]}
        misses.extend((e, y) for y in sorted(active_years[e.id] - picked_years))
    print(f"{label}: events never selected/covered = {len(never)}")
    for e in never: print(f"  NEVER {e.id} {e.name} [{e.kind}/{e.rule}]")
    print(f"{label}: event-year occurrences with no run = {len(misses)}")
    for e, year in misses[:250]: print(f"  MISS {year} {e.id} {e.name}")
    if len(misses) > 250: print(f"  ... {len(misses)-250} more")
    return len(never), len(misses)


def audit(start_year=2026, end_year=2037):
    events, special = load_catalog()
    all_days = []
    for year in range(start_year, end_year + 1):
        d = dt.date(year, 1, 1)
        while d.year == year:
            all_days.append(d); d += dt.timedelta(days=1)

    active_by_day = {}
    windows_by_day = {}
    active_years = {e.id: set() for e in events}
    for day in all_days:
        active = [e for e in events if active_on(e, day, special)]
        active_by_day[day] = active
        for e in active: active_years[e.id].add(day.year)
        windows_by_day[day] = [e for e in events if window_on(e, day, special)]

    eligible_by_month = {}
    forced_by_month = {}
    forced_months = []
    for year in range(start_year, end_year + 1):
        for month in range(1, 13):
            days = [dt.date(year, month, d) for d in range(1, calendar.monthrange(year, month)[1] + 1)]
            high_count = {d: len([e for e in active_by_day[d] if e.rule != 'Month']) + len(windows_by_day[d]) for d in days}
            eligible = [d for d in days if high_count[d] == 0]
            eligible_by_month[(year, month)] = eligible
            month_events = [e for e in events if e.rule == 'Month' and e.month == month]
            if month_events and not eligible:
                forced = min(days, key=lambda d: (high_count[d], d.day))
                forced_by_month[(year, month)] = forced
                forced_months.append((year, month, forced, high_count[forced]))

    current = {e.id: [] for e in events}
    fair = {e.id: [] for e in events}
    max_specific = max_windows = max_monthly = 0
    for day in all_days:
        active = active_by_day[day]; windows = windows_by_day[day]
        pick = current_pick(active, windows, day)
        if pick: current[pick.id].append(day)

        specific = [e for e in active if e.rule != 'Month']
        monthly = [e for e in active if e.rule == 'Month']
        max_specific = max(max_specific, len(specific)); max_windows = max(max_windows, len(windows)); max_monthly = max(max_monthly, len(monthly))
        forced = forced_by_month.get((day.year, day.month)) == day and bool(monthly)
        if forced:
            # Firmware reserves the first third of this least-conflicted night for
            # monthly themes; higher-priority events/windows still run afterward.
            covered = specific + windows + monthly
        elif specific:
            covered = specific
        elif windows:
            covered = windows
        elif monthly:
            eligible = eligible_by_month[(day.year, day.month)]
            ordinal = eligible.index(day)
            if len(eligible) >= len(monthly):
                covered = [monthly[ordinal % len(monthly)]]
            else:
                start = (ordinal * len(monthly)) // len(eligible)
                end = ((ordinal + 1) * len(monthly)) // len(eligible)
                covered = monthly[start:end]
        else:
            covered = []
        for e in covered: fair[e.id].append(day)

    print(f"Parsed {len(events)} built-in events")
    print(f"Audit horizon: {start_year}-{end_year}")
    current_result = summarize(events, active_years, current, 'Current resolver')
    fair_result = summarize(events, active_years, fair, 'Planned fair resolver')
    print(f"Months requiring one protected monthly coverage night: {len(forced_months)}")
    for y, m, d, conflicts in forced_months:
        print(f"  COVERAGE {y}-{m:02d}-{d.day:02d} higher-priority-scenes={conflicts}")
    print(f"Maximum simultaneous tiers: specific={max_specific}, holiday-window={max_windows}, monthly={max_monthly}")
    tier_overflow = max(max_specific, max_windows, max_monthly) > 64
    if tier_overflow: print('ERROR: active tier exceeds firmware fairness array capacity (64)')
    return current_result, fair_result, forced_months, tier_overflow


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--start-year', type=int, default=2026)
    ap.add_argument('--end-year', type=int, default=2037)
    ap.add_argument('--require-full', action='store_true')
    args = ap.parse_args()
    _, fair, _, overflow = audit(args.start_year, args.end_year)
    if args.require_full and (fair[0] or fair[1] or overflow): raise SystemExit(1)

if __name__ == '__main__': main()
