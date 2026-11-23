"""Keep the ESP32-C6 compiler on SCons' subprocess PATH.

GitHub's runner shell can see the explicit PlatformIO GCC package, but a
PlatformIO-created SCons ENV can omit that bin directory. This post-configuration
hook is needed for GCC 15.2 which understands the current ESP-IDF RISC-V flags.
"""
Import("env")
from pathlib import Path

package = env.PioPlatform().get_package_dir("toolchain-riscv32-esp")
if not package:
    raise RuntimeError("ESP32-C6 toolchain package is missing")
bin_dir = Path(package) / "bin"
compiler = bin_dir / "riscv32-esp-elf-g++"
if not compiler.is_file():
    compiler = bin_dir / "riscv32-esp-elf-g++.exe"
if not compiler.is_file():
    raise RuntimeError("ESP32-C6 GCC executable is missing in " + str(bin_dir))
env.PrependENVPath("PATH", str(bin_dir))
print("Anderson GCC toolchain:", compiler)
