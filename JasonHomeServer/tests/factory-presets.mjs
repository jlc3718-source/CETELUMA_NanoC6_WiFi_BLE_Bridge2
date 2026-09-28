import assert from "node:assert/strict";
import { allowedApi } from "../dist/eufy/client.js";
import { collectFactoryEffectIds, normalizeFactoryEntry, buildFactoryFields, dedupeFactoryPresetsByName, reverseFactoryPresetDirection } from "../dist/eufy/factory-presets.js";

assert.equal(allowedApi("app-light-us-pr.eufy.com"),true);
assert.equal(allowedApi("app-light-eu-pr.eufy.com"),true);
assert.equal(allowedApi("app-evil-us-pr.eufy.com"),false);
assert.equal(allowedApi("light.eufy.com.attacker.example"),false);

const ids=collectFactoryEffectIds({a:{scene_id:10474},b:[{x:{light_id:10034}},{scene_id:10555}],ignored:"x"});
assert.deepEqual([...ids].sort((a,b)=>a-b),[10034,10474,10555]);

const raw={
  light_id:10474,
  name:"Presidents Day",
  light_effect:[{
    rgb_hex:"FF0000|FFFFFF|0000FF",
    brightness:90,
    params:JSON.stringify({
      light_effect_speed:5,
      layer_execution_mode:1,
      layer:[{
        current_layer_type:1,
        colors:"FF0000|FFFFFF|0000FF",
        layer_priority:0,
        layer_speed:5,
        layer_range:[0,10],
        interval_type:0,
        interval_value:1,
        layer_execution_parameter:0,
        light_effect_post_cycle_status:0,
        brightness_value:100,
        display_mode:1,
        color_quantity_range:3,
        transition_mode:0,
        unit_transition_duration:1,
        color_switch_mode:1,
        switch_count:3,
        color_pick_sequence:1,
        execution_parameter:0
      }]
    })
  }]
};
const p=normalizeFactoryEntry(raw);
assert.equal(p.lightId,10474);
assert.equal(p.name,"Presidents Day");
assert.equal(p.brightness,90);
assert.equal(p.layers.length,1);
assert.equal(p.buildableE22,true);
assert.equal(p.buildableE120Experimental,true);
const p2={...p,lightId:10475};
const p3={...p,lightId:10476,name:"Different Scene"};
const deduped=dedupeFactoryPresetsByName([p2,p3,p]);
assert.equal(deduped.length,2);
assert.equal(deduped.find(x=>x.name==="Presidents Day")?.lightId,10474);
const spaced=dedupeFactoryPresetsByName([
  {...p,lightId:11001,name:"Party Night"},
  {...p,lightId:11002,name:"Party  Night"},
  {...p,lightId:11003,name:"Party\tNight"}
]);
assert.equal(spaced.length,1);
assert.equal(spaced[0].lightId,11001);

const e22=buildFactoryFields("T8L02",p),e120=buildFactoryFields("T8L00",p);
assert.ok(e22.length>0);
assert.ok(e120.length>0);
assert.notDeepEqual([...e22],[...e120]);

const directional={
  ...p,
  layers:[
    {...p.layers[0],current_layer_type:0,flow_direction:0,colors:"FF0000|00FF00"},
    {...p.layers[0],current_layer_type:1,flow_direction:0}
  ]
};
const reversed=reverseFactoryPresetDirection(directional);
assert.equal(reversed.layers[0].flow_direction,1);
assert.equal(reversed.layers[1].flow_direction,0);
assert.equal(directional.layers[0].flow_direction,0);
assert.ok(buildFactoryFields("T8L02",reversed).length>0);
assert.ok(buildFactoryFields("T8L00",reversed).length>0);

const malformed=normalizeFactoryEntry({light_id:10099,name:"Bad",params:"{not-json"});
assert.equal(malformed.layers.length,0);
assert.equal(malformed.buildableE22,false);

console.log("Factory preset regression: PASS");
