import { validateModbusCrc } from './crc';

/** Error thrown when a Modbus RTU response is invalid or unexpected. */
export class ModbusResponseError extends Error {
	/**
	 * Creates a Modbus response error.
	 *
	 * @param message Description of the response error.
	 */
	public constructor(message: string) {
		super(message);
		this.name = 'ModbusResponseError';
	}
}

/**
 * Parses a Modbus RTU Function 03 response.
 *
 * @param telegram Complete Modbus RTU response including CRC.
 * @param expectedSlaveId Expected Modbus slave address.
 * @param expectedQuantity Expected number of registers.
 * @returns Raw 16-bit register values.
 */
export function parseReadHoldingRegistersResponse(
	telegram: Uint8Array,
	expectedSlaveId: number,
	expectedQuantity: number,
): number[] {
	if (telegram.length < 5) {
		throw new ModbusResponseError('Response is too short');
	}

	if (!validateModbusCrc(telegram)) {
		throw new ModbusResponseError('CRC error');
	}

	if (telegram[0] !== expectedSlaveId) {
		throw new ModbusResponseError(`Unexpected slave ID: expected ${expectedSlaveId}, received ${telegram[0]}`);
	}

	const functionCode = telegram[1];

	if ((functionCode & 0x80) !== 0) {
		const exceptionCode = telegram[2];
		throw new ModbusResponseError(
			`Modbus exception response: function 0x${functionCode.toString(16)}, exception 0x${exceptionCode.toString(16)}`,
		);
	}

	if (functionCode !== 0x03) {
		throw new ModbusResponseError(
			`Unexpected function code: expected 0x03, received 0x${functionCode.toString(16)}`,
		);
	}

	const byteCount = telegram[2];
	const expectedByteCount = expectedQuantity * 2;

	if (byteCount !== expectedByteCount) {
		throw new ModbusResponseError(`Unexpected byte count: expected ${expectedByteCount}, received ${byteCount}`);
	}

	const expectedLength = 3 + byteCount + 2;

	if (telegram.length !== expectedLength) {
		throw new ModbusResponseError(
			`Unexpected response length: expected ${expectedLength}, received ${telegram.length}`,
		);
	}

	const registers: number[] = [];

	for (let offset = 0; offset < byteCount; offset += 2) {
		const highByte = telegram[3 + offset];
		const lowByte = telegram[4 + offset];

		registers.push((highByte << 8) | lowByte);
	}

	return registers;
}
