/**
 * Decoded documented status values from the base register block.
 */
export interface BaseStatusState {
	/** Bit 0 of working-status register 0x0003. */
	hotWaterFlag: boolean;

	/** Bit 2 of working-status register 0x0003. */
	heatingFlag: boolean;

	/** Bit 3 of working-status register 0x0003. */
	coolingFlag: boolean;

	/** Bit 4 of working-status register 0x0003. */
	dcFan1ValidityFlag: boolean;

	/** Bit 5 of working-status register 0x0003. */
	dcFan2ValidityFlag: boolean;

	/** Bit 7 of working-status register 0x0003. */
	defrosting: boolean;

	/** Compressor output from 0x0004 bit 0. */
	compressorOutput: boolean;

	/** Fan motor output from 0x0004 bit 5. */
	fanMotorOutput: boolean;

	/** Four-way valve output from 0x0004 bit 6. */
	fourWayValveOutput: boolean;

	/** Chassis electric heater output from 0x0005 bit 0. */
	chassisHeaterOutput: boolean;

	/** A/C electric heater output from 0x0005 bit 5. */
	acElectricHeaterOutput: boolean;

	/** Three-way valve output from 0x0005 bit 6. */
	threeWayValveOutput: boolean;

	/** Water-tank electric heater output from 0x0005 bit 7. */
	tankElectricHeaterOutput: boolean;

	/** Circulation-pump output from 0x0006 bit 0. */
	circulationPumpOutput: boolean;

	/** Crankcase electric heater output from 0x0006 bit 1. */
	crankcaseHeaterOutput: boolean;

	/** Whether at least one documented fault bit is active. */
	faultActive: boolean;

	/** Active documented fault identifiers. */
	faultCodes: string[];

	/** Human-readable active documented faults. */
	faultMessages: string[];

	/** Raw fault registers 0x0007 through 0x000D. */
	rawFaultFlags: string;
}

interface FaultDefinition {
	address: number;
	bit: number;
	code: string;
	message: string;
}

const faultDefinitions: FaultDefinition[] = [
	{
		address: 0x0007,
		bit: 0,
		code: 'Er14',
		message: 'Water tank temperature sensor failure',
	},
	{
		address: 0x0007,
		bit: 1,
		code: 'Er21',
		message: 'Ambient temperature sensor failure',
	},
	{
		address: 0x0007,
		bit: 2,
		code: 'Er16',
		message: 'External coil temperature sensor failure',
	},
	{
		address: 0x0007,
		bit: 4,
		code: 'Er27',
		message: 'Leaving water temperature sensor failure',
	},
	{
		address: 0x0007,
		bit: 5,
		code: 'Er05',
		message: 'High pressure failure',
	},
	{
		address: 0x0007,
		bit: 6,
		code: 'Er06',
		message: 'Low pressure failure',
	},
	{
		address: 0x0008,
		bit: 0,
		code: 'Er03',
		message: 'Water flow failure',
	},
	{
		address: 0x0008,
		bit: 2,
		code: 'Er32',
		message: 'Leaving water overheat protection in heating mode',
	},
	{
		address: 0x0009,
		bit: 6,
		code: 'Er18',
		message: 'Discharge gas temperature failure',
	},
	{
		address: 0x000a,
		bit: 0,
		code: 'Er15',
		message: 'Inlet water temperature sensor failure',
	},
	{
		address: 0x000a,
		bit: 1,
		code: 'Er12',
		message: 'Discharge gas overheat protection',
	},
	{
		address: 0x000a,
		bit: 5,
		code: 'Er23',
		message: 'Leaving water overcooling protection in cooling mode',
	},
	{
		address: 0x000a,
		bit: 6,
		code: 'Er29',
		message: 'Suction gas temperature sensor failure',
	},
	{
		address: 0x000b,
		bit: 0,
		code: 'Er69',
		message: 'Low pressure protection',
	},
	{
		address: 0x000b,
		bit: 2,
		code: 'Er33',
		message: 'High external coil temperature',
	},
	{
		address: 0x000b,
		bit: 3,
		code: 'Er42',
		message: 'Inner coil temperature sensor failure',
	},
	{
		address: 0x000b,
		bit: 5,
		code: 'Er72',
		message: 'DC fan communication failure',
	},
	{
		address: 0x000b,
		bit: 7,
		code: 'Er67',
		message: 'Low pressure sensor failure',
	},
	{
		address: 0x000c,
		bit: 2,
		code: 'Er26',
		message: 'Radiator temperature sensor failure',
	},
	{
		address: 0x000c,
		bit: 3,
		code: 'Er34',
		message: 'Inverter module temperature too high',
	},
	{
		address: 0x000c,
		bit: 4,
		code: 'secondaryAntifreeze',
		message: 'Secondary antifreeze protection',
	},
	{
		address: 0x000c,
		bit: 5,
		code: 'primaryAntifreeze',
		message: 'Primary antifreeze protection',
	},
	{
		address: 0x000d,
		bit: 4,
		code: 'inverterCommunication',
		message: 'Inverter module communication failure',
	},
	{
		address: 0x000d,
		bit: 5,
		code: 'Er66',
		message: 'DC fan 2 failure',
	},
	{
		address: 0x000d,
		bit: 6,
		code: 'Er64',
		message: 'DC fan 1 failure',
	},
];

