#!/usr/bin/env python3
"""Convert a current Jason Home 2 portable settings backup for NanoC6."""
from pathlib import Path
import argparse,json,copy
ROOT=Path(__file__).resolve().parents[2]
ALIASES={'Solid':'Static','Solid / Static':'Static','Jump':'Cycle','Breath':'Breathe','Strobe':'Twinkle','Chase':'Flow1','Gradient Sweep':'Flow1','Candy Cane':'Flow1','Twinkle / Sparkle':'Twinkle','Wipe / Fill':'Streamlight','Meteor / Comet':'Streamlight','Rainbow Flow':'Flow1','Pulse Wave':'Breathe'}
def convert(data,catalog):
    backup=data.get('backup',data)
    if backup.get('product')=='jason-home-2-nanoc6':return backup
    oracle=backup.get('oracle',backup)
    cfg=oracle.get('calendar')
    if not isinstance(cfg,dict) or not cfg.get('events'):raise ValueError('This is not a complete Jason Home 2 portable backup with an Oracle calendar.')
    web=backup.get('web2',{})
    mode=int(cfg.get('settings',{}).get('mode',2))
    mode=max(0,min(2,mode));speeds=[1,3,5,8,10]
    originals={e['id']:e for e in catalog['events']};overrides={};extra=[]
    for event in cfg['events']:
        original=originals.get(event['id'])
        if not original:
            event=copy.deepcopy(event)
            if event.get('rule') in ('YearTable','Hanukkah'):
                special=[d for d in cfg.get('special',[]) if d.get('id')==event.get('dateRuleSourceId',event['id'])]
                if len(special)==1:
                    date=special[0];event.update(rule='Fixed',month=date['month'],day=date['day'],scheduleOverride={'mode':'date','annual':False,'year':date['year'],'startMonth':date['month'],'startDay':date['day']})
            extra.append(event);continue
        base={k:v for k,v in original.items() if k!='profiles'}
        profile=original['profiles']
        base['colors']=profile[['major','basic','expanded'][mode]]
        base['effect']=ALIASES.get(profile['expandedEffect'] if mode==2 else original['effect'],profile['expandedEffect'] if mode==2 else original['effect'])
        old=profile['expandedSpeed'] if mode==2 else original['speed'];base['speed']=speeds[max(0,min(4,int(old)-1))]
        base['enabled']=True;base['favorite']=False
        edit={k:v for k,v in event.items() if k not in ('profiles',) and base.get(k)!=v}
        if edit:overrides[event['id']]=edit
    state={'settings':cfg['settings'],'overrides':overrides,'extraEvents':extra,
           'customSchedules':cfg.get('customSchedules',[]),'weeklySchedules':oracle.get('schedules',[]),
           'presets':web.get('presets',[]),'palette':web.get('palette',{}),'target':web.get('target',0),
           'factoryEdits':oracle.get('factoryEdits',{}),'factoryPromotions':oracle.get('factoryPromotions',{}),
           'factoryPromotionMap':oracle.get('factoryPromotionMap',{}),'referencedFactoryPresets':[{k:v for k,v in p.items() if k!='raw'} for p in oracle.get('referencedFactoryPresets',[])],
           'activated':False,'autoUpdate':False,'oraclePaused':False,'sourceRevision':cfg.get('revision',0)}
    return {'schema':1,'product':'jason-home-2-nanoc6','state':state}
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('backup');p.add_argument('--output',default='Jason-Home-2-NanoC6-migration.json');p.add_argument('--catalog',default=str(Path(__file__).with_name('catalog.json') if Path(__file__).with_name('catalog.json').exists() else ROOT/'JasonHome2Server/catalog.json'));a=p.parse_args()
    result=convert(json.loads(Path(a.backup).read_text()),json.loads(Path(a.catalog).read_text()))
    output=json.dumps(result,separators=(',',':')).encode()
    if len(output)>60000:raise SystemExit('Converted settings exceed the current 60 KB import limit. Nothing was truncated. Keep Oracle active and review the large recipes before migrating.')
    Path(a.output).write_bytes(output)
    s=result['state'];print('Saved',a.output,len(output),'bytes;',len(s.get('overrides',{})),'event overrides;',len(s.get('extraEvents',[])),'extra events;',len(s.get('customSchedules',[])),'custom schedules. Credentials are excluded. Controller remains paused.')
if __name__=='__main__':main()
