from pathlib import Path

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')
p = root / 'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s = p.read_text()

s = s.replace('import java.net.NetworkInterface\n', 'import java.net.NetworkInterface\nimport java.net.DatagramPacket\nimport java.net.DatagramSocket\nimport java.net.SocketTimeoutException\n')

helper = '''        private fun listenCraumerUdpDiscovery(): List<String> {
            val known = mapOf(
                "192.168.68.81" to "Front House Lights",
                "192.168.68.108" to "Garage Lights",
                "192.168.68.64" to "Pool Side Lights",
                "192.168.68.59" to "Shed Lights"
            )
            val hits = mutableListOf<String>()
            for (port in listOf(6666, 6667)) {
                try {
                    DatagramSocket(null).use { sock ->
                        sock.reuseAddress = true
                        sock.bind(InetSocketAddress(port))
                        sock.soTimeout = 1500
                        val deadline = System.currentTimeMillis() + 1500
                        while (System.currentTimeMillis() < deadline) {
                            val buf = ByteArray(2048)
                            val packet = DatagramPacket(buf, buf.size)
                            try {
                                sock.receive(packet)
                                val ip = packet.address.hostAddress ?: continue
                                val name = known[ip]
                                if (name != null) {
                                    hits += "$name $ip | UDP discovery on $port | ${packet.length} bytes"
                                }
                            } catch (_: SocketTimeoutException) {
                                break
                            }
                        }
                    }
                } catch (e: Exception) {
                    hits += "UDP $port listener unavailable: ${e.message}"
                }
            }
            return hits.distinct()
        }

'''
anchor = '''        private fun probeKnownCraumerLights(): List<String> {'''
if anchor not in s:
    raise SystemExit('v12 helper anchor missing')
s = s.replace(anchor, helper + anchor, 1)

anchor2 = '''            try {
                notes += "Exact Craumer light probes:"
'''
insert2 = '''            try {
                val udpHits = listenCraumerUdpDiscovery()
                notes += "Craumer UDP discovery hits: ${udpHits.count { !it.startsWith(\"UDP \") }}"
                if (udpHits.isEmpty()) {
                    notes += "No UDP discovery frames from the four known light IPs during the listen window"
                } else {
                    udpHits.forEach { notes += it }
                }
            } catch (e: Exception) {
                notes += "Craumer UDP discovery failed: ${e.message}"
            }

            try {
                notes += "Exact Craumer light probes:"
'''
if anchor2 not in s:
    raise SystemExit('v12 call anchor missing')
s = s.replace(anchor2, insert2, 1)

p.write_text(s)
print('Applied Craumer v12 UDP discovery listener')
