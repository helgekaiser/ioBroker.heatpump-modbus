import type { ActiveRtuTransport } from './activeRtuClient';
import { validateModbusCrc } from './crc';

/**
 * Function used to physically transmit one complete RTU frame.
 */
export type RtuFrameWriter = (frame: Buffer) => void;

/**
 * Pending active Modbus request.
 */
interface PendingRequest {
	request: Buffer;
	resolve(response: Buffer): void;
	reject(error: Error): void;
	timeout: NodeJS.Timeout;
}

/**
 * Error raised when an active RTU request times out.
 */
export class RtuRequestTimeoutError extends Error {}

/**
 * Error raised when another active request is started before the first one
 * has completed.
 */
export class RtuRequestBusyError extends Error {}

/**
 * Matches responses to active Modbus RTU requests inside a shared byte stream.
 *
 * The existing SWD controller continues to use the same RS485 bus, so incoming
 * TCP data can contain unrelated controller traffic before or after the response
 * to our own request.
 *
 * This class therefore scans incoming bytes for a response matching the active
 * request instead of assuming that the next received bytes belong to us.
 */
export class SharedRtuRequestTransport implements ActiveRtuTransport {
	private pending?: PendingRequest;
	private buffer = Buffer.alloc(0);

	/**
	 * Creates the shared-stream request transport.
	 *
	 * @param writer Function that sends a complete RTU frame to the gateway.
	 */
	public constructor(private readonly writer: RtuFrameWriter) {}

	/**
	 * Sends one active RTU request.
	 *
	 * Only one request may be pending at a time. Higher-level serialization is
	 * additionally provided by BusScheduler.
	 *
	 * @param request Complete RTU request including CRC.
	 * @param timeoutMs Response timeout.
	 */
	public request(request: Buffer, timeoutMs: number): Promise<Buffer> {
		if (this.pending) {
			return Promise.reject(new RtuRequestBusyError('Another active RTU request is already pending'));
		}

		if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
			return Promise.reject(new Error(`Invalid RTU request timeout: ${timeoutMs}`));
		}

		this.buffer = Buffer.alloc(0);

		return new Promise<Buffer>((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (!this.pending) {
					return;
				}

				this.pending = undefined;
				this.buffer = Buffer.alloc(0);

				reject(new RtuRequestTimeoutError(`RTU request timed out after ${timeoutMs} ms`));
			}, timeoutMs);

			this.pending = {
				request: Buffer.from(request),
				resolve,
				reject,
				timeout,
			};

			try {
				this.writer(request);
			} catch (error) {
				clearTimeout(timeout);
				this.pending = undefined;

				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	/**
	 * Feeds bytes received from the transparent TCP/RS485 gateway.
	 *
	 * The same chunk should still be passed to the passive parser by main.ts.
	 * This matcher does not take ownership of passive traffic.
	 *
	 * @param chunk Newly received bytes.
	 */
	public feed(chunk: Buffer): void {
		if (!this.pending) {
			return;
		}

		this.buffer = Buffer.concat([this.buffer, chunk]);

		const response = this.findMatchingResponse(this.pending.request);

		if (!response) {
			if (this.buffer.length > 8192) {
				this.buffer = this.buffer.subarray(this.buffer.length - 8192);
			}

			return;
		}

		const pending = this.pending;

		clearTimeout(pending.timeout);

		this.pending = undefined;
		this.buffer = Buffer.alloc(0);

		pending.resolve(response);
	}

	/**
	 * Rejects a pending request, for example when the TCP socket closes.
	 *
	 * @param reason Description of the transport failure.
	 */
	public abort(reason: string): void {
		if (!this.pending) {
			return;
		}

		const pending = this.pending;

		clearTimeout(pending.timeout);

		this.pending = undefined;
		this.buffer = Buffer.alloc(0);

		pending.reject(new Error(reason));
	}

	/**
	 * Searches the accumulated stream for the response expected by one request.
	 *
	 * @param request Original RTU request.
	 */
	private findMatchingResponse(request: Buffer): Buffer | undefined {
		if (request.length < 2) {
			return undefined;
		}

		const slaveId = request[0];
		const functionCode = request[1];

		if (functionCode === 0x03) {
			return this.findReadResponse(slaveId, request);
		}

		if (functionCode === 0x06) {
			return this.findWriteResponse(slaveId, request);
		}

		return undefined;
	}

	/**
	 * Finds a standard function 03 response.
	 *
	 * @param slaveId Expected slave.
	 * @param request Original request.
	 */
	private findReadResponse(slaveId: number, request: Buffer): Buffer | undefined {
		if (request.length < 6) {
			return undefined;
		}

		const quantity = (request[4] << 8) | request[5];

		const expectedByteCount = quantity * 2;

		const expectedLength = 3 + expectedByteCount + 2;

		for (let offset = 0; offset + expectedLength <= this.buffer.length; offset++) {
			if (
				this.buffer[offset] !== slaveId ||
				this.buffer[offset + 1] !== 0x03 ||
				this.buffer[offset + 2] !== expectedByteCount
			) {
				continue;
			}

			const candidate = this.buffer.subarray(offset, offset + expectedLength);

			if (validateModbusCrc(candidate)) {
				return Buffer.from(candidate);
			}
		}

		return this.findExceptionResponse(slaveId, 0x83);
	}

	/**
	 * Finds the exact function 06 echo response.
	 *
	 * @param slaveId Expected slave.
	 * @param request Original request.
	 */
	private findWriteResponse(slaveId: number, request: Buffer): Buffer | undefined {
		const expectedLength = 8;

		for (let offset = 0; offset + expectedLength <= this.buffer.length; offset++) {
			if (this.buffer[offset] !== slaveId || this.buffer[offset + 1] !== 0x06) {
				continue;
			}

			const candidate = this.buffer.subarray(offset, offset + expectedLength);

			if (!validateModbusCrc(candidate)) {
				continue;
			}

			if (
				candidate[2] !== request[2] ||
				candidate[3] !== request[3] ||
				candidate[4] !== request[4] ||
				candidate[5] !== request[5]
			) {
				continue;
			}

			return Buffer.from(candidate);
		}

		return this.findExceptionResponse(slaveId, 0x86);
	}

	/**
	 * Searches for a five-byte Modbus exception response.
	 *
	 * @param slaveId Expected slave.
	 * @param exceptionFunction Function code with exception bit set.
	 */
	private findExceptionResponse(slaveId: number, exceptionFunction: number): Buffer | undefined {
		const expectedLength = 5;

		for (let offset = 0; offset + expectedLength <= this.buffer.length; offset++) {
			if (this.buffer[offset] !== slaveId || this.buffer[offset + 1] !== exceptionFunction) {
				continue;
			}

			const candidate = this.buffer.subarray(offset, offset + expectedLength);

			if (validateModbusCrc(candidate)) {
				return Buffer.from(candidate);
			}
		}

		return undefined;
	}
}
