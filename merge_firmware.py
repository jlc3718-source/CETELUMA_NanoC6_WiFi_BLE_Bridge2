Import("env")
from pathlib import Path
import shlex

project_dir = Path(env.subst("$PROJECT_DIR"))
build_dir = Path(env.subst("$BUILD_DIR"))
app_bin = build_dir / f"{env.subst('$PROGNAME')}.bin"
out_bin = project_dir / "CETELUMA_NanoC6_WiFi_BLE_Bridge.bin"


def q(x):
    return shlex.quote(str(x))


def merge_action(source, target, build_env):
    platform = build_env.PioPlatform()
    esptool_pkg = Path(platform.get_package_dir("tool-esptoolpy"))
    candidates = [esptool_pkg / "esptool.py", esptool_pkg / "esptool" / "__init__.py"]
    py = build_env.subst("$PYTHONEXE")

    # PlatformIO already knows the correct bootloader/partition/boot_app offsets for this MCU.
    images = []
    for item in build_env.Flatten(build_env.get("FLASH_EXTRA_IMAGES", [])):
        # FLASH_EXTRA_IMAGES is a sequence of (address, path) pairs after flattening in most PIO releases.
        if isinstance(item, (tuple, list)) and len(item) == 2:
            images.extend([str(item[0]), build_env.subst(str(item[1]))])

    # Handle the common unflattened representation too.
    if not images:
        for pair in build_env.get("FLASH_EXTRA_IMAGES", []):
            if isinstance(pair, (tuple, list)) and len(pair) == 2:
                images.extend([str(pair[0]), build_env.subst(str(pair[1]))])

    images.extend([build_env.subst("$ESP32_APP_OFFSET"), str(app_bin)])

    # Modern PlatformIO's esptool package supports python -m esptool.
    cmd = [py, "-m", "esptool", "--chip", "esp32c6", "merge-bin", "-o", str(out_bin)] + images
    print("[CETELUMA] Creating merged phone-flash image:")
    print(" ", " ".join(q(x) for x in cmd))
    rc = build_env.Execute(" ".join(q(x) for x in cmd))
    if rc != 0:
        # Compatibility fallback for older esptool command spelling.
        cmd = [py, "-m", "esptool", "--chip", "esp32c6", "merge_bin", "-o", str(out_bin)] + images
        rc = build_env.Execute(" ".join(q(x) for x in cmd))
    if rc != 0:
        print("[CETELUMA] merge failed")
        build_env.Exit(rc)
    print(f"[CETELUMA] merged firmware: {out_bin} ({out_bin.stat().st_size} bytes)")


env.AddPostAction(str(app_bin), merge_action)
