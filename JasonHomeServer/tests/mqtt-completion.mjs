import assert from "node:assert/strict";
import { mqttCompletionStatus, captureFrame } from "../dist/eufy/mqtt.js";

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
assert.equal(s.complete,false);
assert.equal(s.brokerAccepted,true);
assert.equal(s.deviceReported,true);
s=mqttCompletionStatus([2],[2],true,{cmd:0x0a00});
assert.equal(s.complete,true);

console.log("MQTT completion regression: PASS");

// Command requests carry a raw base64 DP frame; device replies wrap hex in JSON.
const command=Buffer.from([255,9,10,0,3,0,2,2,6,241]);
assert.deepEqual(captureFrame(command.toString("base64")),command);
assert.deepEqual(captureFrame(Buffer.from(JSON.stringify({data:command.toString("hex")})).toString("base64")),command);
console.log("Live capture decodes both raw command and JSON-wrapped report frames PASS");
