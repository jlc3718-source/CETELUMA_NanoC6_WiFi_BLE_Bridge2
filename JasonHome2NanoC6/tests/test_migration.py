import importlib.util,json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('converter',Path(__file__).resolve().parents[1]/'tools/convert_backup.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Migration(unittest.TestCase):
    def test_factory_raw_cache_is_not_duplicated_in_import(self):
        catalog=json.loads((ROOT/'JasonHome2Server/catalog.json').read_text())
        preset={'lightId':10001,'name':'Test','layers':[{'colors':'5B00E6','layer_speed':17}],'raw':{'light_effect':[{'params':'large duplicate data'}]}}
        source={'oracle':{'calendar':{'settings':{'mode':2},'events':[catalog['events'][0]]},'referencedFactoryPresets':[preset]}}
        result=mod.convert(source,catalog);clean=result['state']['referencedFactoryPresets'][0]
        self.assertNotIn('raw',clean);self.assertEqual(clean['layers'],preset['layers']);self.assertIn('raw',preset)

    def test_preserves_all_edits_and_schedule_families(self):
        catalog=json.loads((ROOT/'JasonHome2Server/catalog.json').read_text())
        events=[]
        for original in catalog['events']:
            e={k:v for k,v in original.items() if k!='profiles'};p=original['profiles'];e.update(colors=p['expanded'],effect=mod.ALIASES.get(p['expandedEffect'],p['expandedEffect']),speed=[1,3,5,8,10][p['expandedSpeed']-1],enabled=True,favorite=False);events.append(e)
        events[0].update(colors=[0x5b00e6,0xff0000],favorite=True,scheduleOverride={'mode':'range','annual':False,'year':2026,'startMonth':10,'startDay':15,'endMonth':10,'endDay':18,'customTime':True,'start':1100,'end':1400})
        events.append({'id':'ai-once-test','name':'AI test','rule':'Fixed','month':10,'day':15,'creativePhases':[{'effect':'Flow2','speed':2,'minutes':7}],'aiOneTime':True})
        weekly=[{'id':'weekly-test','target':'All','days':'Mon,Wed','start_kind':'clock','start_value':'17:00','end_kind':'clock','end_value':'23:00'}]
        b={'schema':2,'oracle':{'calendar':{'settings':{'mode':2,'enabled':True},'events':events,'customSchedules':[{'id':'schedule-one','annual':True,'month':10,'day':31}]},'schedules':weekly,'factoryEdits':{'10001':{'layers':[{'colors':'5b00e6'}]}},'factoryPromotions':{'10001':{'enabled':False}},'factoryPromotionMap':{'10001':{'eventId':'evt179'}},'referencedFactoryPresets':[{'lightId':10001,'name':'Test'}],'privateCredential':'MUST_NOT_LEAK'},'web2':{'presets':[{'id':'preset-one'}],'target':3}}
        result=mod.convert({'backup':b},catalog);s=result['state'];self.assertFalse(s['activated']);self.assertFalse(s['autoUpdate']);self.assertEqual(s['weeklySchedules'],weekly);self.assertEqual(s['customSchedules'],b['oracle']['calendar']['customSchedules']);self.assertEqual(s['extraEvents'],[events[-1]]);self.assertEqual(s['factoryEdits'],b['oracle']['factoryEdits']);self.assertEqual(s['target'],3)
        for e,base in zip(events,catalog['events']):
            expected={k:v for k,v in base.items() if k!='profiles'};p=base['profiles'];expected.update(colors=p['expanded'],effect=mod.ALIASES.get(p['expandedEffect'],p['expandedEffect']),speed=[1,3,5,8,10][p['expandedSpeed']-1],enabled=True,favorite=False);expected.update(s['overrides'].get(e['id'],{}));self.assertEqual(expected,e)
        self.assertNotIn('MUST_NOT_LEAK',json.dumps(result))
    def test_rejects_partial_and_accepts_native_export(self):
        with self.assertRaises(ValueError):mod.convert({'schema':2,'web2':{}},{'events':[]})
        native={'product':'jason-home-2-nanoc6','schema':1,'state':{'settings':{}}};self.assertEqual(mod.convert(native,{}),native)
if __name__=='__main__':unittest.main()
