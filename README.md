# ioBroker Heat Pump Modbus Adapter

Independent community adapter for local monitoring and control of compatible heat pumps using Modbus RTU.

Developed and maintained by **Helge Kaiser**.

## Current compatibility

The adapter was developed and tested on real hardware with:

- **SWD WP6 R290**
- Modbus RTU
- transparent TCP-to-RS485 gateway

The current device profile is based on the protocol and register behaviour verified on this system.

Heat pumps from other manufacturers using the same or a closely related controller and Modbus protocol may also work. Compatibility with those devices is not guaranteed until it has been verified on real hardware.

Reports about additional compatible models and firmware versions are welcome.

## Independent project

This is an independent open-source community project.

It is not an official product of SWD, Power World, or any other heat-pump manufacturer and is not affiliated with, endorsed by, or supported by those manufacturers.

Manufacturer and product names are mentioned only to describe tested or potentially compatible hardware.

## Connection

The adapter supports two Modbus RTU connection methods.

### TCP/IP to RS485 gateway

This is the currently verified connection method.

The gateway must operate as a transparent TCP-to-RS485 serial server.

Required settings:

- TCP Server mode
- 9600 baud
- 8 data bits
- parity: none
- 1 stop bit
- flow control: none
- protocol: none / transparent

The adapter sends complete Modbus RTU frames including CRC.
Do not enable Modbus TCP-to-RTU protocol conversion.

A Waveshare Ethernet-to-RS485 gateway has been used successfully during
development and is therefore a tested example. Equivalent transparent
TCP-to-RS485 gateways should also work.

For the tested Waveshare setup, an RS485 Conflict Time Gap of 5 ms is used.

### USB / Serial

Direct USB-to-RS485 adapters are supported through a Linux serial device,
for example `/dev/ttyUSB0` or `/dev/ttyACM0`.

The serial parameters are fixed:

- 9600 baud
- 8 data bits
- parity: none
- 1 stop bit
- no flow control

USB / Serial support is implemented and currently considered experimental.

## Bus safety

The heat-pump controller already communicates on the RS485 bus.

The adapter therefore uses conservative access:

- passive monitoring whenever possible
- active polling only as fallback
- bus-idle detection
- minimum spacing between active requests
- serialized Modbus requests
- serialized complete write operations
- read-before-write
- readback verification
- maximum of three write attempts
- no automatic repetition after a positively acknowledged write

## Main states

### Power

`device.power`

Values:

- `on`
- `off`
- `unknown`

### Operating mode

`operatingMode.setpoint`

Values:

- `hotWater`
- `heating`
- `cooling`
- `hotWaterHeating`
- `hotWaterCooling`

### Frequency mode

`frequencyMode.setpoint`

Values:

- `smart`
- `silent`
- `powerful`

### Vacation

`vacation.enabled`

Enables or disables vacation mode.

`vacation.setpoint`

Current vacation temperature setpoint.

The vacation setpoint is currently read-only because its safe writable range has not yet been verified.

### Temperature setpoints

Writable:

- `heating.setpoint`
- `cooling.setpoint`
- `hotWater.setpoint`

Verified ranges:

| State               |    Range |
| ------------------- | -------: |
| `heating.setpoint`  | 15–50 °C |
| `cooling.setpoint`  |  7–30 °C |
| `hotWater.setpoint` | 28–60 °C |

## Measurements

The adapter exposes available values including:

- outside temperature
- flow temperature
- return temperature
- tank temperature
- evaporator temperature
- suction and discharge gas temperatures
- compressor frequency
- compressor current
- fan speeds
- pump speed
- water flow
- pressure
- mains voltage
- total current
- electrical power

## Faults

Useful fault information is exposed through:

- `fault.active`
- `fault.codes`
- `fault.messages`

Low-level values used mainly for troubleshooting are located below:

`diagnostics.*`

## Verified writable functions

The following functions were tested on the real SWD WP6 R290 used during development:

- controller power
- operating mode
- Smart / Silent / Powerful frequency mode
- vacation mode
- heating setpoint
- cooling setpoint
- hot-water setpoint

## Compatibility reports

If another heat pump uses the same controller or Modbus register layout, please report:

- manufacturer
- model
- controller / firmware version
- which readings work
- which writable functions were successfully tested

This will allow additional device profiles and confirmed compatibility information to be added later.

## Disclaimer

Use of this software and writable Modbus functions is at your own risk.

Incorrect values or commands may affect heating, cooling, hot-water production or other heat-pump functions.

Always verify compatibility before enabling writable functions on an untested model.

## License

MIT License

Copyright © 2026 Helge Kaiser
