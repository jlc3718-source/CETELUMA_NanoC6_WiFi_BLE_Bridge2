from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    s = p.read_text()
    found = s.count(old)
    if found != count:
        raise SystemExit(f"{path}: expected {count} occurrence(s), found {found}: {old[:100]!r}")
    p.write_text(s.replace(old, new, count))


# Bottom-menu Logout: preserve the existing authenticated logout action while
# moving the control out of the header and making its purpose explicit.
p = Path("firmware/web/v3_mockup.js")
s = p.read_text()
old = "    user: '<circle cx=\"12\" cy=\"7\" r=\"4\"/><path d=\"M4 22v-3a8 8 0 0 1 16 0v3\"/>',\n    wifi: '<path d=\"M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0\"/><circle cx=\"12\" cy=\"20\" r=\"1\"/>',"
new = "    user: '<circle cx=\"12\" cy=\"7\" r=\"4\"/><path d=\"M4 22v-3a8 8 0 0 1 16 0v3\"/>',\n    logout: '<path d=\"M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5\"/>',\n    wifi: '<path d=\"M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0\"/><circle cx=\"12\" cy=\"20\" r=\"1\"/>',"
if s.count(old) != 1:
    raise SystemExit("v3_mockup.js: icon insertion anchor mismatch")
s = s.replace(old, new, 1)
old = "    const actions = q('.headerActions'), badge = byId('connectionBadge'), profile = byId('activeProfile');\n    badge.style.display = 'none';\n    profile.className = 'v3ProfileName'; profile.style.display = 'none';\n    const switcher = byId('switchProfile'); switcher.innerHTML = icon('user'); switcher.setAttribute('aria-label','Switch user'); switcher.title = 'Switch user';\n    actions.replaceChildren(badge, profile, switcher);"
new = "    const actions = q('.headerActions'), badge = byId('connectionBadge'), profile = byId('activeProfile');\n    badge.style.display = 'none';\n    profile.className = 'v3ProfileName'; profile.style.display = 'none';\n    const switcher = byId('switchProfile'); switcher.className = 'tab v3LogoutTab'; switcher.innerHTML = icon('logout') + '<span>Logout</span>'; switcher.setAttribute('aria-label','Logout'); switcher.title = 'Logout';\n    actions.replaceChildren(badge, profile); nav.appendChild(switcher);"
if s.count(old) != 1:
    raise SystemExit("v3_mockup.js: header switcher anchor mismatch")
s = s.replace(old, new, 1)
old = "byId('switchProfile').setAttribute('aria-label',window.andersonProfile ? `Switch user, currently ${window.andersonProfile.name}`:'Switch user'); syncPage();"
new = "byId('switchProfile').setAttribute('aria-label',window.andersonProfile ? `Logout ${window.andersonProfile.name}`:'Logout'); syncPage();"
if s.count(old) != 1:
    raise SystemExit("v3_mockup.js: syncRole switcher anchor mismatch")
s = s.replace(old, new, 1)
p.write_text(s)

# User-facing scheduler rules now describe the actual starvation-free policy.
replace(
    "firmware/web/index.html",
    '<button id="switchProfile" class="btn switchProfile" type="button" hidden>Switch User</button>',
    '<button id="switchProfile" class="btn switchProfile" type="button" hidden>Logout</button>',
)
replace(
    "firmware/web/index.html",
    "v==='rotate'?'Each enabled monthly event gets a full night, then the next one runs the following night.':v==='split'?'The scheduled night is divided evenly among enabled month-long events.':'Colors from all enabled month-long events are combined into one theme.'",
    "v==='rotate'?'Each enabled monthly event gets a full available night in order. If a whole month is occupied by higher-priority dates, one least-conflicted night reserves its first third for monthly coverage so none are skipped.':v==='split'?'The scheduled night is divided evenly among enabled month-long events.':'Colors from all enabled month-long events are combined into one theme.'",
)
replace(
    "firmware/web/index.html",
    '<div class="panel"><strong>Priority</strong><div class="sub" style="display:grid;gap:4px;margin-top:8px"><div>1. Manual override</div><div>2. Custom scheduled light</div><div>3. Specific holiday / awareness day</div><div>4. Holiday window</div><div>5. Month-long events</div><div>6. Seasonal theme</div><div>7. Normal preset</div></div></div>',
    '<div class="panel"><strong>Priority</strong><div class="sub" style="display:grid;gap:4px;margin-top:8px"><div>1. Manual override</div><div>2. Custom scheduled light</div><div>3. Specific holiday / awareness / seasonal day</div><div>4. Holiday window</div><div>5. Month-long events</div><div>6. Normal preset</div><div style="margin-top:5px">Coverage guarantee: if higher-priority dates occupy every night of a month, the least-conflicted night reserves its first third for the enabled month-long events; the higher-priority scene finishes the night and continues through Schedule 2.</div></div></div>',
)

# Make the 2026-2037 coverage audit a permanent release gate.
replace(
    ".github/workflows/compile-anderson-home-multi.yml",
    "      - name: Check Anderson source regressions\n        run: python tools/test_regressions.py\n",
    "      - name: Check Anderson source regressions\n        run: python tools/test_regressions.py\n      - name: Check scheduled event coverage\n        run: python tools/audit_event_coverage.py --start-year 2026 --end-year 2037 --require-full\n",
)

# Lock the fairness implementation and Logout placement into source regressions.
p = Path("tools/test_regressions.py")
s = p.read_text().replace("# v3.1.5 final UI build trigger", "# v3.1.6 event fairness and bottom-menu logout", 1)
anchor = "assert 'id=\\\"homeSpeed\\\"' in mock and 'Effect Speed' in mock and \"bindSpeedControl('homeSpeed')\" in mock\n"
addition = anchor + (
    "assert \"icon('logout') + '<span>Logout</span>'\" in mock and 'nav.appendChild(switcher)' in mock\n"
    "assert 'actions.replaceChildren(badge, profile, switcher)' not in mock and \"'Logout'\" in mock\n"
    "assert 'Specific holiday / awareness / seasonal day' in web and 'Coverage guarantee:' in web and '<div>6. Normal preset</div>' in web\n"
    "assert 'timedTierPick' in sched and 'monthlyEligiblePosition' in sched and 'MAX_ACTIVE_TIER_EVENTS=64' in sched\n"
    "assert 'Holiday, awareness, and seasonal dates all share the specific-event tier.' in sched\n"
    "assert 'forcedMonthlyCoverage' in sched and 'first third of the least-conflicted' in sched\n"
    "assert 'if(specificCount)' in sched and 'if(holidayWindowCount)' in sched\n"
    "assert 'python tools/audit_event_coverage.py --start-year 2026 --end-year 2037 --require-full' in build\n"
)
if s.count(anchor) != 1:
    raise SystemExit("test_regressions.py: insertion anchor mismatch")
p.write_text(s.replace(anchor, addition, 1))

# v3.1.6 version markers must agree before CI packages anything.
Path("FIRMWARE_VERSION.txt").write_text("3.1.6\n")
replace(
    "firmware/src/main.cpp",
    'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.5";',
    'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.6";',
)

print("Applied v3.1.6 UI, scheduler documentation, release gate, and version markers")
