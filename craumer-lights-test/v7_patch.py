from pathlib import Path

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')

# Bump visible/build version without changing the Android package, so v7 installs over v6.
gradle = root / 'android/app/build.gradle.kts'
s = gradle.read_text()
s = s.replace('versionCode = 6', 'versionCode = 7')
s = s.replace('versionName = "0.6-test"', 'versionName = "0.7-test"')
gradle.write_text(s)

for rel in ['web/index.html', 'android/app/src/main/assets/index.html']:
    p = root / rel
    s = p.read_text().replace('TEST v6', 'TEST v7')
    p.write_text(s)

p = root / 'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s = p.read_text()

old = '''            notes += "Eufy authentication: $authMethod"
            notes += "Eufy UID available: yes"
            notes += "Starting Tuya-backed Eufy device discovery…"
'''
new = '''            notes += "Eufy authentication: $authMethod"
            notes += "Eufy UID available: yes"
            notes += "Eufy request host: $regionalBase"
            listOf("region", "region_code", "country", "country_code", "tuya_region_code", "home_setting", "tuya_home", "tuya_home_id").forEach { key ->
                val value = findStringRecursive(authResponse, key)
                if (!value.isNullOrBlank()) notes += "Login $key: ${value.take(120)}"
            }
            notes += "Starting Tuya-backed Eufy device discovery…"
'''
if old not in s:
    raise SystemExit('v7 patch anchor 1 not found')
s = s.replace(old, new, 1)

old = '''            // Also report anything visible through Eufy's own device endpoint as a
            // cross-check.  Do not require a T8L00/T8L02 model string here.
            try {
                val headers = eufyHeaders().toMutableMap()
                headers["token"] = token
                val response = httpJson("GET", regionalBase + "device/v2", null, headers)
                val candidates = mutableListOf<JSONObject>()
                collectObjects(response, candidates)
                var eufyCount = 0
                for (obj in candidates) {
                    val id = firstNonBlank(
                        obj.optString("id"),
                        obj.optString("device_id"),
                        obj.optString("deviceId")
                    )
                    val name = firstNonBlank(
                        obj.optString("alias_name"),
                        obj.optString("name"),
                        obj.optString("device_name")
                    )
                    val model = firstNonBlank(
                        obj.optString("product_code"),
                        obj.optString("productCode"),
                        obj.optString("model")
                    )
                    if (id.isBlank() && name.isBlank() && model.isBlank()) continue
                    if (obj.has("local_code") || obj.has("wifi") || model.startsWith("T8")) {
                        eufyCount++
                    }
                }
                notes += "Eufy device-like records: $eufyCount"
            } catch (e: Exception) {
                notes += "Eufy cross-check failed: ${e.message}"
            }
'''
new = '''            // v7: inspect the authenticated Eufy-side namespace directly.
            // This is read-only discovery; no device commands are sent.
            val headers = eufyHeaders().toMutableMap()
            headers["token"] = token
            headers["uid"] = uid

            val routeBases = linkedSetOf(
                regionalBase,
                "https://home-api.eufylife.com/v1/",
                "https://api.eufylife.com/v1/"
            )
            val routePaths = listOf(
                "user/setting",
                "user/info",
                "device/v2",
                "device/",
                "device/list/devices-and-groups"
            )

            var eufyRecordCount = 0
            for (base in routeBases) {
                val cleanBase = if (base.endsWith("/")) base else "$base/"
                for (path in routePaths) {
                    try {
                        val response = httpJson("GET", cleanBase + path, null, headers)
                        val objects = mutableListOf<JSONObject>()
                        collectObjects(response, objects)
                        var routeRecords = 0
                        for (obj in objects) {
                            val model = firstNonBlank(
                                obj.optString("product_code"),
                                obj.optString("productCode"),
                                obj.optString("model"),
                                obj.optString("device_model"),
                                obj.optString("deviceModel")
                            )
                            val id = firstNonBlank(obj.optString("id"), obj.optString("device_id"), obj.optString("deviceId"))
                            val name = firstNonBlank(obj.optString("alias_name"), obj.optString("name"), obj.optString("device_name"))
                            if (model.isNotBlank() || id.isNotBlank() || name.isNotBlank()) routeRecords++

                            if (model.startsWith("T8L", true) || name.contains("light", true)) {
                                val key = if (id.isNotBlank()) "eufy:$id" else "eufy:$model:$name"
                                var duplicate = false
                                for (k in 0 until discovered.length()) {
                                    val d = discovered.optJSONObject(k) ?: continue
                                    if (d.optString("_key") == key || (id.isNotBlank() && d.optString("id") == id)) { duplicate = true; break }
                                }
                                if (!duplicate) {
                                    discovered.put(JSONObject()
                                        .put("_key", key)
                                        .put("source", "Eufy ${cleanBase.removePrefix("https://").substringBefore('/')} $path")
                                        .put("name", if (name.isBlank()) "Eufy light candidate" else name)
                                        .put("id", id)
                                        .put("productId", model)
                                        .put("category", firstNonBlank(obj.optString("category"), obj.optString("type")))
                                        .put("hasLocalKey", obj.optString("local_code").isNotBlank())
                                    )
                                }
                            }
                        }
                        eufyRecordCount += routeRecords
                        notes += "Eufy GET ${cleanBase.removePrefix("https://").substringBefore('/')} $path: OK ($routeRecords records)"

                        if (path == "user/setting") {
                            listOf("home_setting", "tuya_home", "tuya_home_id", "tuya_region_code", "region", "region_code").forEach { key ->
                                val value = findStringRecursive(response, key)
                                if (!value.isNullOrBlank()) notes += "Setting $key: ${value.take(160)}"
                            }
                        }
                    } catch (e: Exception) {
                        val msg = (e.message ?: "error").replace("\\n", " ").take(90)
                        notes += "Eufy GET ${cleanBase.removePrefix("https://").substringBefore('/')} $path: $msg"
                    }
                }
            }
            notes += "Eufy-side device-like records inspected: $eufyRecordCount"
'''
if old not in s:
    raise SystemExit('v7 patch anchor 2 not found')
s = s.replace(old, new, 1)
p.write_text(s)
print('Applied Craumer Lights v7 patch')
