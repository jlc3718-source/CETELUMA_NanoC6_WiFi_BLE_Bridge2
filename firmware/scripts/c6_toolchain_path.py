"""Expose the platform's actual ESP32-C6 GCC executable to SCons.

The pioarduino toolchain package can unpack with the compiler under a nested
riscv32-esp-elf/bin folder. Locate the installed binary instead of assuming a
single archive layout; fail closed if GCC 15.2 is unavailable.
"""
Import("env")
from pathlib import Path
import os

package = env.PioPlatform().get_package_dir("toolchain-riscv32-esp")
core_dir = Path(os.environ.get("PLATFORMIO_CORE_DIR") or Path.home() / ".platformio")
roots = [core_dir / "packages" / "toolchain-riscv32-esp"]
if package:
    roots.append(Path(package))
compiler = None
for root in roots:
    for relative in ("bin/riscv32-esp-elf-g++",
                     "riscv32-esp-elf/bin/riscv32-esp-elf-g++",
                     "bin/riscv32-esp-elf-g++.exe",
                     "riscv32-esp-elf/bin/riscv32-esp-elf-g++.exe"):
        candidate = root / relative
        if candidate.is_file():
            compiler = candidate
            break
    if compiler:
        break
    if root.is_dir():
        for candidate in root.rglob("riscv32-esp-elf-g++"):
            if candidate.is_file():
                compiler = candidate
                break
    if compiler:
        break
if compiler is None:
    raise RuntimeError("ESP32-C6 GCC executable is missing; checked " +
                       ", ".join(str(p) for p in roots))
bin_dir = compiler.parent
env.PrependENVPath("PATH", str(bin_dir))
print("Anderson GCC toolchain:", compiler)
