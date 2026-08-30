import { appendModbusCrc } from './crc';

/**
 * Validates a Modbus slave address.
 *
 * @param slaveId Modbus slave ID.
 */
function validateSlaveId(slaveId: number): void {
	if (!Number.isInteger(slaveId) || slaveId < 1 || slaveId > 247) {
		throw new Error(`Invalid Modbus slave ID: ${slaveId}`);
	}
}

/**
 * Validates a 16-bit Modbus register address.
 *
 * @param address Register address.
 */
function validateRegisterAddress(address: number): void {
	if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
		throw new Error(`Invalid Modbus register address: ${address}`);
	}
}

/**
 * Builds a Modbus RTU function 03 request.
 *
 * @param slaveId Modbus slave ID.
 * @param startAddress First holding register.
 * @param quantity Number of registers to read.
 */
export function buildReadHoldingRegistersRequest(slaveId: number, startAddress: number, quantity: number): Buffer {
	validateSlaveId(slaveId);
	validateRegisterAddress(startAddress);

	if (!Number.isInteger(quantity) || quantity < 1 || quantity > 120) {
		throw new Error(`Invalid Modbus register quantity: ${quantity}`);
	}

	const frame = Buffer.from([
		slaveId,
		0x03,
		(startAddress >> 8) & 0xff,
		startAddress & 0xff,
		(quantity >> 8) & 0xff,
		quantity & 0xff,
	]);

	return Buffer.from(appendModbusCrc(frame));
}

/**
 * Builds a Modbus RTU function 06 request for one holding register.
 *
 * The adapter must only use this for registers that are explicitly
 * known to support single-register writes.
 *
 * @param slaveId Modbus slave ID.
 * @param address Holding register address.
 * @param value Unsigned 16-bit register value.
 */
export function buildWriteSingleRegisterRequest(slaveId: number, address: number, value: number): Buffer {
	validateSlaveId(slaveId);
	validateRegisterAddress(address);

	if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
		throw new Error(`Invalid Modbus register value: ${value}`);
	}

	const frame = Buffer.from([
		slaveId,
		0x06,
		(address >> 8) & 0xff,
		address & 0xff,
		(value >> 8) & 0xff,
		value & 0xff,
	]);

	return Buffer.from(appendModbusCrc(frame));
}
