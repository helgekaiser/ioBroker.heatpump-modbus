import { expect } from 'chai';
import { PassivePowerDetector } from './passivePowerDetector';

describe('Passive power detector', () => {
	it('reports unknown before any bus traffic was observed', () => {
		const detector = new PassivePowerDetector();

		expect(detector.getState(10000)).to.equal('unknown');
	});

	it('reports on while the 0x003F block is received regularly', () => {
		const detector = new PassivePowerDetector();

		detector.recordBaseTraffic(10000);
		detector.recordPowerBlock(10000);

		expect(detector.getState(15000)).to.equal('on');
	});

	it('reports off when base traffic continues but the 0x003F block stops', () => {
		const detector = new PassivePowerDetector();

		detector.recordPowerBlock(10000);
		detector.recordBaseTraffic(10000);

		detector.recordBaseTraffic(13200);
		detector.recordBaseTraffic(16400);

		expect(detector.getState(16401)).to.equal('off');
	});

	it('does not mistake missing communication for power off', () => {
		const detector = new PassivePowerDetector();

		detector.recordBaseTraffic(10000);
		detector.recordPowerBlock(10000);

		expect(detector.getState(19000)).to.equal('unknown');
	});

	it('returns to on immediately when the 0x003F block reappears', () => {
		const detector = new PassivePowerDetector();

		detector.recordBaseTraffic(10000);
		detector.recordPowerBlock(10000);

		detector.recordBaseTraffic(17000);
		expect(detector.getState(17000)).to.equal('off');

		detector.recordPowerBlock(17100);

		expect(detector.getState(17100)).to.equal('on');
	});
});

describe('Passive power detector startup', () => {
	it('reports unknown while waiting for the first 0x003F block', () => {
		const detector = new PassivePowerDetector();

		detector.recordBaseTraffic(10000);

		expect(detector.getState(12000)).to.equal('unknown');
	});

	it('reports off after the startup observation period if base traffic continues', () => {
		const detector = new PassivePowerDetector();

		detector.recordBaseTraffic(10000);
		detector.recordBaseTraffic(17000);

		expect(detector.getState(17000)).to.equal('off');
	});
});
