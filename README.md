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

## Safety and liability

> [!CAUTION]
> **USE AT YOUR OWN RISK.**
>
> This adapter communicates with heating equipment and can modify operating
> modes, setpoints and other device settings.
>
> Incorrect wiring, configuration, incompatible hardware, software errors or
> unintended write operations may cause malfunction, loss of heating or hot
> water, overheating, increased energy consumption, damage to the heat pump or
> connected equipment and, in extreme cases, consequential damage including
> fire, property damage, serious injury or death.
>
> No guarantee is given for compatibility, correctness, availability or safe
> operation with any particular installation.
>
> The software is provided "as is", without warranty. Use is at your own risk.
> Liability is limited to the maximum extent permitted by applicable law.
> Nothing in this notice excludes liability where exclusion is prohibited by
> applicable law.
>
> Manufacturer documentation, electrical safety regulations and all protective
> functions of the heat pump always take precedence over this documentation.
> Electrical work and modifications to heating equipment must only be carried
> out by suitably qualified persons.

## RS485 connection

> [!WARNING]
> **Do not connect the adapter to the RS485 connection used by the display or
> remote controller.**
>
> The connection described below is the internal RS485 bus observed on the
> tested SWD WP6 R290 built in 2026.
>
> Wiring, connector type and signal assignment may differ on other production
> years, controller revisions or related heat-pump models. Always verify the
> wiring of the specific unit before making a connection.

### Main controller connection

On the tested SWD WP6 R290 built in 2026, the internal RS485 connection is
available at the main controller connector shown below.

![Internal RS485 connection on the main controller](docs/images/rs485-mainboard.jpg)

The tested wiring uses:

- **Yellow and green:** the two RS485 data lines A and B
- **Black:** GND
- **GND is optional** for the tested setup and was not connected during
  successful operation

The exact assignment of **yellow/green to A/B is intentionally not specified
here**. Verify the A/B assignment on the particular unit before connecting the
adapter.

Do not rely solely on wire colours, because wiring may differ between
production revisions.

### Internal cable splice / service connector

On the tested unit there is also an internal splice in the cable harness leading
to the connector shown below. The RS485 data lines can be accessed there.

![Internal RS485 splice / service connector](docs/images/rs485-splice.jpg)

This connection arrangement was observed on an **SWD WP6 R290 built in 2026**.
It may not exist, or may be wired differently, on other production versions.

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

## ioBroker states

`R` means read-only.  
`RW` means read and write.

> [!WARNING]
> Writable states directly influence the heat pump.
> Only use `RW` states when the connected model and register mapping have been
> verified. Incorrect values or commands can cause malfunction or damage.

### Control and setpoints

| State                    | Access | Description                   | Values / range                                                         |
| ------------------------ | :----: | ----------------------------- | ---------------------------------------------------------------------- |
| `device.power`           |   RW   | Controller power state        | `on`, `off`                                                            |
| `operatingMode.setpoint` |   RW   | Operating mode                | `hotWater`, `heating`, `cooling`, `hotWaterHeating`, `hotWaterCooling` |
| `frequencyMode.setpoint` |   RW   | Compressor operating strategy | `smart`, `silent`, `powerful`                                          |
| `vacation.enabled`       |   RW   | Vacation mode                 | `true`, `false`                                                        |
| `vacation.setpoint`      |   R    | Vacation temperature setpoint | °C; currently read-only                                                |
| `heating.setpoint`       |   RW   | Heating setpoint              | 15–50 °C                                                               |
| `cooling.setpoint`       |   RW   | Cooling setpoint              | 7–30 °C                                                                |
| `hotWater.setpoint`      |   RW   | Domestic hot-water setpoint   | 28–60 °C                                                               |

### Temperatures

| State                               | Access | Description                              | Unit |
| ----------------------------------- | :----: | ---------------------------------------- | ---- |
| `temperature.inlet`                 |   R    | Inlet water temperature / return         | °C   |
| `temperature.outlet`                |   R    | Outlet water temperature / flow          | °C   |
| `temperature.tank`                  |   R    | Tank temperature                         | °C   |
| `temperature.outside`               |   R    | Outside temperature                      | °C   |
| `temperature.suctionGas`            |   R    | Suction gas temperature                  | °C   |
| `temperature.evaporator`            |   R    | Evaporator / external coil temperature   | °C   |
| `temperature.innerCoil`             |   R    | Inner coil temperature                   | °C   |
| `temperature.exhaustGas`            |   R    | Discharge / exhaust gas temperature      | °C   |
| `temperature.heatSink`              |   R    | Inverter heat-sink temperature           | °C   |
| `temperature.lowPressureConversion` |   R    | Temperature calculated from low pressure | °C   |

