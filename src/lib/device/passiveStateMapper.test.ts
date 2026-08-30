import { expect } from 'chai';
import { mapPassiveRegisterBlock } from './passiveStateMapper';

describe('Passive state mapper', () => {
	it('maps the verified temperature registers from the large base block', () => {
		const registers = new Array<number>(63).fill(0);

		registers[0x000e] = 312;
		registers[0x000f] = 312;
		registers[0x0011] = 54;
		registers[0x0012] = 311;

		const values = mapPassiveRegisterBlock(0x0000, registers);

		expect(values).to.deep.include({
			stateId: 'temperature.inlet',
			value: 31.2,
			unit: '°C',
			address: 0x000e,
		});

		expect(values).to.deep.include({
			stateId: 'temperature.outside',
			value: 27,
			unit: '°C',
			address: 0x0011,
		});

		expect(values).to.deep.include({
			stateId: 'temperature.outlet',
			value: 31.1,
			unit: '°C',
			address: 0x0012,
		});
	});

	it('ignores known registers outside the received block', () => {
		const registers = [47, 330];

		const values = mapPassiveRegisterBlock(0x0011, registers);

		expect(values).to.have.length(2);

		expect(values.map(value => value.stateId)).to.have.members(['temperature.outside', 'temperature.outlet']);
	});

	it('decodes signed values through the register definition', () => {
		const registers = new Array<number>(0x12).fill(0);

		registers[0x0011] = 0xffff;

		const values = mapPassiveRegisterBlock(0x0000, registers);

		const outside = values.find(value => value.stateId === 'temperature.outside');

		expect(outside?.value).to.equal(-0.5);
	});
});
