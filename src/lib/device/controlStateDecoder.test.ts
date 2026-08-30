import { expect } from 'chai';

import { decodeExtendedControlState } from './controlStateDecoder';

function createBlock(): number[] {
	return new Array<number>(310).fill(0);
}

function setRegister(block: number[], address: number, value: number): void {
	block[address - 0x003f] = value;
}

describe('Extended SWD control state decoder', () => {
	it('decodes heating, smart mode and setpoints', () => {
		const block = createBlock();

		setRegister(block, 0x003f, 0x0001);
		setRegister(block, 0x0040, 0x0000);
		setRegister(block, 0x0041, 0x0000);
		setRegister(block, 0x0043, 1);

		setRegister(block, 0x00be, 50);
		setRegister(block, 0x00bf, 18);
		setRegister(block, 0x00c0, 31);
		setRegister(block, 0x00d0, 16);

		const state = decodeExtendedControlState(block);

		expect(state.power).to.equal('on');
		expect(state.operatingMode).to.equal('heating');
		expect(state.frequencyMode).to.equal('smart');
		expect(state.vacationMode).to.equal(false);

		expect(state.hotWaterSetpoint).to.equal(50);
		expect(state.coolingSetpoint).to.equal(18);
		expect(state.heatingSetpoint).to.equal(31);
		expect(state.vacationSetpoint).to.equal(16);
	});

	it('decodes display power off', () => {
		const block = createBlock();

		setRegister(block, 0x003f, 0x0000);

		const state = decodeExtendedControlState(block);

		expect(state.power).to.equal('off');
	});

	it('decodes powerful mode', () => {
		const block = createBlock();

		setRegister(block, 0x0040, 1 << 4);

		expect(decodeExtendedControlState(block).frequencyMode).to.equal('powerful');
	});

	it('decodes silent mode', () => {
		const block = createBlock();

		setRegister(block, 0x0040, 1 << 5);

		expect(decodeExtendedControlState(block).frequencyMode).to.equal('silent');
	});

	it('decodes vacation mode', () => {
		const block = createBlock();

		setRegister(block, 0x0041, 1 << 1);

		expect(decodeExtendedControlState(block).vacationMode).to.equal(true);
	});

	it('decodes all documented operating modes', () => {
		const expected = ['hotWater', 'heating', 'cooling', 'hotWaterHeating', 'hotWaterCooling'];

		for (let raw = 0; raw < expected.length; raw++) {
			const block = createBlock();

			setRegister(block, 0x0043, raw);

			expect(decodeExtendedControlState(block).operatingMode).to.equal(expected[raw]);
		}
	});
});