### Compressor, fan and pump

| State                        | Access | Description                                        | Unit |
| ---------------------------- | :----: | -------------------------------------------------- | ---- |
| `compressor.frequency`       |   R    | Actual compressor frequency                        | Hz   |
| `compressor.targetFrequency` |   R    | Compressor target frequency reported by controller | Hz   |
| `compressor.current`         |   R    | Compressor current                                 | A    |
| `fan.speed1`                 |   R    | Fan 1 speed                                        | rpm  |
| `fan.speed2`                 |   R    | Fan 2 speed                                        | rpm  |
| `pump.speed`                 |   R    | Actual water-pump speed                            | %    |
| `pump.targetSpeed`           |   R    | Water-pump target speed reported by controller     | %    |

`pump.targetSpeed` is not the actual pump speed. For example, the controller may
report a target of 100 % while `pump.speed` shows the actual pump running at a
much lower speed.

### Hydraulic, pressure and electrical values

| State                      | Access | Description                              | Unit |
| -------------------------- | :----: | ---------------------------------------- | ---- |
| `water.flow`               |   R    | Water flow                               | m³/h |
| `pressure.low`             |   R    | Refrigerant low pressure                 | bar  |
| `expansionValve.main`      |   R    | Main electronic expansion-valve position | P    |
| `expansionValve.auxiliary` |   R    | Auxiliary expansion-valve position       | P    |
| `electrical.dcBusVoltage`  |   R    | DC bus voltage                           | V    |
| `electrical.voltage`       |   R    | Mains voltage                            | V    |
| `electrical.current`       |   R    | Total machine current                    | A    |
| `electrical.power`         |   R    | Total electrical power                   | W    |

### Output states

These states report whether the controller is requesting or switching an output.
They do not independently prove that the connected component is electrically
energized or operating correctly.

| State                       | Access | Description                                     |
| --------------------------- | :----: | ----------------------------------------------- |
| `output.compressor`         |   R    | Compressor output                               |
| `output.fanMotor`           |   R    | Fan motor output                                |
| `output.fourWayValve`       |   R    | Refrigerant four-way valve output               |
| `output.chassisHeater`      |   R    | Chassis / base heater output                    |
| `output.acElectricHeater`   |   R    | Additional space-heating electric heater output |
| `output.threeWayValve`      |   R    | Hydraulic three-way valve output                |
| `output.tankElectricHeater` |   R    | Domestic hot-water tank electric heater output  |
| `output.circulationPump`    |   R    | External circulation-pump output                |
| `output.crankcaseHeater`    |   R    | Compressor crankcase-heater output              |

### Status, faults and diagnostics

| State                           | Access | Description                               |
| ------------------------------- | :----: | ----------------------------------------- |
| `status.defrosting`             |   R    | Defrost cycle active                      |
| `fault.active`                  |   R    | At least one detected fault is active     |
| `fault.codes`                   |   R    | Detected fault codes                      |
| `fault.messages`                |   R    | Human-readable fault information          |
| `diagnostics.rawWorkingStatus`  |   R    | Raw controller working-status word        |
| `diagnostics.rawOutputFlags1`   |   R    | Raw output-flags word 1                   |
| `diagnostics.rawOutputFlags2`   |   R    | Raw output-flags word 2                   |
| `diagnostics.rawOutputFlags3`   |   R    | Raw output-flags word 3                   |
| `diagnostics.rawFaultFlags`     |   R    | Raw fault flags                           |
| `diagnostics.forceFallbackPoll` |   W    | Trigger one manual fallback polling cycle |

### Adapter status

| State             | Access | Description                        |
| ----------------- | :----: | ---------------------------------- |
| `info.connection` |   R    | Adapter transport connection state |

## Compatibility reports

If another heat pump uses the same controller or Modbus register layout, please report:

- manufacturer
- model
- controller / firmware version
- which readings work
- which writable functions were successfully tested

This will allow additional device profiles and confirmed compatibility information to be added later.

## Changelog

### 0.0.1

- Initial public development version
- Modbus RTU monitoring via transparent TCP-to-RS485 gateway
- Experimental direct USB-to-RS485 support
- Passive bus monitoring with conservative active fallback polling
- Verified monitoring and writable functions for the tested SWD WP6 R290
- RS485 connection and safety documentation

## License

MIT License

Copyright (c) 2026 Helge Kaiser
