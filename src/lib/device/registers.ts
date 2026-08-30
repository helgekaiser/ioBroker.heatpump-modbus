/** Definition of a Modbus register used by the heat pump adapter. */
export interface RegisterDefinition {
	/** Modbus register address. */
	address: number;

	/** Human-readable register name. */
	name: string;

	/** ioBroker state ID used for this value. */
	stateId: string;

	/** Scaling factor applied to the raw register value. */
	scale: number;

	/** Optional physical unit. */
	unit?: string;

	/** Whether the raw register should be interpreted as signed 16-bit value. */
	signed?: boolean;
}

/**
 * Register definitions currently verified or selected for the SWD WP6 R290
 * test profile.
 *
 * Register 0x0012 is documented with scale 0.5 in PW58329,
 * but the tested real device reports values consistent with scale 0.1.
 */
export const verifiedRegisters: Record<string, RegisterDefinition> = {
	returnTemperature: {
		address: 0x000e,
		name: 'Inlet water temperature',
		stateId: 'temperature.inlet',
		scale: 0.1,
		unit: '°C',
		signed: true,
	},

	tankTemperature: {
		address: 0x000f,
		name: 'Water tank temperature',
		stateId: 'temperature.tank',
		scale: 0.1,
		unit: '°C',
		signed: true,
	},

	outsideTemperature: {
		address: 0x0011,
		name: 'Ambient temperature',
		stateId: 'temperature.outside',
		scale: 0.5,
		unit: '°C',
		signed: true,
	},

	flowTemperature: {
		address: 0x0012,
		name: 'Outlet water temperature',
		stateId: 'temperature.outlet',
		scale: 0.1,
		unit: '°C',
		signed: true,
	},
};

/**
 * Converts a raw 16-bit Modbus register value to its physical value.
 *
 * @param raw Raw 16-bit register value.
 * @param definition Register definition.
 * @returns Scaled physical value.
 */
export function decodeRegisterValue(raw: number, definition: RegisterDefinition): number {
	let value = raw & 0xffff;

	if (definition.signed && (value & 0x8000) !== 0) {
		value -= 0x10000;
	}

	const decoded = value * definition.scale;

	return Math.round(decoded * 1_000_000) / 1_000_000;
}
