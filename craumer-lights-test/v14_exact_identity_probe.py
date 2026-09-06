from pathlib import Path

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')
p = root / 'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s = p.read_text()

# Exact identities captured from Eufy Life About Device pages.
needle_block = '''                        val rawResponse = response.toString()
                        val exactIdentities = listOf(
                            arrayOf("Front House", "T8L00", "T8L00610243503A2", "102CB1ADC30C", "102CB1ADCA7F", "192.168.68.81"),
                            arrayOf("Garage", "T8L02", "T8L028102427474A", "102CB19DF5F8", "102CB19DF7B5", "192.168.68.108"),
                            arrayOf("Pool Side", "T8L00", "T8L006102353014B", "102CB10ECB76", "102CB10EC401", "192.168.68.64"),
                            arrayOf("Shed", "T8L02", "T8L0291024470193", "102CB1EE6D9A", "102CB1EB2796", "192.168.68.59")
                        )
                        for (identity in exactIdentities) {
                            val hits = mutableListOf<String>()
                            if (rawResponse.contains(identity[2], true)) hits += "serial"
                            if (rawResponse.replace(":", "").replace("-", "").contains(identity[3], true)) hits += "wifi-mac"
                            if (rawResponse.replace(":", "").replace("-", "").contains(identity[4], true)) hits += "ble-mac"
                            if (rawResponse.contains(identity[5], true)) hits += "ip"
                            if (hits.isNotEmpty()) {
                                if (rawResponse.contains(identity[1], true)) hits += "model"
                                notes += "${identity[0]} exact identity hit @ ${cleanBase.removePrefix("https://").substringBefore('/')} $path: ${hits.distinct().joinToString(",")}"
                            }
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
insert2 = '''            notes += "Known exact light identities:"
            notes += "Front House T8L00 SN T8L00610243503A2 FW v1.0.99 IP 192.168.68.81 Wi-Fi 10:2C:B1:AD:C3:0C BLE 10:2C:B1:AD:CA:7F"
            notes += "Garage T8L02 SN T8L028102427474A FW v2.0.4.0 IP 192.168.68.108 Wi-Fi 10:2C:B1:9D:F5:F8 BLE 10:2C:B1:9D:F7:B5"
            notes += "Pool Side T8L00 SN T8L006102353014B FW v1.0.99 IP 192.168.68.64 Wi-Fi 10:2C:B1:0E:CB:76 BLE 10:2C:B1:0E:C4:01"
            notes += "Shed T8L02 SN T8L0291024470193 FW v2.0.4.0 IP 192.168.68.59 Wi-Fi 10:2C:B1:EE:6D:9A BLE 10:2C:B1:EB:27:96"
            notes += "Eufy-side device-like records inspected: $eufyRecordCount"
'''
if anchor2 not in s:
    raise SystemExit('v14 summary anchor missing')
s = s.replace(anchor2, insert2, 1)

p.write_text(s)
print('Applied v14 exact identity cloud probe for all four Craumer lights')
