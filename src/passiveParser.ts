import { hasValidCrc, parseReadRequest, parseReadResponse, type ReadRequest } from './rtu';

export interface RegisterBlock {
	slave: number;
	startAddress: number;
	registers: number[];
}

export class PassiveParser {
	private buffer = Buffer.alloc(0);
	private pendingRead?: ReadRequest;

	public push(data: Uint8Array): RegisterBlock[] {
		this.buffer = Buffer.concat([this.buffer, Buffer.from(data)]);

		const blocks: RegisterBlock[] = [];

		while (this.buffer.length > 0) {
			const consumed = this.tryParse(blocks);

			if (!consumed) {
				break;
			}
		}

		return blocks;
	}

	private tryParse(blocks: RegisterBlock[]): boolean {
		/*
		 * Standard FC03 request:
		 * slave + 03 + start(2) + count(2) + CRC(2)
		 */
		if (this.buffer.length >= 8) {
			const candidate = this.buffer.subarray(0, 8);
			const request = parseReadRequest(candidate);

			if (request) {
				this.pendingRead = request;
				this.buffer = this.buffer.subarray(8);
				return true;
			}
		}

		/*
		 * FC03 response.
		 *
		 * We intentionally derive the expected frame length from the
		 * previously observed request. This also supports the unusually
		 * large register block used by this heat-pump controller.
		 */
		if (
			this.pendingRead &&
			this.buffer.length >= 2 &&
			this.buffer[0] === this.pendingRead.slave &&
			this.buffer[1] === 0x03
		) {
			const expectedLength = 3 + this.pendingRead.registerCount * 2 + 2;

			if (this.buffer.length < expectedLength) {
				return false;
			}

			const candidate = this.buffer.subarray(0, expectedLength);

			const response = parseReadResponse(candidate, this.pendingRead);

			if (response) {
				blocks.push({
					slave: response.slave,
					startAddress: this.pendingRead.startAddress,
					registers: response.registers,
				});

				this.buffer = this.buffer.subarray(expectedLength);

				this.pendingRead = undefined;
				return true;
			}
		}

		/*
		 * Other complete 8-byte RTU frames, e.g. FC06.
		 *
		 * We do not interpret them here yet, but they must not block the
		 * passive stream parser.
		 */
		if (this.buffer.length >= 8) {
			const candidate = this.buffer.subarray(0, 8);

			if (hasValidCrc(candidate)) {
				this.buffer = this.buffer.subarray(8);
				return true;
			}
		}

		/*
		 * Unknown byte at the front. Drop one byte and try to synchronize
		 * again on the next valid RTU frame.
		 */
		if (this.buffer.length > 1024) {
			this.buffer = this.buffer.subarray(1);
			return true;
		}

		return false;
	}
}
