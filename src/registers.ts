export type RegisterAccess = 'r' | 'rw';

export type StateValue = number | boolean | string;

export interface RegisterDefinition {
	id: string;
	address: number;
	access: RegisterAccess;

	name: string;
	type: 'number' | 'boolean' | 'string';
	role: string;
	unit?: string;

	min?: number;
	max?: number;

	/**
	 * Bit mask for values stored inside a shared 16-bit register.
	 */
	mask?: number;

	/**
	 * Raw register value is signed 16-bit.
	 */
	signed?: boolean;

	/**
	 * Simple numeric scaling.
	 */
	factor?: number;

	/**
	 * Optional custom decoder.
	 */
	decode?: (raw: number) => StateValue;

	/**
	 * Allowed values for writable enum/string states.
	 */
	writeValues?: readonly StateValue[];

	/**
	 * Optional custom encoder for writable states.
	 */
	encode?: (value: StateValue, currentRaw: number) => number;

	/**
	 * Writing requires a previously passively received full register value.
	 */
	requiresRaw?: boolean;
}

function signed16(value: number): number {
	return value & 0x8000 ? value - 0x10000 : value;
}

function numeric(raw: number, definition: RegisterDefinition): number {
	const value = definition.signed ? signed16(raw) : raw;
	const factor = definition.factor ?? 1;
	const scaled = value * factor;

	if (factor === 0.1) {
		return Math.round(scaled * 10) / 10;
	}

	if (factor === 0.01) {
		return Math.round(scaled * 100) / 100;
	}

	return scaled;
}

export function decodeRegisterValue(definition: RegisterDefinition, raw: number): StateValue {
	if (definition.decode) {
		return definition.decode(raw);
	}

	if (definition.mask !== undefined) {
		return (raw & definition.mask) !== 0;
	}

	return numeric(raw, definition);
}

/**
 * Central definition of all directly mapped states.
 *
 * There must be no second register table elsewhere in the adapter.
 */
