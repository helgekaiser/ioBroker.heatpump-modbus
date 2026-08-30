import { expect } from 'chai';

import { buildReadHoldingRegistersRequest, buildWriteSingleRegisterRequest } from './requests';

describe('Modbus RTU requests', () => {
	it('builds the known request for registers 0x0011 and 0x0012', () => {
		expect(buildReadHoldingRegistersRequest(1, 0x0011, 2).toString('hex')).to.equal('010300110002940e');
	});

	it('builds the known heating setpoint read request', () => {
		expect(buildReadHoldingRegistersRequest(1, 0x00c0, 1).toString('hex')).to.equal('010300c000018436');
	});

	it('builds the verified heating setpoint write request for 31 degrees', () => {
		expect(buildWriteSingleRegisterRequest(1, 0x00c0, 31).toString('hex')).to.equal('010600c0001fc83e');
	});

	it('rejects invalid register quantities', () => {
		expect(() => buildReadHoldingRegistersRequest(1, 0x0000, 0)).to.throw();

		expect(() => buildReadHoldingRegistersRequest(1, 0x0000, 121)).to.throw();
	});

	it('rejects invalid write values', () => {
		expect(() => buildWriteSingleRegisterRequest(1, 0x00c0, -1)).to.throw();

		expect(() => buildWriteSingleRegisterRequest(1, 0x00c0, 0x10000)).to.throw();
	});
});
