import { expect } from 'chai';
import { appendModbusCrc } from './crc';
import { PassiveFrameParser } from './passiveFrameParser';
import { buildReadHoldingRegistersRequest } from './requests';

describe('Passive Modbus frame parser', () => {
	it('parses a standard request and fragmented response', () => {
		const parser = new PassiveFrameParser();

		const request = buildReadHoldingRegistersRequest(1, 0x0011, 2);

		const response = appendModbusCrc(Uint8Array.from([0x01, 0x03, 0x04, 0x00, 0x2f, 0x01, 0x4a]));

		const requestEvents = parser.feed(request);

		expect(requestEvents).to.have.length(1);
		expect(requestEvents[0]).to.include({
			type: 'readRequest',
			slaveId: 1,
			startAddress: 0x0011,
			quantity: 2,
		});

		expect(parser.feed(response.subarray(0, 4))).to.have.length(0);

		const responseEvents = parser.feed(response.subarray(4));

		expect(responseEvents).to.have.length(1);

		const event = responseEvents[0];

		expect(event.type).to.equal('readResponse');

		if (event.type === 'readResponse') {
			expect(event.registers).to.deep.equal([47, 330]);

			expect(event.extended).to.equal(false);
		}
	});

	it('ignores unrelated bytes before a valid request', () => {
		const parser = new PassiveFrameParser();

		const request = buildReadHoldingRegistersRequest(1, 0x00c0, 1);

		const events = parser.feed(Uint8Array.from([0xaa, 0xbb, 0xcc, ...request]));

		expect(events).to.have.length(1);
		expect(events[0]).to.include({
			type: 'readRequest',
			startAddress: 0x00c0,
			quantity: 1,
		});
	});

	it('parses the verified extended 0x003F block', () => {
		const parser = new PassiveFrameParser();

		const request = appendModbusCrc(Uint8Array.from([0x01, 0x03, 0x00, 0x3f, 0x01, 0x36]));

		const payload = new Uint8Array(623);

		payload[0] = 0x01;
		payload[1] = 0x03;

		/*
		 * Real SWD traffic uses 0x6D here.
		 * The complete frame nevertheless has a valid CRC.
		 */
		payload[2] = 0x6d;

		// Register 0x003F = 0x0051
		payload[3] = 0x00;
		payload[4] = 0x51;

		// Next register = 0x0003
		payload[5] = 0x00;
		payload[6] = 0x03;

		const response = appendModbusCrc(payload);

		const requestEvents = parser.feed(request);

		expect(requestEvents).to.have.length(1);

		const responseEvents = parser.feed(response);

		expect(responseEvents).to.have.length(1);

		const event = responseEvents[0];

		expect(event.type).to.equal('readResponse');

		if (event.type === 'readResponse') {
			expect(event.extended).to.equal(true);
			expect(event.startAddress).to.equal(0x003f);
			expect(event.quantity).to.equal(310);
			expect(event.registers).to.have.length(310);
			expect(event.registers[0]).to.equal(0x0051);
			expect(event.registers[1]).to.equal(0x0003);
		}
	});

	it('does not accept a response with an invalid CRC', () => {
		const parser = new PassiveFrameParser();

		const request = buildReadHoldingRegistersRequest(1, 0x0011, 1);

		parser.feed(request);

		const response = appendModbusCrc(Uint8Array.from([0x01, 0x03, 0x02, 0x00, 0x34]));

		response[response.length - 1] ^= 0xff;

		const events = parser.feed(response);

		expect(events).to.have.length(0);
	});
});
