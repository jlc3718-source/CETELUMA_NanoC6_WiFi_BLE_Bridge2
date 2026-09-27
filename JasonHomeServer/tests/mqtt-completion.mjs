import assert from "node:assert/strict";
import { mqttCompletionStatus } from "../dist/eufy/mqtt.js";

let s=mqttCompletionStatus([2,3],[2,3],false,undefined);
assert.equal(s.complete,true);
assert.equal(s.brokerAccepted,true);
assert.equal(s.deviceReported,false);
assert.deepEqual(s.missing,[]);

s=mqttCompletionStatus([2,3],[2],false,undefined);
assert.equal(s.complete,false);
assert.equal(s.brokerAccepted,false);
assert.deepEqual(s.missing,[3]);

s=mqttCompletionStatus([2],[2],true,undefined);
assert.equal(s.complete,false);
assert.equal(s.brokerAccepted,true);
assert.equal(s.deviceReported,false);

s=mqttCompletionStatus([2],[2],true,{cmd:0x0204});
assert.equal(s.complete,true);
assert.equal(s.brokerAccepted,true);
assert.equal(s.deviceReported,true);

console.log("MQTT completion regression: PASS");
