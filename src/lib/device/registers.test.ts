import { expect } from 'chai';
import { decodeRegisterValue, verifiedRegisters } from './registers';

describe('Heat pump register definitions', () => {
	it('decodes the verified outside temperature', () => {
		const value = decodeRegisterValue(47, verifiedRegisters.outsideTemperature);

		expect(value).to.equal(23.5);
	});

	it('decodes the verified flow temperature', () => {
		const value = decodeRegisterValue(330, verifiedRegisters.flowTemperature);

		expect(value).to.equal(33);
	});

	it('decodes negative signed temperatures', () => {
		const value = decodeRegisterValue(0xffff, verifiedRegisters.outsideTemperature);

		expect(value).to.equal(-0.5);
	});

	it('contains the expected register addresses', () => {
		expect(verifiedRegisters.returnTemperature.address).to.equal(0x000e);
		expect(verifiedRegisters.tankTemperature.address).to.equal(0x000f);
		expect(verifiedRegisters.outsideTemperature.address).to.equal(0x0011);
		expect(verifiedRegisters.flowTemperature.address).to.equal(0x0012);
	});
});

describe('Verified tank temperature scaling', () => {
	it('decodes the real-device tank temperature with scale 0.1', () => {
		expect(decodeRegisterValue(303, verifiedRegisters.tankTemperature)).to.equal(30.3);
	});
});
