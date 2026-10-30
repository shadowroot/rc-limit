#!/usr/bin/env python3
"""Package already-built firmware; never select or flash a device."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BOARDS = ('pico', 'esp32', 'esp32c3', 'esp32c3-devkit')


def package(board):
    source = ROOT / 'build' / 'pio' / board
    names = ['firmware.uf2'] if board == 'pico' else ['bootloader.bin', 'partitions.bin', 'firmware.bin']
    files = {name: (source / name).read_bytes() for name in names}
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if board == 'pico':
        flashing = ('Hold BOOTSEL while connecting USB. Copy firmware.uf2 to the RPI-RP2 volume.\n'
                    'This build is for RP2040 Pico, not Pico 2.\n')
    else:
        chip = 'esp32' if board == 'esp32' else 'esp32c3'
        offset = '0x1000' if board == 'esp32' else '0x0'
        flashing = (f'Install esptool 4.9.0 (python -m pip install esptool==4.9.0).\n'
                    f'From this extracted directory, replace PORT with your explicit serial port:\n'
                    f'python -m esptool --chip {chip} --port PORT write_flash '
                    f'{offset} bootloader.bin 0x8000 partitions.bin 0x10000 firmware.bin\n'
                    'All three files are required for a fresh installation. Do not erase flash to upgrade.\n'
                    'Super Mini uses native USB; C3 DevKitM-1 uses the USB-UART connector.\n')
    readme = (f'RC Limit firmware: {board}\nSource commit: {commit}\n\n'
              'Disconnect motor power before flashing. Back up configuration profiles first.\n'
              'Boot starts stopped; control enables automatically after all inputs stay neutral for one second. Confirm pins, ESC neutral, limits and failsafe before use.\n'
              'These are automated builds; physical operation is not certified by compilation.\n\n'
              + flashing + '\nESP32/C3: native ESP-IDF 5.5.0. Pico: Arduino-Pico 4.4.3.\n'
              'Project wiring, commissioning and configuration instructions are included.\n')
    chip = 'rp2040' if board == 'pico' else 'ESP32' if board == 'esp32' else 'ESP32-C3'
    addresses = [None] if board == 'pico' else [0x1000 if board == 'esp32' else 0, 0x8000, 0x10000]
    manifest = {'project': 'rc-limit', 'version': 1, 'board': board, 'chip': chip, 'commit': commit,
                'images': [{'file': name, 'address': address, 'size': len(files[name]),
                            'sha256': hashlib.sha256(files[name]).hexdigest()}
                           for name, address in zip(names, addresses)]}
    files['update-manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    files['README.txt'] = readme.encode()
    for name in ('wiring.md', 'commissioning.md', 'board-layouts.md', 'protocol.md'):
        files['docs/' + name] = (ROOT / 'docs' / name).read_bytes()
    files['SHA256SUMS'] = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n'
                                  for name, data in sorted(files.items())).encode()
    output = ROOT / 'build' / 'releases' / f'rc-limit-{board}.zip'
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            archive.writestr(name, data)
    print(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('board', choices=BOARDS)
    package(parser.parse_args().board)
