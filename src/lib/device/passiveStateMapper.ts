import { decodeRegisterValue, type RegisterDefinition, verifiedRegisters } from './registers';

/**
 * Decoded passive device state value.
 */
export interface PassiveStateValue {
	/** ioBroker state id. */
	stateId: string;

	/** Decoded value. */
	value: number;

	/** Optional physical unit. */
	unit?: string;

	/** Source Modbus register address. */
	address: number;
}

/**
 * Maps a passively received Modbus register block to known device states.
 *
 * @param startAddress First Modbus register contained in the block.
 * @param registers Raw unsigned 16-bit register values.
 * @param definitions Register definitions to use for decoding.
 * @returns All known state values contained in the supplied block.
 */
export function mapPassiveRegisterBlock(
	startAddress: number,
	registers: number[],
	definitions: Record<string, RegisterDefinition> = verifiedRegisters,
): PassiveStateValue[] {
	const endAddress = startAddress + registers.length - 1;
	const values: PassiveStateValue[] = [];

	for (const definition of Object.values(definitions)) {
		if (definition.address < startAddress || definition.address > endAddress) {
			continue;
		}

		const registerIndex = definition.address - startAddress;
		const raw = registers[registerIndex];

		values.push({
			stateId: definition.stateId,
			value: decodeRegisterValue(raw, definition),
			unit: definition.unit,
			address: definition.address,
		});
	}

	return values;
}
