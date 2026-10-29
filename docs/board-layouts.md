# Board layouts and suggested RC pins

Use the **Board layouts, suggested pins & 5 V input resistors** panel under Pin mapping in the web/Electron GUI, or **Board layouts / suggested GPIOs / 5 V resistors** in native Android. These are top/component views, not underside/solder views. USB orientation is stated for each diagram. Numbers such as GP4/GPIO4 are MCU GPIOs; connector/header numbers are shown separately. Match the exact board revision and printed labels before wiring.

| Board | Build target | Configuration transports | Suggested first input → output |
|---|---|---|---|
| Standard Pico / RP2040 | `pico` | USB CDC | GP4 → GP5 |
| Original ESP32 DevKit / WROOM | `esp32` | USB-to-UART + Bluetooth Classic SPP (`RC-<device name>`) | GPIO27 → GPIO25 |
| ESP32-C3 Super Mini, native USB | `esp32c3` | Native USB Serial/JTAG CDC + BLE UART (`RC-<device name>`) | GPIO3 → GPIO4 |
| Official ESP32-C3-DevKitM-1 | `esp32c3-devkit` | Onboard USB-to-UART + BLE UART (`RC-<device name>`) | GPIO3 → GPIO4 |

All four targets support 1–4 mappings and the same JSON configuration protocol. Every GPIO listed here is **3.3 V logic**, not a 5 V receiver input. A power pin marked 5V is different from GPIO5. For a measured 5 V receiver signal use the divider or buffer in [wiring.md](wiring.md).

The original ESP32's Classic SPP and the C3's BLE UART are different transports. Use the serial chooser for USB/Classic and **Connect C3 BLE serial** for BLE. The C3 does not gain Bluetooth Classic support from this firmware. In Android, **Bluetooth** lists paired Classic devices; **BLE C3** scans for the UART service without requiring prior OS pairing.

## Raspberry Pi Pico (RP2040)

**USB at the top.** Native USB CDC. GP4 is physical pin 6; GP5 is pin 7. Outputs 16 GPIOs apart share a PWM channel.

