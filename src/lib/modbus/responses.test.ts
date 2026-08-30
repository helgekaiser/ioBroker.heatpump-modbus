import { expect } from 'chai';
import { ModbusResponseError, parseReadHoldingRegistersResponse } from './responses';

describe('Modbus RTU responses', () => {
	it('parses the known response for registers 0x0011 and 0x0012', () => {
		const telegram = Uint8Array.from([0x01, 0x03, 0x04, 0x00, 0x2f, 0x01, 0x4a, 0x4b, 0x9d]);

		const registers = parseReadHoldingRegistersResponse(telegram, 1, 2);

		expect(registers).to.deep.equal([47, 330]);
	});

	it('parses the known heating setpoint response for 31 degrees', () => {
		const telegram = Uint8Array.from([0x01, 0x03, 0x02, 0x00, 0x1f, 0xf9, 0x8c]);

		const registers = parseReadHoldingRegistersResponse(telegram, 1, 1);

		expect(registers).to.deep.equal([31]);
	});

	it('rejects a response with invalid CRC', () => {
		const telegram = Uint8Array.from([0x01, 0x03, 0x02, 0x00, 0x1f, 0xf9, 0x00]);

		expect(() => parseReadHoldingRegistersResponse(telegram, 1, 1)).to.throw(ModbusResponseError, 'CRC error');
	});

	it('rejects a response from another slave', () => {
		const telegram = Uint8Array.from([0x01, 0x03, 0x02, 0x00, 0x1f, 0xf9, 0x8c]);

		expect(() => parseReadHoldingRegistersResponse(telegram, 2, 1)).to.throw(
			ModbusResponseError,
			'Unexpected slave ID',
		);
	});

	it('rejects an unexpected register count', () => {
		const telegram = Uint8Array.from([0x01, 0x03, 0x04, 0x00, 0x2f, 0x01, 0x4a, 0x4b, 0x9d]);

		expect(() => parseReadHoldingRegistersResponse(telegram, 1, 1)).to.throw(
			ModbusResponseError,
			'Unexpected byte count',
		);
	});
});
