import { expect } from 'chai';

import { decodeBaseStatus } from './baseStatusDecoder';

describe('SWD base status decoder', () => {
	it('decodes documented working and output flags', () => {
		const registers = new Array<number>(14).fill(0);

		registers[0x0003] = (1 << 0) | (1 << 2) | (1 << 7);

		registers[0x0004] = (1 << 0) | (1 << 5) | (1 << 6);

		registers[0x0005] = (1 << 0) | (1 << 5) | (1 << 6) | (1 << 7);

		registers[0x0006] = (1 << 0) | (1 << 1);

		const state = decodeBaseStatus(registers);

		expect(state.hotWaterFlag).to.equal(true);
		expect(state.heatingFlag).to.equal(true);
		expect(state.coolingFlag).to.equal(false);
		expect(state.defrosting).to.equal(true);

		expect(state.compressorOutput).to.equal(true);
		expect(state.fanMotorOutput).to.equal(true);
		expect(state.fourWayValveOutput).to.equal(true);

		expect(state.chassisHeaterOutput).to.equal(true);
		expect(state.acElectricHeaterOutput).to.equal(true);
		expect(state.threeWayValveOutput).to.equal(true);
		expect(state.tankElectricHeaterOutput).to.equal(true);

		expect(state.circulationPumpOutput).to.equal(true);
		expect(state.crankcaseHeaterOutput).to.equal(true);
	});

	it('decodes documented faults', () => {
		const registers = new Array<number>(14).fill(0);

		registers[0x0007] = 1 << 5;

		registers[0x0008] = 1 << 0;

		registers[0x000d] = 1 << 6;

		const state = decodeBaseStatus(registers);

		expect(state.faultActive).to.equal(true);

		expect(state.faultCodes).to.deep.equal(['Er05', 'Er03', 'Er64']);

		expect(state.faultMessages).to.deep.equal(['High pressure failure', 'Water flow failure', 'DC fan 1 failure']);
	});

	it('reports no fault for a clean block', () => {
		const registers = new Array<number>(14).fill(0);

		const state = decodeBaseStatus(registers);

		expect(state.faultActive).to.equal(false);
		expect(state.faultCodes).to.deep.equal([]);
		expect(state.faultMessages).to.deep.equal([]);

		expect(state.rawFaultFlags).to.equal('0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000');
	});
});
