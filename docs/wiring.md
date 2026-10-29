# Wiring the receiver, limiter and ESC

## What is being limited?

An RC receiver's three-wire channel normally has ground, receiver supply (often 5 V), and a separate pulsed signal. A 5 V receiver supply does **not** establish its signal voltage: measure signal-to-ground with an oscilloscope or check its datasheet. Wire colors vary; use connector labels.

A conventional RC ESC receives pulse width commands, typically around 1000–2000 µs, often with 1500 µs neutral for bidirectional operation. The limiter measures those pulses and generates new pulses with reduced excursion around stop. It does not lower the ESC battery voltage or its motor current directly. A resistor in the signal wire will not provide a useful throttle limit. The [Pololu interface guide](https://www.pololu.com/blog/16/electrical-characteristics-of-servos-and-introduction-to-the-servo-control-interface) explains the pulse interface; confirm the exact ESC manual.

See [board layouts and suggested pins](board-layouts.md) for Pico, original ESP32 DevKit, C3 Super Mini and C3 DevKitM-1 header positions and build targets. C3 supports USB plus BLE UART.

## Signal path and common ground

```text
Receiver channel SIGNAL ── input level conversion ── Pico GP4 / ESP32 GPIO27
                                                       │ firmware limits
ESC SIGNAL ◄── optional 3.3→5 V buffer ◄── Pico GP5 / ESP32 GPIO25

Receiver GND ───────────── board GND ──────────────── ESC signal GND
```

The receiver's signal connects **only to the limiter input**, and the ESC signal connects **only to the limiter output**. Remove the direct receiver-to-ESC signal connection. Two signal drivers must never drive the ESC wire together. Keep signal wires short and route each alongside a ground wire, away from motor phase wiring. Add a 10 kΩ pulldown from the MCU output GPIO to ground so it stays low while the board boots or is unpowered; verify that the ESC stops on absent pulses.

The following default Pico positions refer to the standard Pico's 40-pin header, viewed using its official pinout. For ESP32, header positions differ by DevKit vendor.

| Connection | Standard Pico GPIO / physical pin | ESP32 DevKit GPIO |
|---|---|---|
| Receiver signal after level conversion | GP4 / pin 6 | GPIO27 |
| ESC signal before optional output buffer | GP5 / pin 7 | GPIO25 |
| Common signal ground | GND / pin 8, or another GND | GND |
| 3.3 V buffer supply | 3V3(OUT) / pin 36 | 3V3 |

Changing GPIO mapping in the app does not move the physical wire. Disarm, disconnect motor power, apply/save the new settings, power down, move the wires, then retest. The old output is driven low on remap.

### Multiple mapped channels

Repeat the input level-conversion circuit for each unique receiver signal, and the output circuit for each ESC that requires it. All receivers, converters, MCU and ESC signal grounds share a common reference. Keep positive supply rails separate as described below; adding ESCs does not make their BEC outputs safe to parallel.

Suggested additional pairs are Pico GP6→GP7, GP8→GP9, GP10→GP11, or ESP32 GPIO26→GPIO33, GPIO32→GPIO18, GPIO19→GPIO21. The default pair remains the first mapping. Configure only channels that are actually wired. Any missing/invalid mapped input disarms every output.

For one receiver signal driving two ESCs, assign the same input GPIO to both mappings and different output GPIOs; firmware shares one input interrupt and applies each mapping's limits independently. Do not tie two ESC output GPIOs together, and do not assign an output GPIO as another channel's receiver input. On Pico, outputs whose GPIO numbers differ by 16 share a PWM slice/channel and are rejected; two different channels of the same slice (such as GP4 and GP5) are supported at the common 50 Hz rate. See the [Pico SDK PWM reference](https://www.raspberrypi.com/documentation/pico-sdk/hardware.html#hardware_pwm).

## Receiver 5 V signal → 3.3 V GPIO

Treat Pico, original ESP32 and ESP32-C3 GPIOs as **3.3 V only**. Do not connect a measured 5 V signal directly. GPIO supply/absolute maximum ratings appear in the [RP2040 datasheet](https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf) and [ESP32 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf).

**Preferred circuit: SN74LVC1G17 Schmitt buffer powered at 3.3 V.** Its input accepts up to 5.5 V and it supports partial power-down isolation; this makes it a suitable choice for a receiver that remains powered while the MCU is off. Use the exact chip's datasheet and package pinout, not the similarly named AHCT part.

```text
                        SN74LVC1G17
Receiver SIGNAL ──────── A          Y ───────── MCU input GPIO
Board 3V3 ────────────── VCC
Common GND ──────────── GND
                        │
            100 nF between VCC and GND, at the IC
```

Power it from the MCU's regulated 3.3 V rail. A 47 kΩ pulldown on A can define its state when the receiver cable is removed. Confirm measured signal peaks, including overshoot, stay within the recommended input range. The [TI datasheet](https://www.ti.com/lit/ds/symlink/sn74lvc1g17.pdf) specifies its voltage tolerance, thresholds, decoupling and Ioff behavior. Check whether a breakout board adds circuitry that changes these properties.

**Simple divider option, only for a confirmed approximately 5 V signal and matched power sequencing:**

```text
Receiver SIGNAL ── 4.7 kΩ ─┬──────── MCU input GPIO
                          │
                         6.8 kΩ
                          │
Common GND ────────────────┴──────── MCU GND
```

Use **4.7 kΩ series / 6.8 kΩ to ground**, 1% resistors, rated at least 1/8 W. Nominal output is `Vin × 6.8/(4.7+6.8)` = **2.96 V at 5.0 V**. For a confirmed 4.5–5.5 V pulse high, including 1% resistor extremes, the calculated junction high is approximately 2.64–3.28 V. Check actual source voltage, MCU supply/high threshold and cable capacitance. A 3.3 V signal becomes about 1.95 V and may not register. Do not use it blindly on receivers that already output 3.0–3.3 V. The former 10 kΩ / 15 kΩ option gives 3.0 V at 5.0 V but exceeds 3.3 V nominal at some 5.5 V/tolerance extremes; the 4.7 kΩ / 6.8 kΩ pair provides more margin. Do not parallel another input pulldown without recalculating the ratio.

A divider does not isolate an unpowered MCU and can feed current into protection structures. Prefer the powered-down-tolerant buffer when supplies can turn on independently. Neither circuit above is specified for a 6 V/7.4 V/HV signal. Measure/check the signal separately from an HV receiver's supply and select a translator rated for the actual waveform. An oscilloscope is needed to check pulse shape and peaks; a multimeter averages pulses and cannot establish logic-high voltage.

An optional **100–220 Ω series resistor on the MCU ESC output** may reduce ringing; it does not perform voltage conversion or set a throttle limit. Keep the separate 10 kΩ output pulldown.

## MCU 3.3 V output → ESC input

Some ESCs accept 3.3 V logic directly. Confirm this in its manual or by threshold measurement rather than assuming all ESCs behave the same. If confirmed, connect output GPIO to ESC signal with common ground.

For an ESC that needs a 5 V logic high, use **SN74AHCT1G125**, powered from a regulated 5 V supply (4.5–5.5 V per its datasheet). Its TTL input thresholds allow a 3.3 V MCU to drive it. An HC-family device powered at 5 V does not necessarily have suitable thresholds.

```text
                       SN74AHCT1G125
MCU output GPIO ─────── A            Y ─────── ESC SIGNAL
Common GND ─────────── /OE
Regulated 5 V ──────── VCC
Common GND ─────────── GND
                       100 nF from VCC to GND, at the IC

MCU output GPIO ── 10 kΩ ── GND  (defined low at startup)
```

This is a non-inverting output buffer with /OE held low (enabled). Select the physical pins from the specific package datasheet. Use one power domain with controlled sequencing; do not assume this AHCT part has the same powered-down isolation as the LVC input buffer. For independently switched supplies, select a translator explicitly rated for that sequencing. See [TI's AHCT datasheet](https://www.ti.com/lit/ds/symlink/sn74ahct1g125.pdf).

## Supplying power without joining two 5 V sources

Start with the MCU powered from USB and the receiver/ESC from their normal supply, connecting grounds and the signal conversion circuits. Keep the MCU positive USB rail separate from the BEC positive rail during these initial tests. USB ground is still connected through the common ground path.

- The ESC battery stays wired through the ESC as its manufacturer specifies. The limiter is never inserted into the motor phase wires or main battery-current path.
- If the ESC has a BEC, its red wire can supply the receiver, if voltage and current are appropriate. Some ESCs have no BEC; use a suitable external receiver supply. Use one positive source on a receiver bus. Do not parallel multiple BEC outputs.
- Never put 5 V into a Pico/ESP32 **3V3** pin or any GPIO.
- For a standard Pico, an external regulated supply can feed **VSYS**, within the board's documented range. When also using USB, follow Raspberry Pi's power OR-ing guidance: put an external Schottky diode in the BEC-to-VSYS path; the Pico already has a diode in its VBUS-to-VSYS path. Diode anode faces the external positive supply, cathode faces VSYS. Check current rating, voltage drop and supply range. Do not connect BEC directly to VBUS. See the [Pico board documentation](https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html) and [Pico datasheet, powering section](https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf).
- ESP32 DevKit boards vary in their regulator and USB wiring. Feed only a documented 5 V/VIN input when the exact board supports it. Unplug USB or use a verified power-selection/OR-ing circuit unless its schematic explicitly permits simultaneous USB and external power. Do not assume every pin called VIN takes 5 V or has reverse-current protection. The [Espressif DevKitC guide](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html) describes that board's mutually exclusive power options.
- Keep receiver and MCU supplies stable under motor load. Use appropriate local decoupling, strain relief and connectors. Brownout or loss of MCU power can remove the output waveform; the ESC's own loss-of-signal stop must be tested.

If the limiter loses power, the ESC decides how to react to missing pulses. Firmware cannot enforce a limit on an unpowered board, failed output stage, or stalled system. Keep a physical motor-power cutoff accessible and validate the ESC and receiver failsafes before use.
