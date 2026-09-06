from pathlib import Path

root=Path('build_source/Craumer_Lights_Eufy_Test_v2')
p=root/'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s=p.read_text()
if 'import java.net.InetAddress\n' not in s:
    s=s.replace('import java.net.InetSocketAddress\n','import java.net.InetSocketAddress\nimport java.net.InetAddress\n',1)
helper='''        private fun activeUdpCraumerProbe(): List<String> {
            val targets = listOf(
                "Front House Lights" to "192.168.68.81",
                "Garage Lights" to "192.168.68.108",
                "Pool Side Lights" to "192.168.68.64",
                "Shed Lights" to "192.168.68.59"
            )
            val ports = listOf(6666, 6667, 7000)
            val out = mutableListOf<String>()
            for ((name, ip) in targets) {
                var replied = false
                for (port in ports) {
                    try {
                        DatagramSocket().use { sock ->
                            sock.soTimeout = 350
                            val ping = byteArrayOf(0)
                            sock.send(DatagramPacket(ping, ping.size, InetAddress.getByName(ip), port))
                            val buf = ByteArray(512)
                            val packet = DatagramPacket(buf, buf.size)
                            sock.receive(packet)
                            out += "$name $ip UDP:$port replied ${packet.length} bytes"
                            replied = true
                        }
                    } catch (_: Exception) { }
                }
                if (!replied) out += "$name $ip | no active UDP replies"
            }
            return out
        }

'''
anchor='''        private fun probeKnownCraumerLights(): List<String> {'''
if anchor not in s: raise SystemExit('v13 helper anchor missing')
s=s.replace(anchor,helper+anchor,1)
call_anchor='''            try {
                notes += "Exact Craumer light probes:"
'''
call='''            try {
                notes += "Craumer active UDP target probe:"
                activeUdpCraumerProbe().forEach { notes += it }
            } catch (e: Exception) {
                notes += "Active UDP probe failed: ${e.message}"
            }

            try {
                notes += "Exact Craumer light probes:"
'''
if call_anchor not in s: raise SystemExit('v13 call anchor missing')
s=s.replace(call_anchor,call,1)
p.write_text(s)
print('Applied v13 active UDP target probe')
