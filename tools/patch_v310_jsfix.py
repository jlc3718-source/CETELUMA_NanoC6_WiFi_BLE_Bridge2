from pathlib import Path
import re
p=Path('firmware/web/index.html'); s=p.read_text()
s=re.sub(r"^\$\('eventsMaster'\)\.addEventListener\('change'.*$", "$('eventsMaster').addEventListener('change',()=>post('/api/settings',{scheduler:$('eventsMaster').checked}).then(applyState).catch(e=>status('Schedule 1 change failed: '+e.message)));", s, flags=re.M)
s=re.sub(r"^\$\('schedule2Master'\)\.addEventListener\('change'.*$", "$('schedule2Master').addEventListener('change',()=>post('/api/settings',{scheduler2:$('schedule2Master').checked}).then(applyState).catch(e=>status('Schedule 2 change failed: '+e.message)));", s, flags=re.M)
# Remove any remnants from deleted duplicate Schedules-tab toggles.
s='\n'.join(line for line in s.splitlines() if 'eventsSchedule1Toggle' not in line and 'eventsSchedule2Toggle' not in line)+'\n'
p.write_text(s)
print('v3.1.0 schedule handler JS cleanup applied')
