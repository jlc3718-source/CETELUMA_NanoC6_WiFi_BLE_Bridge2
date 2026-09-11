from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))


Path("FIRMWARE_VERSION.txt").write_text("3.0.15\n")
replace_once("README.md", "Current firmware: **v3.0.14**.", "Current firmware: **v3.0.15**.")

replace_once(
    "firmware/src/main.cpp",
    """static constexpr uint16_t DAILY_REBOOT_MINUTE=15U*60U;
static bool dailyRebootClockInitialized=false;
static int32_t dailyRebootHandledDay=-1;""",
    """static constexpr uint16_t MAINTENANCE_REBOOT_MINUTES[]={0U,6U*60U,12U*60U,18U*60U};
static constexpr uint8_t MAINTENANCE_REBOOT_COUNT=sizeof(MAINTENANCE_REBOOT_MINUTES)/sizeof(MAINTENANCE_REBOOT_MINUTES[0]);
static bool maintenanceRebootClockInitialized=false;
static int32_t maintenanceRebootHandledSlot=-1;""",
)
replace_once(
    "firmware/src/main.cpp",
    'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.0.14";',
    'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.0.15";',
)

old_system = """static String systemJson(){
  JsonDocument d;const bool wifiConnected=WiFi.status()==WL_CONNECTED;const esp_partition_t* running=esp_ota_get_running_partition();const uint32_t slotBytes=running?(uint32_t)running->size:0;const uint32_t appBytes=(uint32_t)ESP.getSketchSize();
  d[\"version\"]=ANDERSON_FIRMWARE_VERSION;d[\"cpuLoad\"]=cpuLoadPct;d[\"cpuMhz\"]=(uint32_t)getCpuFrequencyMhz();d[\"uptimeMs\"]=(uint32_t)millis();
  d[\"resetReason\"]=resetReasonName();d[\"loopWatchdog\"]=loopWatchdogActive;d[\"wifiDisconnects\"]=wifiDisconnectCount.load();d[\"wifiLastReason\"]=wifiLastDisconnectReason.load();d[\"networkRestarts\"]=networkServiceRestarts;
  d[\"heapTotal\"]=(uint32_t)ESP.getHeapSize();d[\"heapFree\"]=(uint32_t)ESP.getFreeHeap();d[\"heapMin\"]=(uint32_t)ESP.getMinFreeHeap();d[\"heapLargest\"]=(uint32_t)ESP.getMaxAllocHeap();
  d[\"wifiConnected\"]=wifiConnected;d[\"rssi\"]=wifiConnected?WiFi.RSSI():0;d[\"ssid\"]=wifiConnected?WiFi.SSID():String(\"\");d[\"ip\"]=wifiConnected?WiFi.localIP().toString():WiFi.softAPIP().toString();
  d[\"bleConnected\"]=ble.connected();d[\"bleCount\"]=ble.connectedCount();d[\"appBytes\"]=appBytes;d[\"slotBytes\"]=slotBytes;d[\"appFreeBytes\"]=slotBytes>appBytes?slotBytes-appBytes:0;
  String out;serializeJson(d,out);return out;
}"""
new_system = """static uint8_t maintenanceRebootSlotForMinute(uint16_t minute){
  uint8_t slot=0;for(uint8_t i=1;i<MAINTENANCE_REBOOT_COUNT;i++){if(minute<MAINTENANCE_REBOOT_MINUTES[i])break;slot=i;}return slot;
}
static int32_t maintenanceRebootDayKey(const tm& local){return (int32_t)(local.tm_year+1900)*366+(int32_t)local.tm_yday;}
static String maintenanceRebootLabel(uint16_t minute){
  uint8_t h=(uint8_t)(minute/60U),m=(uint8_t)(minute%60U);const bool pm=h>=12;uint8_t h12=(uint8_t)(h%12U);if(!h12)h12=12;char b[12];snprintf(b,sizeof(b),\"%u:%02u %s\",h12,m,pm?\"PM\":\"AM\");return String(b);
}
static bool nextMaintenanceReboot(time_t now,time_t& nextAt,uint32_t& secondsRemaining,uint16_t& nextMinute){
  tm base{};if(!localtime_r(&now,&base))return false;
  for(uint8_t dayOffset=0;dayOffset<2;dayOffset++)for(uint8_t i=0;i<MAINTENANCE_REBOOT_COUNT;i++){
    tm candidate=base;candidate.tm_mday+=dayOffset;candidate.tm_hour=MAINTENANCE_REBOOT_MINUTES[i]/60U;candidate.tm_min=MAINTENANCE_REBOOT_MINUTES[i]%60U;candidate.tm_sec=0;candidate.tm_isdst=-1;
    time_t when=mktime(&candidate);if(when<now)continue;
    tm normalized{};if(!localtime_r(&when,&normalized))continue;int32_t key=maintenanceRebootDayKey(normalized)*MAINTENANCE_REBOOT_COUNT+i;
    if(maintenanceRebootClockInitialized&&key<=maintenanceRebootHandledSlot)continue;
    nextAt=when;secondsRemaining=when>now?(uint32_t)(when-now):0U;nextMinute=MAINTENANCE_REBOOT_MINUTES[i];return true;
  }
  return false;
}
static String systemJson(){
  JsonDocument d;const bool wifiConnected=WiFi.status()==WL_CONNECTED;const esp_partition_t* running=esp_ota_get_running_partition();const uint32_t slotBytes=running?(uint32_t)running->size:0;const uint32_t appBytes=(uint32_t)ESP.getSketchSize();
  d[\"version\"]=ANDERSON_FIRMWARE_VERSION;d[\"cpuLoad\"]=cpuLoadPct;d[\"cpuMhz\"]=(uint32_t)getCpuFrequencyMhz();d[\"uptimeMs\"]=(uint32_t)millis();
  d[\"resetReason\"]=resetReasonName();d[\"loopWatchdog\"]=loopWatchdogActive;d[\"wifiDisconnects\"]=wifiDisconnectCount.load();d[\"wifiLastReason\"]=wifiLastDisconnectReason.load();d[\"networkRestarts\"]=networkServiceRestarts;
  d[\"heapTotal\"]=(uint32_t)ESP.getHeapSize();d[\"heapFree\"]=(uint32_t)ESP.getFreeHeap();d[\"heapMin\"]=(uint32_t)ESP.getMinFreeHeap();d[\"heapLargest\"]=(uint32_t)ESP.getMaxAllocHeap();
  d[\"wifiConnected\"]=wifiConnected;d[\"rssi\"]=wifiConnected?WiFi.RSSI():0;d[\"ssid\"]=wifiConnected?WiFi.SSID():String(\"\");d[\"ip\"]=wifiConnected?WiFi.localIP().toString():WiFi.softAPIP().toString();
  d[\"bleConnected\"]=ble.connected();d[\"bleCount\"]=ble.connectedCount();d[\"appBytes\"]=appBytes;d[\"slotBytes\"]=slotBytes;d[\"appFreeBytes\"]=slotBytes>appBytes?slotBytes-appBytes:0;
  d[\"rebootSchedule\"]=\"12:00 AM • 6:00 AM • 12:00 PM • 6:00 PM\";
  if(timeValid()){time_t now=time(nullptr),nextAt=0;uint32_t remaining=0;uint16_t nextMinute=0;if(nextMaintenanceReboot(now,nextAt,remaining,nextMinute)){d[\"nextReboot\"]=maintenanceRebootLabel(nextMinute);d[\"nextRebootEpoch\"]=(int64_t)nextAt;d[\"nextRebootSeconds\"]=remaining;}}
  else d[\"nextReboot\"]=\"Waiting for time sync\";
  String out;serializeJson(d,out);return out;
}"""
replace_once("firmware/src/main.cpp", old_system, new_system)