export const registers: readonly RegisterDefinition[] = [
	// ---------------------------------------------------------------------
	// Diagnostics / status registers
	// ---------------------------------------------------------------------

	{
		id: 'diagnostics.rawWorkingStatus',
		address: 0x0003,
		access: 'r',
		name: 'Raw working status',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},
	{
		id: 'diagnostics.rawOutputFlags1',
		address: 0x0004,
		access: 'r',
		name: 'Raw output flags 1',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},
	{
		id: 'diagnostics.rawOutputFlags2',
		address: 0x0005,
		access: 'r',
		name: 'Raw output flags 2',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},
	{
		id: 'diagnostics.rawOutputFlags3',
		address: 0x0006,
		access: 'r',
		name: 'Raw output flags 3',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},

	{
		id: 'diagnostics.rawFaultFlag1',
		address: 0x0007,
		access: 'r',
		name: 'Raw fault flag 1',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},
	{
		id: 'diagnostics.rawFaultFlag2',
		address: 0x0008,
		access: 'r',
		name: 'Raw fault flag 2',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},
	{
		id: 'diagnostics.rawFaultFlag3',
		address: 0x0009,
		access: 'r',
		name: 'Raw fault flag 3',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},
	{
		id: 'diagnostics.rawFaultFlag4',
		address: 0x000a,
		access: 'r',
		name: 'Raw fault flag 4',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},
	{
		id: 'diagnostics.rawFaultFlag5',
		address: 0x000b,
		access: 'r',
		name: 'Raw fault flag 5',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},
	{
		id: 'diagnostics.rawFaultFlag6',
		address: 0x000c,
		access: 'r',
		name: 'Raw fault flag 6',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},
	{
		id: 'diagnostics.rawFaultFlag7',
		address: 0x000d,
		access: 'r',
		name: 'Raw fault flag 7',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},
	{
		id: 'diagnostics.rawInverterFaultLow',
		address: 0x001f,
		access: 'r',
		name: 'Raw inverter fault low 8 bits',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},
	{
		id: 'diagnostics.rawInverterFaultHigh',
		address: 0x0020,
		access: 'r',
		name: 'Raw inverter fault high 8 bits',
		type: 'number',
		role: 'value',
		min: 0,
		max: 0xffff,
	},

	// ---------------------------------------------------------------------
	// Working status
	// ---------------------------------------------------------------------

	{
		id: 'status.defrosting',
		address: 0x0003,
		access: 'r',
		name: 'Defrosting',
		type: 'boolean',
		role: 'indicator',
		mask: 0x0080,
	},

	// ---------------------------------------------------------------------
	// Outputs
	// ---------------------------------------------------------------------

	{
		id: 'output.compressor',
		address: 0x0004,
		access: 'r',
		name: 'Compressor output',
		type: 'boolean',
		role: 'indicator',
		mask: 0x0001,
	},
	{
		id: 'output.fanMotor',
		address: 0x0004,
		access: 'r',
		name: 'Fan motor output',
		type: 'boolean',
		role: 'indicator',
		mask: 0x0020,
	},
	{
		id: 'output.fourWayValve',
		address: 0x0004,
		access: 'r',
		name: 'Four-way valve output',
		type: 'boolean',
		role: 'indicator',
		mask: 0x0040,
	},
	{
		id: 'output.chassisHeater',
		address: 0x0005,
		access: 'r',
		name: 'Chassis heater output',
		type: 'boolean',
		role: 'indicator',
		mask: 0x0001,
	},
	{
		id: 'output.acElectricHeater',
		address: 0x0005,
		access: 'r',
		name: 'AC electric heater output',
		type: 'boolean',
		role: 'indicator',
		mask: 0x0020,
	},
	{
		id: 'output.threeWayValve',
		address: 0x0005,
		access: 'r',
		name: 'Three-way valve output',
		type: 'boolean',
		role: 'indicator',
		mask: 0x0040,
	},
	{
		id: 'output.tankElectricHeater',
		address: 0x0005,
		access: 'r',
		name: 'Tank electric heater output',
		type: 'boolean',
		role: 'indicator',
		mask: 0x0080,
	},
	{
		id: 'output.circulationPump',
		address: 0x0006,
		access: 'r',
		name: 'Circulation pump output',
		type: 'boolean',
		role: 'indicator',
		mask: 0x0001,
	},
	{
		id: 'output.crankcaseHeater',
		address: 0x0006,
		access: 'r',
		name: 'Crankcase heater output',
		type: 'boolean',
		role: 'indicator',
		mask: 0x0002,
	},

	// ---------------------------------------------------------------------
	// Temperatures
	// ---------------------------------------------------------------------

	{
		id: 'temperature.inlet',
		address: 0x000e,
		access: 'r',
		name: 'Inlet water temperature',
		type: 'number',
		role: 'value.temperature',
		unit: '°C',
		signed: true,
		factor: 0.1,
	},
	{
		id: 'temperature.tank',
		address: 0x000f,
		access: 'r',
		name: 'Water tank temperature',
		type: 'number',
		role: 'value.temperature',
		unit: '°C',
		signed: true,
		factor: 0.1,
	},
	{
		id: 'temperature.outside',
		address: 0x0011,
		access: 'r',
		name: 'Outside temperature',
		type: 'number',
		role: 'value.temperature',
		unit: '°C',
		signed: true,
		factor: 0.5,
	},
	{
		id: 'temperature.outlet',
		address: 0x0012,
		access: 'r',
		name: 'Outlet water temperature',
		type: 'number',
		role: 'value.temperature',
		unit: '°C',
		signed: true,
		factor: 0.1,
	},
	{
		id: 'temperature.suctionGas',
		address: 0x0015,
		access: 'r',
		name: 'Suction gas temperature',
		type: 'number',
		role: 'value.temperature',
		unit: '°C',
		signed: true,
		factor: 0.5,
	},
	{
		id: 'temperature.evaporator',
		address: 0x0016,
		access: 'r',
		name: 'External coil temperature',
		type: 'number',
		role: 'value.temperature',
		unit: '°C',
		signed: true,
		factor: 0.5,
	},
	{
		id: 'temperature.innerCoil',
		address: 0x001a,
		access: 'r',
		name: 'Inner coil temperature',
		type: 'number',
		role: 'value.temperature',
		unit: '°C',
		signed: true,
		factor: 0.5,
	},
	{
		id: 'temperature.exhaustGas',
		address: 0x001b,
		access: 'r',
		name: 'Exhaust gas temperature',
		type: 'number',
		role: 'value.temperature',
		unit: '°C',
		signed: true,
	},

	// ---------------------------------------------------------------------
	// Compressor / fan / pump / pressure
	// ---------------------------------------------------------------------

	{
		id: 'expansionValve.main',
		address: 0x001c,
		access: 'r',
		name: 'Main expansion valve opening',
		type: 'number',
		role: 'value',
	},
	{
		id: 'expansionValve.auxiliary',
		address: 0x001d,
		access: 'r',
		name: 'Auxiliary expansion valve opening',
		type: 'number',
		role: 'value',
	},
	{
		id: 'compressor.frequency',
		address: 0x001e,
		access: 'r',
		name: 'Compressor frequency',
		type: 'number',
		role: 'value.frequency',
		unit: 'Hz',
	},
	{
		id: 'electrical.dcBusVoltage',
		address: 0x0021,
		access: 'r',
		name: 'DC bus voltage',
		type: 'number',
		role: 'value.voltage',
		unit: 'V',
	},
	{
		id: 'compressor.current',
		address: 0x0023,
		access: 'r',
		name: 'Compressor current',
		type: 'number',
		role: 'value.current',
	},
	{
		id: 'compressor.targetFrequency',
		address: 0x0024,
		access: 'r',
		name: 'Compressor target frequency',
		type: 'number',
		role: 'value.frequency',
		unit: 'Hz',
	},
	{
		id: 'fan.speed1',
		address: 0x0026,
		access: 'r',
		name: 'DC fan 1 speed',
		type: 'number',
		role: 'value',
	},
	{
		id: 'fan.speed2',
		address: 0x0027,
		access: 'r',
		name: 'DC fan 2 speed',
		type: 'number',
		role: 'value',
	},
	{
		id: 'temperature.lowPressureConversion',
		address: 0x0028,
		access: 'r',
		name: 'Low pressure conversion temperature',
		type: 'number',
		role: 'value.temperature',
		unit: '°C',
		signed: true,
		factor: 0.1,
	},
	{
		id: 'pump.speed',
		address: 0x002a,
		access: 'r',
		name: 'DC water pump speed',
		type: 'number',
		unit: '%',
		factor: 0.1,
		role: 'value',
	},
	{
		id: 'pressure.low',
		address: 0x002b,
		access: 'r',
		name: 'Low pressure',
		type: 'number',
		role: 'value.pressure',
		unit: 'bar',
		factor: 0.01,
	},
	{
		id: 'temperature.heatSink',
		address: 0x0022,
		access: 'r',
		name: 'Heat sink temperature',
		type: 'number',
		role: 'value.temperature',
		unit: '°C',
		signed: true,
	},
	{
		id: 'pump.targetSpeed',
		address: 0x002f,
		access: 'r',
		name: 'DC water pump target speed',
		type: 'number',
		role: 'value',
		unit: '%',
	},
	{
		id: 'water.flow',
		address: 0x0030,
		access: 'r',
		name: 'Water flow',
		type: 'number',
		role: 'value',
		unit: 'm³/h',
		factor: 0.01,
	},
	{
		id: 'electrical.voltage',
		address: 0x0031,
		access: 'r',
		name: 'Supply voltage',
		type: 'number',
		role: 'value.voltage',
		unit: 'V',
	},
	{
		id: 'electrical.current',
		address: 0x0032,
		access: 'r',
		name: 'Supply current',
		type: 'number',
		role: 'value.current',
		unit: 'A',
		factor: 0.1,
	},
	{
		id: 'electrical.totalPower',
		address: 0x0035,
		access: 'r',
		name: 'Total operating power',
		type: 'number',
		role: 'value.power',
		unit: 'W',
	},

	{
		id: 'electrical.power',
		address: 0x002e,
		access: 'r',
		name: 'Compressor operating power',
		type: 'number',
		role: 'value.power',
	},

	// ---------------------------------------------------------------------
	// Main controls
	// ---------------------------------------------------------------------
	{
		id: 'device.power',
		address: 0x003f,
		access: 'rw',
		name: 'Heat pump power',
		type: 'boolean',
		role: 'switch',
		writeValues: [false, true],
		requiresRaw: true,
		decode: raw => (raw & 0x0001) !== 0,
		encode: (value, currentRaw) => (value === true ? currentRaw | 0x0001 : currentRaw & ~0x0001),
	},

	{
		id: 'frequencyMode.setpoint',
		address: 0x0040,
		access: 'rw',
		name: 'Frequency mode',
		type: 'string',
		role: 'level.mode',
		decode: (raw: number): StateValue => {
			const powerful = (raw & 0x0010) !== 0;
			const silent = (raw & 0x0020) !== 0;

			if (powerful && !silent) {
				return 'powerful';
			}

			if (silent && !powerful) {
				return 'silent';
			}

			if (!powerful && !silent) {
				return 'smart';
			}

			return 'unknown';
		},
		requiresRaw: true,
		writeValues: ['smart', 'powerful', 'silent'],
		encode: (value: StateValue, currentRaw: number): number => {
			const base = currentRaw & ~0x0030;

			switch (value) {
				case 'smart':
					return base;
				case 'powerful':
					return base | 0x0010;
				case 'silent':
					return base | 0x0020;
				default:
					throw new Error(`Invalid frequency mode: ${String(value)}`);
			}
		},
	},

	{
		id: 'vacation.enabled',
		address: 0x0041,
		access: 'rw',
		name: 'Vacation mode',
		type: 'boolean',
		role: 'switch',
		mask: 0x0002,
	},

	{
		id: 'operatingMode.setpoint',
		address: 0x0043,
		access: 'rw',
		name: 'Operating mode',
		type: 'string',
		role: 'level.mode',
		decode: (raw: number): StateValue => {
			switch (raw) {
				case 0:
					return 'hotWater';
				case 1:
					return 'heating';
				case 2:
					return 'cooling';
				case 3:
					return 'hotWaterHeating';
				case 4:
					return 'hotWaterCooling';
				default:
					return 'unknown';
			}
		},
		writeValues: ['hotWater', 'heating', 'cooling', 'hotWaterHeating', 'hotWaterCooling'],
		encode: (value: StateValue): number => {
			switch (value) {
				case 'hotWater':
					return 0;
				case 'heating':
					return 1;
				case 'cooling':
					return 2;
				case 'hotWaterHeating':
					return 3;
				case 'hotWaterCooling':
					return 4;
				default:
					throw new Error(`Invalid operating mode: ${String(value)}`);
			}
		},
	},

	{
		id: 'hotWater.setpoint',
		address: 0x00be,
		access: 'rw',
		name: 'Hot water setpoint',
		type: 'number',
		role: 'level.temperature',
		unit: '°C',
		min: 28,
		max: 60,
	},
	{
		id: 'cooling.setpoint',
		address: 0x00bf,
		access: 'rw',
		name: 'Cooling setpoint',
		type: 'number',
		role: 'level.temperature',
		unit: '°C',
		min: 7,
		max: 30,
	},
	{
		id: 'heating.setpoint',
		address: 0x00c0,
		access: 'rw',
		name: 'Heating setpoint',
		type: 'number',
		role: 'level.temperature',
		unit: '°C',
		min: 15,
		max: 50,
	},

	{
		id: 'vacation.setpoint',
		address: 0x00d0,
		access: 'rw',
		name: 'Vacation setpoint',
		type: 'number',
		role: 'level.temperature',
		unit: '°C',
		min: 15,
		max: 50,
	},

	// ---------------------------------------------------------------------
	// DC / PWM circulation pump parameters
	// ---------------------------------------------------------------------

	{
		id: 'pump.constantTemperatureMode',
		address: 0x015b,
		access: 'rw',
		name: 'Water pump constant temperature operation mode',
		type: 'string',
		role: 'level.mode',
		decode: (raw: number): StateValue => {
			switch (raw) {
				case 0:
					return 'intermittent';
				case 1:
					return 'continuous';
				case 2:
					return 'stop';
				default:
					return 'unknown';
			}
		},
		writeValues: ['intermittent', 'continuous', 'stop'],
		encode: (value: StateValue): number => {
			switch (value) {
				case 'intermittent':
					return 0;
				case 'continuous':
					return 1;
				case 'stop':
					return 2;
				default:
					throw new Error(`Invalid constant temperature pump mode: ${String(value)}`);
			}
		},
	},
	{
		id: 'pump.constantTemperatureCycle',
		address: 0x015c,
		access: 'rw',
		name: 'Water pump constant temperature start and stop cycle',
		type: 'number',
		role: 'level',
		unit: 'min',
		min: 1,
		max: 120,
	},

	{
		id: 'pump.mode',
		address: 0x015f,
		access: 'rw',
		name: 'DC water pump mode',
		type: 'string',
		role: 'level.mode',
		decode: (raw: number): StateValue => {
			switch (raw) {
				case 0:
					return 'disabled';
				case 1:
					return 'automatic';
				case 2:
					return 'manual';
				default:
					return 'unknown';
			}
		},
		writeValues: ['disabled', 'automatic', 'manual'],
		encode: (value: StateValue): number => {
			switch (value) {
				case 'disabled':
					return 0;
				case 'automatic':
					return 1;
				case 'manual':
					return 2;
				default:
					throw new Error(`Invalid pump mode: ${String(value)}`);
			}
		},
	},
	{
		id: 'pump.adjustmentCycle',
		address: 0x0160,
		access: 'rw',
		name: 'DC water pump adjustment cycle',
		type: 'number',
		role: 'level',
		unit: 's',
		min: 10,
		max: 100,
	},
	{
		id: 'pump.manualSpeed',
		address: 0x0161,
		access: 'rw',
		name: 'DC water pump manual speed',
		type: 'number',
		role: 'level',
		unit: '%',
		min: 10,
		max: 100,
	},
	{
		id: 'pump.maxSpeed',
		address: 0x0162,
		access: 'rw',
		name: 'DC water pump maximum speed',
		type: 'number',
		role: 'level',
		unit: '%',
	},
	{
		id: 'pump.minSpeed',
		address: 0x0163,
		access: 'rw',
		name: 'DC water pump minimum speed',
		type: 'number',
		role: 'level',
		unit: '%',
		min: 10,
		max: 100,
	},
	{
		id: 'pump.adjustmentStep',
		address: 0x0164,
		access: 'rw',
		name: 'DC water pump adjustment speed',
		type: 'number',
		role: 'level',
	},
	{
		id: 'pump.pwmFrequencyType',
		address: 0x0165,
		access: 'rw',
		name: 'DC water pump PWM input frequency type',
		type: 'number',
		role: 'level',
	},
];