[Board reference](https://datasheets.raspberrypi.com/pico/Pico-R3-A4-Pinout.pdf).

| Left header position | Left pin | Right pin | Right header position |
|---|---|---|---|
| 1 | GP0 | VBUS | 40 |
| 2 | GP1 | VSYS | 39 |
| 3 | GND | GND | 38 |
| 4 | GP2 | 3V3_EN | 37 |
| 5 | GP3 | 3V3 | 36 |
| 6 | GP4 | ADC_VREF | 35 |
| 7 | GP5 | GP28 | 34 |
| 8 | GND | AGND | 33 |
| 9 | GP6 | GP27 | 32 |
| 10 | GP7 | GP26 | 31 |
| 11 | GP8 | RUN | 30 |
| 12 | GP9 | GP22 | 29 |
| 13 | GND | GND | 28 |
| 14 | GP10 | GP21 | 27 |
| 15 | GP11 | GP20 | 26 |
| 16 | GP12 | GP19 | 25 |
| 17 | GP13 | GP18 | 24 |
| 18 | GND | GND | 23 |
| 19 | GP14 | GP17 | 22 |
| 20 | GP15 | GP16 | 21 |

Suggested mappings, in order: **GPIO4 → GPIO5**, **GPIO6 → GPIO7**, **GPIO8 → GPIO9**, **GPIO10 → GPIO11**.

## ESP32-DevKitC V4 / WROOM (38 pins)

**USB at the bottom.** USB-to-UART bridge + Bluetooth Classic SPP. Diagram is the official 38-pin DevKitC, not a universal 30-pin clone layout. Use printed GPIO labels on other DevKits. Grey GPIOs are outside this project's conservative allowlist.

[Board reference](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html).

| Left header position | Left pin | Right pin | Right header position |
|---|---|---|---|
| J2.1 | 3V3 | GND | J3.1 |
| J2.2 | EN | GPIO23 | J3.2 |
| J2.3 | GPIO36 | GPIO22 | J3.3 |
| J2.4 | GPIO39 | GPIO1 | J3.4 |
| J2.5 | GPIO34 | GPIO3 | J3.5 |
| J2.6 | GPIO35 | GPIO21 | J3.6 |
| J2.7 | GPIO32 | GND | J3.7 |
| J2.8 | GPIO33 | GPIO19 | J3.8 |
| J2.9 | GPIO25 | GPIO18 | J3.9 |
| J2.10 | GPIO26 | GPIO5 | J3.10 |
| J2.11 | GPIO27 | GPIO17 | J3.11 |
| J2.12 | GPIO14 | GPIO16 | J3.12 |
| J2.13 | GPIO12 | GPIO4 | J3.13 |
| J2.14 | GND | GPIO0 | J3.14 |
| J2.15 | GPIO13 | GPIO2 | J3.15 |
| J2.16 | GPIO9 | GPIO15 | J3.16 |
| J2.17 | GPIO10 | GPIO8 | J3.17 |
| J2.18 | GPIO11 | GPIO7 | J3.18 |
| J2.19 | 5V | GPIO6 | J3.19 |

Suggested mappings, in order: **GPIO27 → GPIO25**, **GPIO26 → GPIO33**, **GPIO32 → GPIO18**, **GPIO19 → GPIO21**.

## ESP32-C3 Super Mini (common 16-pin)

**USB at the top.** Native USB Serial/JTAG on GPIO18/19 (not header GPIO20/21). BLE serial, not Bluetooth Classic. GPIO2/8/9 are boot straps; 8 often drives the LED and 9 the BOOT button. L/R labels count rows, not standardized connector numbers. Clone layouts vary. GPIO4–7 require external JTAG to be unused.

[Board reference](https://smartstream-electronics.co.uk/assets/datasheets/ESP32-C3-SuperMini.pdf).

| Left header position | Left pin | Right pin | Right header position |
|---|---|---|---|
| L1 | 5V | GPIO5 | R1 |
| L2 | GND | GPIO6 | R2 |
| L3 | 3V3 | GPIO7 | R3 |
| L4 | GPIO4 | GPIO8 | R4 |
| L5 | GPIO3 | GPIO9 | R5 |
| L6 | GPIO2 | GPIO10 | R6 |
| L7 | GPIO1 | GPIO20 | R7 |
| L8 | GPIO0 | GPIO21 | R8 |

Suggested mappings, in order: **GPIO3 → GPIO4**, **GPIO5 → GPIO6**, **GPIO0 → GPIO1**, **GPIO7 → GPIO10**.

## ESP32-C3-DevKitM-1 (30 pins)

**USB at the bottom.** The official DevKitM-1 USB connector uses a USB-to-UART bridge on GPIO20/21. Build with esp32c3-devkit for that connector. GPIO18/19 are the chip's separate native USB signals; keep them free. BLE serial is available. GPIO4–7 require external JTAG to be unused.

[Board reference](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32c3/esp32-c3-devkitm-1/user_guide.html).

| Left header position | Left pin | Right pin | Right header position |
|---|---|---|---|
| J1.1 | GND | GND | J3.1 |
| J1.2 | 3V3 | GPIO21 | J3.2 |
| J1.3 | 3V3 | GPIO20 | J3.3 |
| J1.4 | GPIO2 | GND | J3.4 |
| J1.5 | GPIO3 | GPIO9 | J3.5 |
| J1.6 | GND | GPIO8 | J3.6 |
| J1.7 | RST | GND | J3.7 |
| J1.8 | GND | GPIO7 | J3.8 |
| J1.9 | GPIO0 | GPIO6 | J3.9 |
| J1.10 | GPIO1 | GPIO5 | J3.10 |
| J1.11 | GPIO10 | GPIO4 | J3.11 |
| J1.12 | GND | GND | J3.12 |
| J1.13 | 5V | GPIO18 | J3.13 |
| J1.14 | 5V | GPIO19 | J3.14 |
| J1.15 | GND | GND | J3.15 |

Suggested mappings, in order: **GPIO3 → GPIO4**, **GPIO5 → GPIO6**, **GPIO0 → GPIO1**, **GPIO7 → GPIO10**.

## Pins to leave free

- **C3 Super Mini and C3 DevKitM-1:** this project permits only GPIO0, 1, 3, 4, 5, 6, 7 and 10 for RC mappings. It excludes boot straps 2/8/9, native USB 18/19 and UART 20/21. GPIO4–7 can serve external JTAG: do not use external JTAG concurrently with RC mappings on those pins. On common Super Minis, GPIO8 has an onboard LED and GPIO9 is connected to BOOT; check clones individually. The chip's native USB pair is 18/19, **not** 20/21. See the [C3 chip datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-c3_datasheet_en.pdf) for straps and USB signals.
- **Original ESP32:** outputs/input GPIOs allowed here are 18, 19, 21, 22, 23, 25, 26, 27, 32 and 33; 34, 35, 36 and 39 are additional input-only choices and need external biasing/conversion. Flash signals, UART programming pins and boot-sensitive pins are excluded. Some otherwise usable chip pins are deliberately outside the project allowlist. A 30-pin clone may expose the same suggested GPIOs in different physical positions; use GPIO labels rather than copying the official 38-pin positions.
- **Pico:** the project permits GP0–22 and GP26–28. GPIOs 16 apart share a hardware PWM channel, so e.g. GP5 and GP21 cannot be independent outputs. Different channels of one slice, e.g. GP4 and GP5, are usable at the shared 50 Hz rate. USB does not consume GP0/GP1, but keep any separately used UART/peripheral pins free.

## Receiver level conversion and small parts

For each unique **confirmed 5 V PWM input**, use **4.7 kΩ** from receiver signal to the GPIO junction, and **6.8 kΩ** from that junction to common ground, both **1%**, 1/8 W or greater. This gives about **2.96 V at 5.0 V**. With a pulse high between 4.5 and 5.5 V and 1% resistor extremes, the calculated junction high is about 2.64–3.28 V. Confirm actual GPIO supply voltage, high threshold and waveform: calculation is not a substitute for checking the receiver.

```text
Receiver SIGNAL ── 4.7 kΩ ──┬──── input GPIO (3.3 V logic)
                           │
                         6.8 kΩ
                           │
Receiver GND ───────────────┴──── MCU GND ─── ESC signal GND
```

An already 3.3 V signal falls to about 1.95 V through that divider and may fail to register. The [C3 datasheet DC characteristics](https://www.espressif.com/sites/default/files/documentation/esp32-c3_datasheet_en.pdf) give a guaranteed high threshold of 0.75×VDD (2.475 V at VDD=3.3 V). A direct 3.3 V signal may be used only when its source and sequencing are compatible; for 3.3/5 V input flexibility prefer **SN74LVC1G17 at 3.3 V**, with **100 nF** local decoupling. A divider does not protect an unpowered MCU from back-powering; the input buffer's powered-down behavior must match the design. Do not use this divider for an HV/6 V/7.4 V signal. A single series resistor is not a level shifter.

Add a **10 kΩ pulldown on each MCU ESC output**. An optional **100–220 Ω output series resistor** can reduce ringing on a short signal wire; it does not turn a 3.3 V output into 5 V. If the ESC requires a 5 V high, use the AHCT buffer circuit in [wiring.md](wiring.md). Do not add another pulldown in parallel with the divider's 6.8 kΩ without recalculating its voltage.

For two mappings sharing one receiver input GPIO, use one input conversion circuit, not two dividers in parallel. Each ESC output still gets its own output wiring/buffer. Connect common grounds, keep ESC motor current out of signal wiring, and follow the power-source guidance in [wiring.md](wiring.md).
