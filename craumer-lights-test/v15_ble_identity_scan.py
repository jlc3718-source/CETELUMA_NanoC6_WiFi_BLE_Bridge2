from pathlib import Path

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')

# Add Android BLE permissions without changing package/application identity.
manifest = root / 'android/app/src/main/AndroidManifest.xml'
m = manifest.read_text()
perm_block = '''    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />\n    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />\n    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />\n    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />\n    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />\n'''
if 'android.permission.BLUETOOTH_SCAN' not in m:
    app_anchor = '<application'
    if app_anchor not in m:
        raise SystemExit('v15 manifest application anchor missing')
    m = m.replace(app_anchor, perm_block + app_anchor, 1)
    manifest.write_text(m)

p = root / 'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s = p.read_text()

helper = '''        private fun scanKnownCraumerBle(): List<String> {
            val targets = linkedMapOf(
                "10:2C:B1:AD:CA:7F" to "Front House Lights T8L00",
                "10:2C:B1:9D:F7:B5" to "Garage Lights T8L02",
                "10:2C:B1:0E:C4:01" to "Pool Side Lights T8L00",
                "10:2C:B1:EB:27:96" to "Shed Lights T8L02"
            )

            val needed = if (android.os.Build.VERSION.SDK_INT >= 31) {
                listOf(android.Manifest.permission.BLUETOOTH_SCAN, android.Manifest.permission.BLUETOOTH_CONNECT)
            } else {
                listOf(android.Manifest.permission.ACCESS_FINE_LOCATION)
            }
            val missing = needed.filter { checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED }
            if (missing.isNotEmpty()) {
                runOnUiThread { requestPermissions(missing.toTypedArray(), 7315) }
                return listOf("BLE Nearby Devices permission requested — allow it, then run Connect & Discover again")
            }

            val manager = getSystemService(android.content.Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager
                ?: return listOf("BLE manager unavailable")
            val adapter = manager.adapter ?: return listOf("Bluetooth adapter unavailable")
            if (!adapter.isEnabled) return listOf("Bluetooth is off")
            val scanner = adapter.bluetoothLeScanner ?: return listOf("BLE scanner unavailable")

            val found = java.util.concurrent.ConcurrentHashMap<String, String>()
            val candidateSeen = java.util.concurrent.ConcurrentHashMap<String, String>()
            val callback = object : android.bluetooth.le.ScanCallback() {
                override fun onScanResult(callbackType: Int, result: android.bluetooth.le.ScanResult) {
                    val mac = result.device.address?.uppercase() ?: return
                    val record = result.scanRecord
                    val advName = record?.deviceName ?: ""
                    val isTarget = targets.containsKey(mac)
                    val isCandidate = mac.startsWith("10:2C:B1") || advName.contains("eufy", true) || advName.contains("T8L", true)
                    if (!isTarget && !isCandidate) return

                    val services = record?.serviceUuids?.joinToString(",") { it.uuid.toString() } ?: ""
                    val mfgParts = mutableListOf<String>()
                    val mfg = record?.manufacturerSpecificData
                    if (mfg != null) {
                        for (i in 0 until mfg.size()) {
                            val id = mfg.keyAt(i)
                            val data = mfg.valueAt(i)
                            val hex = data.joinToString("") { b -> "%02X".format(b.toInt() and 0xFF) }
                            mfgParts += "$id:$hex"
                        }
                    }
                    val raw = record?.bytes?.joinToString("") { b -> "%02X".format(b.toInt() and 0xFF) }?.take(220) ?: ""
                    val label = targets[mac] ?: "candidate"
                    val line = "$label $mac RSSI ${result.rssi} name=${if (advName.isBlank()) "-" else advName} services=${if (services.isBlank()) "-" else services} mfg=${if (mfgParts.isEmpty()) "-" else mfgParts.joinToString(";")} adv=$raw"
                    if (isTarget) found[mac] = line else candidateSeen[mac] = line
                }
            }

            return try {
                scanner.startScan(callback)
                Thread.sleep(8000)
                scanner.stopScan(callback)
                val out = mutableListOf<String>()
                out += "Known Craumer BLE targets seen: ${found.size}/4"
                targets.forEach { (mac, name) -> out += found[mac] ?: "$name $mac | no advertisement seen" }
                if (candidateSeen.isNotEmpty()) {
                    out += "Other Eufy/OUI BLE candidates: ${candidateSeen.size}"
                    candidateSeen.values.sorted().take(8).forEach { out += it }
                }
                out
            } catch (e: Exception) {
                try { scanner.stopScan(callback) } catch (_: Exception) { }
                listOf("BLE scan failed: ${e.message}")
            }
        }

'''
anchor = '''        private fun activeUdpCraumerProbe(): List<String> {'''
if anchor not in s:
    raise SystemExit('v15 helper anchor missing')
s = s.replace(anchor, helper + anchor, 1)

call_anchor = '''            try {
                notes += "Craumer active UDP target probe:"
'''
call = '''            try {
                notes += "Craumer BLE identity scan:"
                scanKnownCraumerBle().forEach { notes += it }
            } catch (e: Exception) {
                notes += "Craumer BLE scan failed: ${e.message}"
            }

            try {
                notes += "Craumer active UDP target probe:"
'''
if call_anchor not in s:
    raise SystemExit('v15 call anchor missing')
s = s.replace(call_anchor, call, 1)

p.write_text(s)
print('Applied v15 BLE identity/advertisement scan for all four Craumer lights')