replace_once(
    "firmware/src/main.cpp",
    """static bool dailyScheduledRebootDue(int32_t dayKey,uint16_t minute){
  if(!dailyRebootClockInitialized){
    dailyRebootClockInitialized=true;
    dailyRebootHandledDay=minute>=DAILY_REBOOT_MINUTE?dayKey:dayKey-1;
    return false;
  }
  if(minute<DAILY_REBOOT_MINUTE||dailyRebootHandledDay==dayKey)return false;
  dailyRebootHandledDay=dayKey;
  return true;
}
static void checkDailyScheduledReboot(){
  if(Update.isRunning()||otaAutoRebootPending||!timeValid())return;
  time_t now=time(nullptr);tm local{};if(!localtime_r(&now,&local))return;
  int32_t dayKey=(int32_t)(local.tm_year+1900)*366+(int32_t)local.tm_yday;
  uint16_t minute=(uint16_t)(local.tm_hour*60+local.tm_min);
  if(!dailyScheduledRebootDue(dayKey,minute))return;
  delay(40);ESP.restart();
}""",
    """static bool scheduledMaintenanceRebootDue(int32_t dayKey,uint16_t minute){
  const int32_t slotKey=dayKey*MAINTENANCE_REBOOT_COUNT+maintenanceRebootSlotForMinute(minute);
  if(!maintenanceRebootClockInitialized){maintenanceRebootClockInitialized=true;maintenanceRebootHandledSlot=slotKey;return false;}
  if(slotKey<=maintenanceRebootHandledSlot)return false;
  maintenanceRebootHandledSlot=slotKey;return true;
}
static void checkScheduledMaintenanceReboot(){
  if(Update.isRunning()||otaAutoRebootPending||!timeValid())return;
  time_t now=time(nullptr);tm local{};if(!localtime_r(&now,&local))return;
  int32_t dayKey=maintenanceRebootDayKey(local);uint16_t minute=(uint16_t)(local.tm_hour*60+local.tm_min);
  if(!scheduledMaintenanceRebootDue(dayKey,minute))return;
  delay(40);ESP.restart();
}""",
)
replace_once(
    "firmware/src/main.cpp",
    "maintainWiFiConnection();checkDailyScheduledReboot();",
    "maintainWiFiConnection();checkScheduledMaintenanceReboot();",
)

