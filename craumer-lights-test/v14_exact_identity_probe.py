from pathlib import Path

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')
p = root / 'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s = p.read_text()

# Use the exact identity shown by the Eufy Life About Device page for Pool Side Lights.
needle_block = '''                        val rawResponse = response.toString()
                        val identityHits = mutableListOf<String>()
                        if (rawResponse.contains("T8L006102353014B", true)) identityHits += "serial"
                        if (rawResponse.contains("102CB10ECB76", true) || rawResponse.contains("10:2C:B1:0E:CB:76", true)) identityHits += "wifi-mac"
                        if (rawResponse.contains("102CB10EC401", true) || rawResponse.contains("10:2C:B1:0E:C4:01", true)) identityHits += "ble-mac"
                        if (rawResponse.contains("192.168.68.64", true)) identityHits += "ip"
                        if (rawResponse.contains("T8L00", true)) identityHits += "model"
                        if (identityHits.isNotEmpty()) {
                            notes += "Pool Side exact identity hit @ ${cleanBase.removePrefix("https://").substringBefore('/')} $path: ${identityHits.distinct().joinToString(",")}"
                        }
'''

anchor = '''                        val objects = mutableListOf<JSONObject>()
                        collectObjects(response, objects)
'''
if anchor not in s:
    raise SystemExit('v14 route-response anchor missing')
s = s.replace(anchor, needle_block + anchor, 1)

anchor2 = '''            notes += "Eufy-side device-like records inspected: $eufyRecordCount"
'''
insert2 = '''            notes += "Pool Side known identity: T8L00 / FW v1.0.99 / 192.168.68.64 / Wi-Fi 10:2C:B1:0E:CB:76 / BLE 10:2C:B1:0E:C4:01"
            notes += "Eufy-side device-like records inspected: $eufyRecordCount"
'''
if anchor2 not in s:
    raise SystemExit('v14 summary anchor missing')
s = s.replace(anchor2, insert2, 1)

p.write_text(s)
print('Applied v14 exact Pool Side identity cloud probe')