/**
 * Definitions grouped by register address.
 * One register can create several ioBroker states because of bit fields.
 */
export const registersByAddress = new Map<number, RegisterDefinition[]>();

for (const definition of registers) {
	const existing = registersByAddress.get(definition.address);

	if (existing) {
		existing.push(definition);
	} else {
		registersByAddress.set(definition.address, [definition]);
	}
}

export const writableRegisters = new Map(
	registers.filter(definition => definition.access === 'rw').map(definition => [definition.id, definition]),
);

/**
 * Convert an ioBroker value into the raw 16-bit value written with FC06.
 *
 * For masked registers the latest passively received complete register value
 * is required so unrelated bits are preserved.
 *
 * @param definition
 * @param value
 * @param currentRaw
 */
export function encodeRegisterValue(definition: RegisterDefinition, value: StateValue, currentRaw?: number): number {
	if (definition.access !== 'rw') {
		throw new Error(`${definition.id} is read-only`);
	}

	if (definition.type === 'number') {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Error(`${definition.id}: expected number`);
		}

		if (definition.min !== undefined && value < definition.min) {
			throw new Error(`${definition.id}: minimum is ${definition.min}`);
		}

		if (definition.max !== undefined && value > definition.max) {
			throw new Error(`${definition.id}: maximum is ${definition.max}`);
		}
	}

	if (definition.type === 'boolean' && typeof value !== 'boolean') {
		throw new Error(`${definition.id}: expected boolean`);
	}

	if (definition.type === 'string' && typeof value !== 'string') {
		throw new Error(`${definition.id}: expected string`);
	}

	if (definition.writeValues && !definition.writeValues.includes(value)) {
		throw new Error(`${definition.id}: invalid value ${String(value)}`);
	}

	if (definition.encode) {
		if (definition.requiresRaw && currentRaw === undefined) {
			throw new Error(`${definition.id}: no passive raw register value available`);
		}

		return definition.encode(value, currentRaw ?? 0) & 0xffff;
	}

	if (definition.mask !== undefined) {
		if (currentRaw === undefined) {
			throw new Error(`${definition.id}: no passive raw register value available`);
		}

		if (typeof value !== 'boolean') {
			throw new Error(`${definition.id}: masked value must be boolean`);
		}

		return value ? (currentRaw | definition.mask) & 0xffff : currentRaw & ~definition.mask & 0xffff;
	}

	if (typeof value === 'number') {
		const factor = definition.factor ?? 1;
		const raw = Math.round(value / factor);

		if (raw < 0 || raw > 0xffff) {
			throw new Error(`${definition.id}: value is outside unsigned 16-bit range`);
		}

		return raw;
	}

	throw new Error(`${definition.id}: no encoder defined`);
}
