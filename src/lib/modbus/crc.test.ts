import { expect } from 'chai';
import { appendModbusCrc, calculateModbusCrc, validateModbusCrc } from './crc';

describe('Modbus RTU CRC16', () => {
	it('calculates the CRC for heating setpoint read request', () => {
		const data = Uint8Array.from([0x01, 0x03, 0x00, 0xc0, 0x00, 0x01]);

		const crc = calculateModbusCrc(data);

		expect(crc).to.equal(0x3684);
	});

	it('appends CRC in Modbus wire order', () => {
		const data = Uint8Array.from([0x01, 0x03, 0x00, 0xc0, 0x00, 0x01]);

		const telegram = appendModbusCrc(data);

		expect(Array.from(telegram)).to.deep.equal([0x01, 0x03, 0x00, 0xc0, 0x00, 0x01, 0x84, 0x36]);
	});

	it('validates a known good response', () => {
		const telegram = Uint8Array.from([0x01, 0x03, 0x02, 0x00, 0x1f, 0xf9, 0x8c]);

		expect(validateModbusCrc(telegram)).to.equal(true);
	});

	it('rejects a response with an invalid CRC', () => {
		const telegram = Uint8Array.from([0x01, 0x03, 0x02, 0x00, 0x1f, 0xf9, 0x00]);

		expect(validateModbusCrc(telegram)).to.equal(false);
	});
});
