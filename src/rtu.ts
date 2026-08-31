export interface ReadRequest {
	slave: number;
	startAddress: number;
	registerCount: number;
}

export interface ReadResponse {
	slave: number;
	registers: number[];
}

export interface WriteSingleRegister {
	slave: number;
	address: number;
	value: number;
}

export function crc16(buffer: Uint8Array): number {
	let crc = 0xffff;

	for (const byte of buffer) {
		crc ^= byte;

		for (let bit = 0; bit < 8; bit++) {
			if ((crc & 0x0001) !== 0) {
				crc = (crc >>> 1) ^ 0xa001;
			} else {
				crc >>>= 1;
			}
		}
	}

	return crc & 0xffff;
}

export function hasValidCrc(frame: Uint8Array): boolean {
	if (frame.length < 4) {
		return false;
	}

	const payload = frame.subarray(0, frame.length - 2);
	const expected = crc16(payload);

	const received = frame[frame.length - 2] | (frame[frame.length - 1] << 8);

	return expected === received;
}

export function parseReadRequest(frame: Uint8Array): ReadRequest | undefined {
	if (frame.length !== 8) {
		return undefined;
	}

	if (frame[1] !== 0x03) {
		return undefined;
	}

	if (!hasValidCrc(frame)) {
		return undefined;
	}

	return {
		slave: frame[0],
		startAddress: (frame[2] << 8) | frame[3],
		registerCount: (frame[4] << 8) | frame[5],
	};
}

/**
 * Parses an FC03 response when the corresponding request is already known.
 *
 * This intentionally does not rely only on the FC03 byte-count field.
 * The real heat-pump controller uses unusually large register blocks.
 *
 * @param frame
 * @param request
 */
export function parseReadResponse(frame: Uint8Array, request: ReadRequest): ReadResponse | undefined {
	if (frame.length < 5) {
		return undefined;
	}

	if (frame[0] !== request.slave) {
		return undefined;
	}

	if (frame[1] !== 0x03) {
		return undefined;
	}

	const expectedDataBytes = request.registerCount * 2;
	const expectedLength = 3 + expectedDataBytes + 2;

	if (frame.length !== expectedLength) {
		return undefined;
	}

	if (!hasValidCrc(frame)) {
		return undefined;
	}

	const registers: number[] = [];

	for (let index = 0; index < request.registerCount; index++) {
		const offset = 3 + index * 2;

		registers.push((frame[offset] << 8) | frame[offset + 1]);
	}

	return {
		slave: frame[0],
		registers,
	};
}

export function buildWrite06(write: WriteSingleRegister): Uint8Array {
	const frame = new Uint8Array(8);

	frame[0] = write.slave;
	frame[1] = 0x06;

	frame[2] = (write.address >> 8) & 0xff;
	frame[3] = write.address & 0xff;

	frame[4] = (write.value >> 8) & 0xff;
	frame[5] = write.value & 0xff;

	const crc = crc16(frame.subarray(0, 6));

	frame[6] = crc & 0xff;
	frame[7] = (crc >> 8) & 0xff;

	return frame;
}

export function registersToMap(request: ReadRequest, response: ReadResponse): Map<number, number> {
	const result = new Map<number, number>();

	for (let index = 0; index < response.registers.length; index++) {
		result.set(request.startAddress + index, response.registers[index]);
	}

	return result;
}
