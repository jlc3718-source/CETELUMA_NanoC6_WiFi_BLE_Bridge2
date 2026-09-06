from pathlib import Path

root=Path('build_source/Craumer_Lights_Eufy_Test_v2')
g=root/'android/app/build.gradle.kts'
s=g.read_text().replace('versionCode = 8','versionCode = 9').replace('versionName = "0.8-test"','versionName = "0.9-test"')
g.write_text(s)
for rel in ['web/index.html','android/app/src/main/assets/index.html']:
    p=root/rel; p.write_text(p.read_text().replace('TEST v8','TEST v9'))

p=root/'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s=p.read_text()
s=s.replace('import java.net.InetSocketAddress\n','import java.net.InetSocketAddress\nimport java.net.NetworkInterface\n')

helper='''        private fun scanCraumerLan(): List<String> {
            val local = NetworkInterface.getNetworkInterfaces().toList()
                .flatMap { it.inetAddresses.toList() }
                .firstOrNull { !it.isLoopbackAddress && it.hostAddress?.contains('.') == true }
                ?.hostAddress ?: return emptyList()
            val prefix = local.substringBeforeLast('.')
            val pool = Executors.newFixedThreadPool(40)
            val hits = java.util.Collections.synchronizedList(mutableListOf<String>())
            val tasks = (1..254).map { n ->
                pool.submit {
                    val ip = "$prefix.$n"
                    if (ip == local) return@submit
                    for (port in listOf(6668, 55556)) {
                        try {
                            Socket().use { sock ->
                                sock.connect(InetSocketAddress(ip, port), 120)
                                hits += "$ip:$port"
                            }
                        } catch (_: Exception) { }
                    }
                }
            }
            tasks.forEach { try { it.get(4, TimeUnit.SECONDS) } catch (_: Exception) { } }
            pool.shutdownNow()
            return hits.distinct().sorted()
        }

'''
anchor='''        private fun currentState(): JSONObject {
'''
if anchor not in s: raise SystemExit('v9 helper anchor missing')
s=s.replace(anchor,helper+anchor,1)

anchor2='''            return JSONObject()
                .put("authMethod", authMethod)
'''
insert='''            try {
                val lanHits = scanCraumerLan()
                notes += "Craumer LAN local-service hits: ${lanHits.size}"
                lanHits.forEach { notes += "LAN $it" }
            } catch (e: Exception) {
                notes += "Craumer LAN scan failed: ${e.message}"
            }

            return JSONObject()
                .put("authMethod", authMethod)
'''
if anchor2 not in s: raise SystemExit('v9 call anchor missing')
s=s.replace(anchor2,insert,1)
p.write_text(s)
print('Applied Craumer Lights v9 LAN discovery patch')
