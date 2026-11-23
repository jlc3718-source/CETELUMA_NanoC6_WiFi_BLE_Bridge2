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
    env.Replace(CXX=str(compiler), CC=str(gcc), LINK=str(compiler))
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
    env.Replace(CXX=str(compiler), CC=str(bin_dir / "riscv32-esp-elf-gcc"), LINK=str(compiler))
    print("Anderson local GCC:", compiler)

# Slim LTO objects require the GCC driver, linker plugin, and plugin-aware
# archiver. Linking through ld directly silently discards application objects.
env.AppendUnique(LINKFLAGS=["-flto", "-fuse-linker-plugin"])
gcc_ar = bin_dir / "riscv32-esp-elf-gcc-ar"
gcc_ranlib = bin_dir / "riscv32-esp-elf-gcc-ranlib"
if gcc_ar.is_file() and gcc_ranlib.is_file():
    env.Replace(AR=str(gcc_ar), RANLIB=str(gcc_ranlib))
print("Anderson LTO driver/linker:", env.get("LINK"))

# ESP-IDF 6.1 / Mbed TLS 4 replaces old mbedtls/sha256.h with PSA Crypto.
# Locate the ESP32-C6 SDK's public PSA and PK include trees and expose them
# to the application, keeping the pinned-key signature checks intact.
core_dir = Path(os.environ.get("PLATFORMIO_CORE_DIR") or Path.home() / ".platformio")
libs_pkg = env.PioPlatform().get_package_dir("framework-arduinoespressif32-libs")
sdk_roots = [Path(libs_pkg)] if libs_pkg else []
sdk_roots.append(core_dir / "packages" / "framework-arduinoespressif32-libs")
found_psa = None
found_root = None
for sdk_root in sdk_roots:
    if not sdk_root.is_dir():
        continue
    target = sdk_root / "esp32c6"
    if not target.is_dir():
        continue
    for candidate in target.rglob("crypto.h"):
        if candidate.parent.name == "psa" and "tf-psa-crypto" in str(candidate):
            found_psa = candidate
            found_root = sdk_root
            break
    if found_psa:
        break
if found_psa is None:
    raise RuntimeError("Missing ESP32-C6 PSA Crypto headers: cannot build signed OTA")
psa_include = found_psa.parent.parent
mbedtls = found_root / "esp32c6" / "include" / "mbedtls"
includes = [str(psa_include)]
for folder in (mbedtls / "mbedtls" / "include",
               mbedtls / "mbedtls" / "tf-psa-crypto" / "drivers" / "builtin" / "include",
               mbedtls / "port" / "include"):
    if folder.is_dir():
        includes.append(str(folder))
env.AppendUnique(CPPPATH=includes)
print("Anderson ESP32-C6 PSA Crypto headers:", psa_include)
