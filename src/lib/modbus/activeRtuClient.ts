import { buildReadHoldingRegistersRequest, buildWriteSingleRegisterRequest } from './requests';
import { parseReadHoldingRegistersResponse } from './responses';
import { validateModbusCrc } from './crc';

/**
 * Minimal byte transport used by the active RTU client.
 */
export interface ActiveRtuTransport {
	/**
	 * Sends one complete RTU request and resolves with the matching response.
	 *
	 * @param request Complete Modbus RTU frame including CRC.
	 * @param timeoutMs Maximum response time.
	 */
	request(request: Buffer, timeoutMs: number): Promise<Buffer>;
}

/**
 * Active Modbus RTU client configuration.
 */
export interface ActiveRtuClientOptions {
	/** Modbus slave ID. */
	slaveId: number;

	/** Response timeout in milliseconds. */
	timeoutMs: number;
}

/**
 * Default active-access configuration.
 */
export const defaultActiveRtuClientOptions: ActiveRtuClientOptions = {
	slaveId: 1,
	timeoutMs: 1500,
};

/**
 * Error returned for invalid function 06 responses.
 */
export class ModbusWriteResponseError extends Error {}

/**
 * Small Modbus RTU client for the verified operations used by this adapter.
 *
 * This client intentionally does not know anything about TCP sockets,
 * serial ports or bus timing.
 */
export class ActiveRtuClient {
	/**
	 * Creates the active RTU client.
	 *
	 * @param transport Request/response transport.
	 * @param options Client configuration.
	 */
	public constructor(
		private readonly transport: ActiveRtuTransport,
		private readonly options: ActiveRtuClientOptions = defaultActiveRtuClientOptions,
	) {}

	/**
	 * Reads one or more holding registers using function 03.
	 *
	 * @param startAddress First register.
	 * @param quantity Number of registers.
	 */
	public async readHoldingRegisters(startAddress: number, quantity: number): Promise<number[]> {
		const request = buildReadHoldingRegistersRequest(this.options.slaveId, startAddress, quantity);

		const response = await this.transport.request(request, this.options.timeoutMs);

		return parseReadHoldingRegistersResponse(response, this.options.slaveId, quantity);
	}

	/**
	 * Writes one holding register using function 06.
	 *
	 * The response is validated when present. A transport timeout is
	 * intentionally not interpreted here; the safe-write layer decides
	 * whether readback confirmation is sufficient.
	 *
	 * @param address Holding register address.
	 * @param value Unsigned 16-bit value.
	 */
	public async writeSingleRegister(address: number, value: number): Promise<void> {
		const request = buildWriteSingleRegisterRequest(this.options.slaveId, address, value);

		const response = await this.transport.request(request, this.options.timeoutMs);

		this.validateWriteSingleResponse(response, address, value);
	}

	/**
	 * Validates the standard function 06 echo response.
	 *
	 * @param response Complete response frame.
	 * @param address Expected register address.
	 * @param value Expected written value.
	 */
	private validateWriteSingleResponse(response: Buffer, address: number, value: number): void {
		if (response.length !== 8) {
			throw new ModbusWriteResponseError(`Unexpected function 06 response length: ${response.length}`);
		}

		if (!validateModbusCrc(response)) {
			throw new ModbusWriteResponseError('Invalid CRC in function 06 response');
		}

		if (response[0] !== this.options.slaveId) {
			throw new ModbusWriteResponseError(`Unexpected slave ID: ${response[0]}`);
		}

		if (response[1] === 0x86) {
			throw new ModbusWriteResponseError(`Modbus exception ${response[2]}`);
		}

		if (response[1] !== 0x06) {
			throw new ModbusWriteResponseError(`Unexpected function code: ${response[1]}`);
		}

		const responseAddress = (response[2] << 8) | response[3];

		const responseValue = (response[4] << 8) | response[5];

		if (responseAddress !== address) {
			throw new ModbusWriteResponseError(`Unexpected register address: ${responseAddress}`);
		}

		if (responseValue !== value) {
			throw new ModbusWriteResponseError(`Unexpected register value: ${responseValue}`);
		}
	}
}
