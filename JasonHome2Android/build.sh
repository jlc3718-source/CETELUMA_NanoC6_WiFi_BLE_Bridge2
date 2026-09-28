#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sdk_jar="${JH2_ANDROID_JAR:?Set JH2_ANDROID_JAR to Android 35 android.jar}"
tools_dir="${JH2_BUILD_TOOLS:?Set JH2_BUILD_TOOLS to Android build-tools 35}"
out="${JH2_APK_OUTPUT:-$here/Jason-Home-2-2.0.0-SIGNED.apk}"
store="${JH2_KEYSTORE:?Set JH2_KEYSTORE to the private release keystore}"
store_password="${JH2_KEYSTORE_PASSWORD:?Set JH2_KEYSTORE_PASSWORD}"
mkdir -p "$here/build/classes" "$here/build/dex"
"$tools_dir/aapt2" link -o "$here/build/unsigned.apk" -I "$sdk_jar" --manifest "$here/AndroidManifest.xml" --min-sdk-version 26 --target-sdk-version 35
java --module jdk.compiler/com.sun.tools.javac.Main --release 17 -cp "$sdk_jar" -d "$here/build/classes" "$here/src/com/jasonhome2/app/MainActivity.java"
"$tools_dir/d8" --min-api 26 --lib "$sdk_jar" --output "$here/build/dex" "$here/build/classes/com/jasonhome2/app/"*.class
cp "$here/build/unsigned.apk" "$here/build/with-dex.apk"
(cd "$here/build/dex" && zip -q -u "$here/build/with-dex.apk" classes.dex)
"$tools_dir/zipalign" -f 4 "$here/build/with-dex.apk" "$here/build/aligned.apk"
"$tools_dir/apksigner" sign --ks "$store" --ks-key-alias jason-home-2 --ks-pass env:JH2_KEYSTORE_PASSWORD --key-pass env:JH2_KEYSTORE_PASSWORD --out "$out" "$here/build/aligned.apk"
"$tools_dir/apksigner" verify --verbose --print-certs "$out"
sha256sum "$out"
