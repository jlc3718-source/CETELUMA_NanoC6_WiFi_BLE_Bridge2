from pathlib import Path

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')
p = root / 'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s = p.read_text()

# Give the cloud probe a little more time without using Bluetooth.
s = s.replace('.get(30, TimeUnit.SECONDS)', '.get(45, TimeUnit.SECONDS)')

helper = '''        private fun probeMegaV6Domain(): List<String> {
            val out = mutableListOf<String>()
            val headers = mapOf(
                "app-name" to "eufy_mega",
                "app-version" to "6.0.51_26722",
                "os-type" to "android",
                "Content-Type" to "application/json"
            )
            return try {
                val response = httpJson(
                    "POST",
                    "https://mega-us-pr.eufy.com/passport/estimate_domain",
                    JSONObject().put("ab", "us").put("mode", 1),
                    headers
                )
                val code = response.optInt("code", -1)
                if (code == 0) {
                    val data = response.optJSONObject("data") ?: JSONObject()
                    val domain = data.optString("domain")
                    val products = data.optJSONObject("product_domains")
                    out += "Mega v6 estimate_domain OK: ${if (domain.isBlank()) "domain missing" else domain}"
                    out += "Mega v6 product domains: ${products?.length() ?: 0}"
                    if (products != null) {
                        val names = products.keys().asSequence().toList().sorted().take(12)
                        if (names.isNotEmpty()) out += "Mega v6 services: ${names.joinToString(",")}"
                    }
                } else {
                    out += "Mega v6 estimate_domain response: code=$code ${response.optString("msg")}"
                }
                out
            } catch (e: Exception) {
                listOf("Mega v6 estimate_domain failed: ${e.message}")
            }
        }

'''
anchor = '        private fun currentState(): JSONObject {\n'
if 'private fun probeMegaV6Domain()' not in s:
    if anchor not in s:
        raise SystemExit('v16 helper anchor missing')
    s = s.replace(anchor, helper + anchor, 1)

call_anchor = '            notes += "Eufy-side device-like records inspected: $eufyRecordCount"\n'
call = '''            notes += "Eufy-side device-like records inspected: $eufyRecordCount"\n\n            notes += "Eufy Mega v6 cloud route probe:"\n            probeMegaV6Domain().forEach { notes += it }\n'''
if 'Eufy Mega v6 cloud route probe:' not in s:
    if call_anchor not in s:
        raise SystemExit('v16 call anchor missing')
    s = s.replace(call_anchor, call, 1)

p.write_text(s)
print('Applied v16 Eufy Mega v6 domain probe; Bluetooth is not used')