/**
 * Decodes the documented status registers from a block beginning at 0x0000.
 *
 * @param registers Raw registers beginning at address 0x0000.
 * @returns Decoded documented controller state.
 */
export function decodeBaseStatus(registers: readonly number[]): BaseStatusState {
	if (registers.length < 14) {
		throw new Error('Base status block must contain registers 0x0000 through 0x000D');
	}

	const workingStatus = registers[0x0003];
	const outputFlags1 = registers[0x0004];
	const outputFlags2 = registers[0x0005];
	const outputFlags3 = registers[0x0006];

	const faultCodes: string[] = [];
	const faultMessages: string[] = [];

	for (const definition of faultDefinitions) {
		const raw = registers[definition.address];

		if ((raw & (1 << definition.bit)) !== 0) {
			faultCodes.push(definition.code);
			faultMessages.push(definition.message);
		}
	}

	const rawFaultFlags = registers
		.slice(0x0007, 0x000e)
		.map(value => `0x${value.toString(16).padStart(4, '0')}`)
		.join(',');

	return {
		hotWaterFlag: (workingStatus & (1 << 0)) !== 0,

		heatingFlag: (workingStatus & (1 << 2)) !== 0,

		coolingFlag: (workingStatus & (1 << 3)) !== 0,

		dcFan1ValidityFlag: (workingStatus & (1 << 4)) !== 0,

		dcFan2ValidityFlag: (workingStatus & (1 << 5)) !== 0,

		defrosting: (workingStatus & (1 << 7)) !== 0,

		compressorOutput: (outputFlags1 & (1 << 0)) !== 0,

		fanMotorOutput: (outputFlags1 & (1 << 5)) !== 0,

		fourWayValveOutput: (outputFlags1 & (1 << 6)) !== 0,

		chassisHeaterOutput: (outputFlags2 & (1 << 0)) !== 0,

		acElectricHeaterOutput: (outputFlags2 & (1 << 5)) !== 0,

		threeWayValveOutput: (outputFlags2 & (1 << 6)) !== 0,

		tankElectricHeaterOutput: (outputFlags2 & (1 << 7)) !== 0,

		circulationPumpOutput: (outputFlags3 & (1 << 0)) !== 0,

		crankcaseHeaterOutput: (outputFlags3 & (1 << 1)) !== 0,

		faultActive: faultCodes.length > 0,

		faultCodes,
		faultMessages,
		rawFaultFlags,
	};
}
