import { expect } from 'chai';
import { decodeTemperatureBlock } from './blockA';

describe('Temperature register block 0x000E-0x0012', () => {
	it('decodes all relevant values from the five-register block', () => {
		const values = decodeTemperatureBlock([320, 450, 0, 47, 330]);

		expect(values).to.deep.equal({
			returnTemperature: 32,
			tankTemperature: 45,
			outsideTemperature: 23.5,
			flowTemperature: 33,
		});
	});

	it('ignores the reserved register 0x0010', () => {
		const values = decodeTemperatureBlock([300, 400, 1234, 40, 310]);

		expect(values).to.deep.equal({
			returnTemperature: 30,
			tankTemperature: 40,
			outsideTemperature: 20,
			flowTemperature: 31,
		});
	});

	it('rejects incomplete blocks', () => {
		expect(() => decodeTemperatureBlock([300, 400, 0, 40])).to.throw();
	});
});
