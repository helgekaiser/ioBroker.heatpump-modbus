import { decodeRegisterValue, verifiedRegisters } from './registers';

/** Decoded values from Modbus register block 0x000E through 0x0012. */
export interface TemperatureBlock {
	/** Inlet water temperature, interpreted as return temperature. */
	returnTemperature: number;

	/** Water tank temperature. */
	tankTemperature: number;

	/** Ambient/outside temperature. */
	outsideTemperature: number;

	/** Outlet water temperature, interpreted as flow temperature. */
	flowTemperature: number;
}

/**
 * Decodes register block 0x000E through 0x0012.
 *
 * Register order:
 * 0x000E inlet water temperature
 * 0x000F water tank temperature
 * 0x0010 reserved
 * 0x0011 ambient temperature
 * 0x0012 outlet water temperature
 *
 * @param registers Five raw register values beginning at address 0x000E.
 * @returns Decoded temperature values.
 */
export function decodeTemperatureBlock(registers: number[]): TemperatureBlock {
	if (registers.length !== 5) {
		throw new RangeError(`Temperature block requires exactly 5 registers, received ${registers.length}`);
	}

	return {
		returnTemperature: decodeRegisterValue(registers[0], verifiedRegisters.returnTemperature),

		tankTemperature: decodeRegisterValue(registers[1], verifiedRegisters.tankTemperature),

		outsideTemperature: decodeRegisterValue(registers[3], verifiedRegisters.outsideTemperature),

		flowTemperature: decodeRegisterValue(registers[4], verifiedRegisters.flowTemperature),
	};
}
