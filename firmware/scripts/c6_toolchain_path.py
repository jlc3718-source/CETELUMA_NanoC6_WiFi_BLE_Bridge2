"""Use the SHA-256 verified Espressif GCC 15.2 executable in CI.

PIO's registry package can report success without leaving the compiler in its
expected package folder. We independently download the official vendor archive,
verify the published digest and ISA support, and export ANDERSON_GCC_BIN_DIR.
SCons' environment must also receive that PATH (not only the workflow shell).
"""
Import("env")
from pathlib import Path
import os

bin_env = os.environ.get("ANDERSON_GCC_BIN_DIR", "")
if bin_env:
    bin_dir = Path(bin_env)
    compiler = bin_dir / "riscv32-esp-elf-g++"
    gcc = bin_dir / "riscv32-esp-elf-gcc"
    if not compiler.is_file() or not gcc.is_file():
        raise RuntimeError("Verified Espressif GCC 15.2 is not accessible in " + str(bin_dir))
    env.PrependENVPath("PATH", str(bin_dir))
    # A full path prevents PIO's nested SCons environment from resolving an
    # older compiler or missing binary by name.
    env.Replace(CXX=str(compiler), CC=str(gcc))
    print("Anderson: verified vendor GCC 15.2:", compiler)
else:
    # Local developer build: keep PIO-managed toolchain support, with an
    # explicit error instead of silently invoking the wrong GCC revision.
    package = env.PioPlatform().get_package_dir("toolchain-riscv32-esp")
    core_dir = Path(os.environ.get("PLATFORMIO_CORE_DIR") or Path.home() / ".platformio")
    roots = [core_dir / "packages" / "toolchain-riscv32-esp"]
    if package:
        roots.append(Path(package))
    compiler = None
    for root in roots:
        if root.is_dir():
            for candidate in root.rglob("riscv32-esp-elf-g++"):
                if candidate.is_file():
                    compiler = candidate
                    break
        if compiler:
            break
    if compiler is None:
        raise RuntimeError("ESP32-C6 GCC not found; configure ANDERSON_GCC_BIN_DIR")
    bin_dir = compiler.parent
    env.PrependENVPath("PATH", str(bin_dir))
    env.Replace(CXX=str(compiler), CC=str(bin_dir / "riscv32-esp-elf-gcc"))
    print("Anderson local GCC:", compiler)

# Direct mbedTLS use by the signed OTA verifier requires the ESP32-C6 SDK
# public headers. PIO's Arduino-only CPPPATH sometimes omits this SDK component
# even though the prebuilt framework and mbedcrypto libraries are installed.
core_dir = Path(os.environ.get("PLATFORMIO_CORE_DIR") or Path.home() / ".platformio")
libs_package = env.PioPlatform().get_package_dir("framework-arduinoespressif32-libs")
libs_roots = [Path(libs_package)] if libs_package else []
libs_roots.append(core_dir / "packages" / "framework-arduinoespressif32-libs")
mbedtls_header = None
for sdk_root in libs_roots:
    if not sdk_root.is_dir():
        continue
    # Prefer the official SDK's mbedTLS include tree; do not add any foreign
    # crypto implementation or change signed-update verification.
    direct = sdk_root / "esp32c6" / "include" / "mbedtls" / "mbedtls" / "include" / "mbedtls" / "sha256.h"
    if direct.is_file():
        mbedtls_header = direct
        break
    for candidate in (sdk_root / "esp32c6").rglob("sha256.h"):
        if candidate.parent.name == "mbedtls":
            mbedtls_header = candidate
            break
    if mbedtls_header:
        break
if mbedtls_header is None:
    raise RuntimeError("ESP32-C6 SDK mbedTLS headers are missing; cannot safely build signed OTA")
mbedtls_include = mbedtls_header.parent.parent
env.AppendUnique(CPPPATH=[str(mbedtls_include)])
print("Anderson ESP32-C6 signed OTA mbedTLS headers:", mbedtls_include)
