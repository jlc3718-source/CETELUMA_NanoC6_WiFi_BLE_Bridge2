from pathlib import Path

root=Path('build_source/Craumer_Lights_Eufy_Test_v2')
p=root/'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s=p.read_text()

# v16 is cloud-only. No BLE code or permissions are added.
# It probes read-only Eufy cloud inventory routes using the existing authenticated helper.
anchor='''            notes += "Eufy-side device-like records inspected: $eufyRecordCount"\n'''
insert='''            notes += "Eufy-side device-like records inspected: $eufyRecordCount"
            try {
                notes += "Craumer encrypted-cloud inventory probe:"
                val cloudPaths = listOf(
                    "v1/house/list",
                    "v2/house/device_list",
                    "v2/house/station_list"
                )
                val cloudHosts = listOf("https://extend.eufylife.com/")
                for (host in cloudHosts) {
                    for (path in cloudPaths) {
                        try {
                            val r = eufyGet(host, path)
                            val body = r.second
                            val needles = listOf(
                                "T8L00610243503A2", "T8L028102427474A", "T8L006102353014B", "T8L0291024470193",
                                "102CB1ADC30C", "102CB19DF5F8", "102CB10ECB76", "102CB1EE6D9A",
                                "T8L00", "T8L02"
                            )
                            val hits = needles.filter { body.contains(it, true) }
                            notes += "Cloud GET $host$path HTTP ${r.first}; identity hits=${if (hits.isEmpty()) "none" else hits.joinToString(",")}"
                        } catch (e: Exception) {
                            notes += "Cloud GET $host$path failed: ${e.message}"
                        }
                    }
                }
            } catch (e: Exception) {
                notes += "Encrypted-cloud inventory probe failed: ${e.message}"
            }
'''
if anchor not in s:
    raise SystemExit('v16 summary anchor missing')
s=s.replace(anchor,insert,1)
p.write_text(s)
print('Applied v16 Eufy cloud inventory probe (read-only, no BLE)')