replace_once(
    "firmware/web/index.html",
    ".sysToolbar{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:10px}",
    ".sysToolbar{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}",
)
metric = '        <div class="sysMetric"><span class="sysLabel">Auto Update</span><strong id="sysUpdate">—</strong><span id="sysUpdateSub" class="sysSub">next check</span></div>'
replace_once(
    "firmware/web/index.html",
    metric,
    metric + '\n        <div class="sysMetric"><span class="sysLabel">Next Reboot</span><strong id="sysReboot">—</strong><span id="sysRebootSub" class="sysSub">time remaining</span></div>',
)
replace_once(
    "firmware/web/index.html",
    "let sysUpdateDeadline=0,systemMonitorBusy=false;",
    "let sysUpdateDeadline=0,sysRebootDeadline=0,systemMonitorBusy=false;",
)
update_countdown = "function renderSysUpdateCountdown(){const el=$('sysUpdate');if(!el)return;if(!sysUpdateDeadline){el.textContent='—';return;}el.textContent=sysCountdown(Math.max(0,(sysUpdateDeadline-Date.now())/1000))}"
replace_once(
    "firmware/web/index.html",
    update_countdown,
    update_countdown + "\nfunction renderSysRebootCountdown(){const el=$('sysRebootSub');if(!el)return;if(!sysRebootDeadline){el.textContent='waiting for time sync';return;}el.textContent='in '+sysCountdown(Math.max(0,(sysRebootDeadline-Date.now())/1000))}",
)
replace_once(
    "firmware/web/index.html",
    "renderSysUpdateCountdown();$('sysUpdateSub').textContent='every '+((Number(u.autoCheckMinutes)||60)/60)+'h';$('sysDetails').innerHTML=",
    "renderSysUpdateCountdown();$('sysUpdateSub').textContent='every '+((Number(u.autoCheckMinutes)||60)/60)+'h';$('sysReboot').textContent=d.nextReboot||'—';sysRebootDeadline=Number(d.nextRebootSeconds)>=0&&d.nextReboot?Date.now()+Number(d.nextRebootSeconds)*1000:0;renderSysRebootCountdown();$('sysDetails').innerHTML=",
)
replace_once(
    "firmware/web/index.html",
    "• <strong>Wi-Fi recoveries:</strong> ${d.networkRestarts||0}`",
    "• <strong>Wi-Fi recoveries:</strong> ${d.networkRestarts||0}<br><strong>Reboot schedule:</strong> ${d.rebootSchedule||'12:00 AM • 6:00 AM • 12:00 PM • 6:00 PM'}`",
)
replace_once(
    "firmware/web/index.html",
    "setInterval(renderSysUpdateCountdown,1000);",
    "setInterval(()=>{renderSysUpdateCountdown();renderSysRebootCountdown()},1000);",
)

