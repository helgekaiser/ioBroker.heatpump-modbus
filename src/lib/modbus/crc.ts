/**
 * Calculates the Modbus RTU CRC16 checksum.
 *
 * @param data Bytes without the CRC bytes.
 * @returns CRC value as unsigned 16-bit number.
 */
export function calculateModbusCrc(data: Uint8Array): number {
	let crc = 0xffff;

	for (const byte of data) {
		crc ^= byte;

		for (let bit = 0; bit < 8; bit++) {
			if ((crc & 0x0001) !== 0) {
				crc = (crc >> 1) ^ 0xa001;
			} else {
				crc >>= 1;
			}
		}
	}

	return crc & 0xffff;
}

/**
 * Appends Modbus RTU CRC bytes in wire order: low byte first, high byte second.
 *
 * @param data Bytes without CRC.
 * @returns New buffer including CRC.
 */
export function appendModbusCrc(data: Uint8Array): Uint8Array {
	const crc = calculateModbusCrc(data);

	const result = new Uint8Array(data.length + 2);
	result.set(data);

	result[data.length] = crc & 0xff;
	result[data.length + 1] = (crc >> 8) & 0xff;

	return result;
}

/**
 * Validates the CRC of a complete Modbus RTU telegram.
 *
 * @param telegram Complete telegram including CRC bytes.
 * @returns True if the CRC is valid.
 */
export function validateModbusCrc(telegram: Uint8Array): boolean {
	if (telegram.length < 3) {
		return false;
	}

	const data = telegram.slice(0, -2);
	const expectedCrc = calculateModbusCrc(data);

	const receivedCrc = telegram[telegram.length - 2] | (telegram[telegram.length - 1] << 8);

	return expectedCrc === receivedCrc;
}
