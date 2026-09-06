from pathlib import Path

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')
p = root / 'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s = p.read_text()

# v17 remains cloud-only. It uses the Mega estimate_domain result to try the returned
# Mega host/product domains directly with the current Eufy account token. Read-only only.
s = s.replace('.get(45, TimeUnit.SECONDS)', '.get(75, TimeUnit.SECONDS)')
s = s.replace('.get(30, TimeUnit.SECONDS)', '.get(75, TimeUnit.SECONDS)')

helper = r'''        private fun probeMegaInventoryRoutes(token: String, uid: String): List<String> {
            val out = mutableListOf<String>()
            val headers = hashMapOf<String, String>()
            headers["app-name"] = "eufy_mega"
            headers["app-version"] = "6.0.51_26722"
            headers["os-type"] = "android"
            headers["os-version"] = "35"
            headers["phone-model"] = "SM-S938U"
            headers["country"] = "US"
            headers["language"] = "en"
            headers["Content-Type"] = "application/json"
            headers["token"] = token
            headers["uid"] = uid
            headers["X-Auth-Token"] = token

            fun hostUrl(raw: String): String? {
                var h = raw.trim()
                if (h.isBlank()) return null
                if (!h.startsWith("http://", true) && !h.startsWith("https://", true)) h = "https://$h"
                if (!h.endsWith("/")) h += "/"
                return h
            }

            val hosts = linkedSetOf<String>()
            hosts += "https://mega-us-pr.eufy.com/"
            hosts += "https://security-smart.eufylife.com/"
            hosts += "https://extend.eufylife.com/"

            try {
                val est = httpJson(
                    "POST",
                    "https://mega-us-pr.eufy.com/passport/estimate_domain",
                    JSONObject().put("ab", "us").put("mode", 1),
                    headers
                )
                val data = est.optJSONObject("data") ?: JSONObject()
                hostUrl(data.optString("domain"))?.let { hosts += it }
                val products = data.optJSONObject("product_domains")
                if (products != null) {
                    val productNames = mutableListOf<String>()
                    val keys = products.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        productNames += k
                        when (val v = products.opt(k)) {
                            is String -> hostUrl(v)?.let { hosts += it }
                            is JSONObject -> {
                                listOf("domain", "host", "url", "api", "api_url", "base_url").forEach { f ->
                                    hostUrl(v.optString(f))?.let { hosts += it }
                                }
                            }
                        }
                    }
                    if (productNames.isNotEmpty()) out += "Mega product namespaces seen: ${productNames.sorted().take(12).joinToString(",")}"
                }
            } catch (e: Exception) {
                out += "Mega route setup failed: ${(e.message ?: "error").replace("\n", " ").take(120)}"
            }

            out += "Mega inventory host candidates: ${hosts.map { it.removePrefix("https://").removePrefix("http://").trimEnd('/') }.joinToString(",")}"

            val paths = listOf(
                "v1/house/list",
                "v2/house/device_list",
                "v2/house/station_list",
                "v2/house/detail",
                "v1/user/profile",
                "v2/passport/profile",
                "v1/device/list",
                "v1/device/list/devices-and-groups",
                "v6/house/list",
                "v6/house/device_list",
                "v6/house/station_list",
                "v6/device/list",
                "v6/app/device/list",
                "v6/app/devices"
            )

            val needles = listOf(
                "T8L00610243503A2", "T8L028102427474A", "T8L006102353014B", "T8L0291024470193",
                "102CB1ADC30C", "102CB19DF5F8", "102CB10ECB76", "102CB1EE6D9A",
                "10:2C:B1:AD:C3:0C", "10:2C:B1:9D:F5:F8", "10:2C:B1:0E:CB:76", "10:2C:B1:EE:6D:9A",
                "T8L00", "T8L02", "Front House", "Garage Lights", "Pool Side", "Shed Lights"
            )

            fun inspect(label: String, json: JSONObject) {
                val body = json.toString()
                val objects = mutableListOf<JSONObject>()
                collectObjects(json, objects)
                val hits = needles.filter { body.contains(it, true) }
                var deviceish = 0
                for (obj in objects) {
                    val id = firstNonBlank(obj.optString("id"), obj.optString("device_id"), obj.optString("deviceId"), obj.optString("station_sn"), obj.optString("device_sn"), obj.optString("sn"))
                    val model = firstNonBlank(obj.optString("product_code"), obj.optString("productCode"), obj.optString("model"), obj.optString("device_model"), obj.optString("deviceModel"))
                    val name = firstNonBlank(obj.optString("alias_name"), obj.optString("name"), obj.optString("device_name"), obj.optString("nickname"))
                    if (id.isNotBlank() || model.isNotBlank() || name.isNotBlank()) deviceish++
                }
                out += "$label OK records=$deviceish identity hits=${if (hits.isEmpty()) "none" else hits.joinToString(",")}"
            }

            var tried = 0
            for (host in hosts.take(8)) {
                for (path in paths) {
                    if (tried >= 42) break
                    tried++
                    val shortHost = host.removePrefix("https://").removePrefix("http://").trimEnd('/')
                    try {
                        val r = httpJson("GET", host + path, null, headers)
                        inspect("Mega GET $shortHost $path", r)
                    } catch (e: Exception) {
                        val msg = (e.message ?: "error").replace("\n", " ").take(90)
                        if (msg.contains("401") || msg.contains("403") || msg.contains("404") || msg.contains("405")) {
                            out += "Mega GET $shortHost $path: $msg"
                        } else {
                            out += "Mega GET $shortHost $path failed: $msg"
                        }
                    }
                }
            }
            return out
        }

'''

anchor = '        private fun currentState(): JSONObject {\n'
if 'private fun probeMegaInventoryRoutes(' not in s:
    if anchor not in s:
        raise SystemExit('v17 helper anchor missing')
    s = s.replace(anchor, helper + anchor, 1)

call_anchor = '''            notes += "Eufy Mega v6 cloud route probe:"
            probeMegaV6Domain().forEach { notes += it }
'''
call = '''            notes += "Eufy Mega v6 cloud route probe:"
            probeMegaV6Domain().forEach { notes += it }

            notes += "Eufy Mega direct inventory route probe:"
            probeMegaInventoryRoutes(token, uid).forEach { notes += it }
'''
if 'Eufy Mega direct inventory route probe:' not in s:
    if call_anchor not in s:
        raise SystemExit('v17 call anchor missing')
    s = s.replace(call_anchor, call, 1)

p.write_text(s)
print('Applied v17 Eufy Mega direct inventory route probe; no BLE and no commands')
