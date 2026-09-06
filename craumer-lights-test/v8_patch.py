from pathlib import Path

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')
gradle = root / 'android/app/build.gradle.kts'
s = gradle.read_text().replace('versionCode = 7','versionCode = 8').replace('versionName = "0.7-test"','versionName = "0.8-test"')
gradle.write_text(s)
for rel in ['web/index.html','android/app/src/main/assets/index.html']:
    p=root/rel; p.write_text(p.read_text().replace('TEST v7','TEST v8'))

p=root/'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s=p.read_text()
anchor='''            notes += "Eufy-side device-like records inspected: $eufyRecordCount"
'''
insert='''            notes += "Eufy-side device-like records inspected: $eufyRecordCount"

            // v8: the legacy Home API only exposes the six records seen in v7.
            // Probe the newer unified/Mega backend read-only to locate Lights-family inventory.
            val megaBases = listOf(
                "https://extend.eufylife.com/",
                "https://security-smart.eufylife.com/"
            )
            val megaPaths = listOf(
                "v1/passport/estimate_domain",
                "v1/house/list",
                "v1/home/list",
                "v1/device/list",
                "v1/device/all",
                "v1/smart/device/list"
            )
            val megaHeaders = headers.toMutableMap()
            megaHeaders["x-auth-token"] = token
            megaHeaders["app-name"] = "eufy_mega"
            megaHeaders["model-type"] = "android"
            megaHeaders["web-country"] = "US"
            for (base in megaBases) for (path in megaPaths) {
                try {
                    val response = httpJson("GET", base + path, null, megaHeaders)
                    val objects = mutableListOf<JSONObject>()
                    collectObjects(response, objects)
                    var candidates = 0
                    for (obj in objects) {
                        val model = firstNonBlank(obj.optString("product_code"), obj.optString("productCode"), obj.optString("model"), obj.optString("device_model"), obj.optString("deviceModel"))
                        val id = firstNonBlank(obj.optString("id"), obj.optString("device_id"), obj.optString("deviceId"), obj.optString("device_sn"), obj.optString("deviceSn"))
                        val name = firstNonBlank(obj.optString("alias_name"), obj.optString("name"), obj.optString("device_name"), obj.optString("deviceName"))
                        if (model.startsWith("T8L", true) || name.contains("light", true) || obj.toString().contains("T8L00", true) || obj.toString().contains("T8L02", true)) {
                            candidates++
                            val key = "mega:${if (id.isBlank()) model+name else id}"
                            var duplicate=false
                            for (k in 0 until discovered.length()) { val d=discovered.optJSONObject(k)?:continue; if(d.optString("_key")==key || (id.isNotBlank() && d.optString("id")==id)){duplicate=true;break} }
                            if(!duplicate) discovered.put(JSONObject().put("_key",key).put("source","Eufy Mega $path").put("name",if(name.isBlank()) "Eufy light candidate" else name).put("id",id).put("productId",model).put("category",firstNonBlank(obj.optString("category"),obj.optString("type"))).put("hasLocalKey",obj.optString("local_code").isNotBlank()))
                        }
                    }
                    notes += "Mega GET ${base.removePrefix("https://").substringBefore('/')} $path: OK (${objects.size} objects, $candidates light candidates)"
                } catch(e:Exception) {
                    notes += "Mega GET ${base.removePrefix("https://").substringBefore('/')} $path: ${(e.message?:"error").replace("\\n"," ").take(90)}"
                }
            }
'''
if anchor not in s: raise SystemExit('v8 anchor not found')
s=s.replace(anchor,insert,1)
p.write_text(s)
print('Applied Craumer Lights v8 patch')