p = Path("tools/test_maintenance.py")
text = p.read_text()
start = text.index("# Validate the production daily-reboot wiring and state-machine semantics.")
end = text.index("# Test the actual automatic-update loop and monitor countdown with simulated time.")
replacement = '''# Validate the production four-times-daily maintenance reboot wiring and semantics.\nmain_loop=source[source.index('void loop(){'):]\nassert 'MAINTENANCE_REBOOT_MINUTES[]={0U,6U*60U,12U*60U,18U*60U}' in source\nmaintenance_check=source[source.index('static void checkScheduledMaintenanceReboot(){'):source.index('void setup(){')]\nassert 'if(Update.isRunning()||otaAutoRebootPending||!timeValid())return;' in maintenance_check\nassert 'checkScheduledMaintenanceReboot();' in main_loop\nassert 'nextRebootSeconds' in source and 'rebootSchedule' in source\n\ndef reboot_slot(minute):\n    return 3 if minute>=1080 else 2 if minute>=720 else 1 if minute>=360 else 0\n\ndef scheduled_due(state, day, minute):\n    initialized, handled=state\n    key=day*4+reboot_slot(minute)\n    if not initialized:\n        return (True,key),False\n    if key<=handled:\n        return state,False\n    return (True,key),True\n\nstate=(False,-1)\nstate,due=scheduled_due(state,1000,359);assert not due\nstate,due=scheduled_due(state,1000,360);assert due\nstate,due=scheduled_due(state,1000,719);assert not due\nstate,due=scheduled_due(state,1000,720);assert due\nstate,due=scheduled_due(state,1000,1080);assert due\nstate,due=scheduled_due(state,1001,0);assert due\nstate,due=scheduled_due(state,1001,359);assert not due\nstate,due=scheduled_due(state,1001,360);assert due\nstate=(False,-1)\nstate,due=scheduled_due(state,2000,800);assert not due and state==(True,2000*4+2)\nstate,due=scheduled_due(state,2000,1079);assert not due\nstate,due=scheduled_due(state,2000,1080);assert due\nprint('PASS: 00:00/06:00/12:00/18:00 local reboot state machine, no post-boot refire, and monitor telemetry wiring')\n\n'''
p.write_text(text[:start] + replacement + text[end:])

replace_once(
    "AGENTS.md",
    "- Do not use an unconditional uptime-based maintenance reboot. Reboot once daily at **15:00 local controller time** when the clock is valid. The daily schedule must fire at most once per local calendar day, initialize after boot without immediately re-firing when startup occurs after 15:00, and defer while firmware update/reboot activity is active. While saved Wi-Fi credentials exist and the controller is disconnected, retry the saved network every 30 seconds; if it remains continuously offline for 10 minutes despite retries, reboot as a last-resort recovery. Reset the offline watchdog immediately after reconnection.",
    "- Do not use an unconditional uptime-based maintenance reboot. Reboot at **00:00, 06:00, 12:00, and 18:00 local controller time** when the clock is valid. Each scheduled slot must fire at most once, initialize after boot/time-sync without immediately re-firing an already-passed slot, and defer while firmware update/reboot activity is active. System Monitor must show the next scheduled maintenance reboot and a live countdown. While saved Wi-Fi credentials exist and the controller is disconnected, retry the saved network every 30 seconds; if it remains continuously offline for 10 minutes despite retries, reboot as a last-resort recovery. Reset the offline watchdog immediately after reconnection.",
)

print("Applied Anderson Home v3.0.15 maintenance reboot + System Monitor changes")
