import { expect } from 'chai';
import { decodeRegisterValue } from './registers';
import { statusRegisters } from './statusRegisters';

describe('Verified extended status registers', () => {
	it('decodes the observed low pressure as 7.9 bar', () => {
		expect(decodeRegisterValue(790, statusRegisters.lowPressure)).to.equal(7.9);
	});

	it('decodes the observed water flow as 2.07 m³/h', () => {
		expect(decodeRegisterValue(207, statusRegisters.waterFlow)).to.equal(2.07);
	});

	it('decodes the observed pump speed as 33.9 percent', () => {
		expect(decodeRegisterValue(339, statusRegisters.waterPumpActualSpeed)).to.equal(33.9);
	});

	it('decodes the observed total current as 1.3 A', () => {
		expect(decodeRegisterValue(13, statusRegisters.totalCurrent)).to.equal(1.3);
	});

	it('contains the verified expansion valve registers', () => {
		expect(statusRegisters.mainExpansionValve.address).to.equal(0x001c);

		expect(statusRegisters.auxExpansionValve.address).to.equal(0x001d);
	});
});
