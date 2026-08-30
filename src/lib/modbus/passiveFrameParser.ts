import { validateModbusCrc } from './crc';

/**
 * A passively observed Modbus Function 03 request.
 */
export interface PassiveReadRequest {
	/** Event type. */
	type: 'readRequest';

	/** Modbus slave address. */
	slaveId: number;

	/** First register address requested. */
	startAddress: number;

	/** Number of requested registers. */
	quantity: number;

	/** Complete raw Modbus RTU request frame. */
	raw: Uint8Array;
}

/**
 * A passively observed Modbus Function 03 response.
 */
export interface PassiveReadResponse {
	/** Event type. */
	type: 'readResponse';

	/** Modbus slave address. */
	slaveId: number;

	/** First register address returned. */
	startAddress: number;

	/** Number of returned registers. */
	quantity: number;

	/** Decoded unsigned 16-bit register values. */
	registers: number[];

	/** Whether this is the verified SWD extended 310-register response. */
	extended: boolean;

	/** Complete raw Modbus RTU response frame. */
	raw: Uint8Array;
}

/**
 * Event emitted by the passive Modbus stream parser.
 */
export type PassiveFrameEvent = PassiveReadRequest | PassiveReadResponse;

interface PendingRequest {
	slaveId: number;
	startAddress: number;
	quantity: number;
	extended: boolean;
}

/**
 * Parses Modbus RTU traffic from a transparent TCP-to-RS485 stream.
 *
 * The parser does not transmit anything. It observes Function 03 requests
 * and matches the following response to the request.
 *
 * The tested SWD WP6 R290 controller also performs a non-standard large
 * read starting at 0x003F with 310 registers. Its complete response is
 * 625 bytes long and has a valid Modbus CRC, despite its byte-count field
 * not following the normal one-byte Modbus limitation.
 */
export class PassiveFrameParser {
	private buffer = Buffer.alloc(0);
	private pendingRequest?: PendingRequest;

	/**
	 * Adds received bytes to the parser.
	 *
	 * @param chunk Newly received bytes from the transparent TCP stream.
	 * @returns All complete Modbus events detected in this chunk.
	 */
	public feed(chunk: Uint8Array): PassiveFrameEvent[] {
		this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);

		const events: PassiveFrameEvent[] = [];

		while (true) {
			if (this.pendingRequest) {
				const response = this.extractPendingResponse();

				if (!response) {
					break;
				}

				events.push(response);
				continue;
			}

			const request = this.extractRequest();

			if (!request) {
				break;
			}

			events.push(request);
		}

		return events;
	}

	/**
	 * Searches the stream for a valid Function 03 request.
	 *
	 * @returns Parsed request or undefined when more bytes are required.
	 */
	private extractRequest(): PassiveReadRequest | undefined {
		for (let offset = 0; offset <= this.buffer.length - 8; offset++) {
			const slaveId = this.buffer[offset];
			const functionCode = this.buffer[offset + 1];

			if (slaveId < 1 || slaveId > 247 || functionCode !== 0x03) {
				continue;
			}

			const frame = this.buffer.subarray(offset, offset + 8);

			if (!validateModbusCrc(frame)) {
				continue;
			}

			const startAddress = (frame[2] << 8) | frame[3];

			const quantity = (frame[4] << 8) | frame[5];

			if (quantity < 1) {
				continue;
			}

			const extended = startAddress === 0x003f && quantity === 310;

			this.buffer = this.buffer.subarray(offset + 8);

			this.pendingRequest = {
				slaveId,
				startAddress,
				quantity,
				extended,
			};

			return {
				type: 'readRequest',
				slaveId,
				startAddress,
				quantity,
				raw: Uint8Array.from(frame),
			};
		}

		if (this.buffer.length > 7) {
			this.buffer = this.buffer.subarray(this.buffer.length - 7);
		}

		return undefined;
	}

	/**
	 * Tries to extract the response belonging to the pending request.
	 *
	 * @returns Parsed response or undefined when more bytes are required.
	 */
	private extractPendingResponse(): PassiveReadResponse | undefined {
		const request = this.pendingRequest;

		if (!request) {
			return undefined;
		}

		const expectedLength = 3 + request.quantity * 2 + 2;

		if (this.buffer.length < expectedLength) {
			return undefined;
		}

		for (let offset = 0; offset <= this.buffer.length - expectedLength; offset++) {
			if (this.buffer[offset] !== request.slaveId || this.buffer[offset + 1] !== 0x03) {
				continue;
			}

			const frame = this.buffer.subarray(offset, offset + expectedLength);

			if (!validateModbusCrc(frame)) {
				continue;
			}

			if (!request.extended && frame[2] !== request.quantity * 2) {
				continue;
			}

			const registers: number[] = [];

			for (let i = 0; i < request.quantity; i++) {
				const dataOffset = 3 + i * 2;

				registers.push((frame[dataOffset] << 8) | frame[dataOffset + 1]);
			}

			this.buffer = this.buffer.subarray(offset + expectedLength);

			this.pendingRequest = undefined;

			return {
				type: 'readResponse',
				slaveId: request.slaveId,
				startAddress: request.startAddress,
				quantity: request.quantity,
				registers,
				extended: request.extended,
				raw: Uint8Array.from(frame),
			};
		}

		/*
		 * Keep waiting unless a significant amount of unrelated data
		 * accumulated. This prevents an incomplete TCP chunk from being
		 * treated as a communication error.
		 */
		if (this.buffer.length > expectedLength + 4096) {
			this.pendingRequest = undefined;
		}

		return undefined;
	}
}
