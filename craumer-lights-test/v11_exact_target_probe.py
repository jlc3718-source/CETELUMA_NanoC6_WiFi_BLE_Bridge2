from pathlib import Path

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')
p = root / 'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s = p.read_text()

helper = '''        private fun probeKnownCraumerLights(): List<String> {
            val targets = listOf(
                "Front House Lights" to "192.168.68.81",
                "Garage Lights" to "192.168.68.108",
                "Pool Side Lights" to "192.168.68.64",
                "Shed Lights" to "192.168.68.59"
            )
            val ports = listOf(80, 443, 6666, 6667, 6668, 7000, 55556)
            val results = mutableListOf<String>()
            for ((name, ip) in targets) {
                val open = mutableListOf<Int>()
                for (port in ports) {
                    try {
                        Socket().use { sock ->
                            sock.connect(InetSocketAddress(ip, port), 450)
                            open += port
                        }
                    } catch (_: Exception) { }
                }
                results += if (open.isEmpty()) {
                    "$name $ip | no tested TCP ports open"
                } else {
                    "$name $ip | open TCP: ${open.joinToString(",")}" 
                }
            }
            return results
        }

'''
anchor = '''        private fun scanCraumerLan(): List<String> {'''
if anchor not in s:
    raise SystemExit('exact-probe helper anchor missing')
s = s.replace(anchor, helper + anchor, 1)

anchor2 = '''            try {
                val lanHits = scanCraumerLan()
'''
insert2 = '''            try {
                notes += "Exact Craumer light probes:"
                probeKnownCraumerLights().forEach { notes += it }
            } catch (e: Exception) {
                notes += "Exact target probe failed: ${e.message}"
            }

            try {
                val lanHits = scanCraumerLan()
'''
if anchor2 not in s:
    raise SystemExit('exact-probe call anchor missing')
s = s.replace(anchor2, insert2, 1)
p.write_text(s)
print('Applied exact-target read-only LAN probe')
