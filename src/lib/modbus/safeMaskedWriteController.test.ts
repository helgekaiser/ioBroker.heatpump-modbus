import { expect } from 'chai';

import {
	applyRegisterMask,
	defaultSafeMaskedWriteOptions,
	executeSafeMaskedRegisterWrite,
	maskedRegisterMatches,
	type SafeMaskedWriteOperations,
} from './safeMaskedWriteController';

function createOperations(readValues: Array<number | Error>): {
	operations: SafeMaskedWriteOperations;
	writes: number[];
} {
	const values = [...readValues];
	const writes: number[] = [];

	return {
		writes,

		operations: {
			waitForBusIdle(): Promise<void> {
				return Promise.resolve();
			},

			readCurrentValue(): Promise<number> {
				const value = values.shift();

				if (value instanceof Error) {
					return Promise.reject(value);
				}

				if (value === undefined) {
					return Promise.reject(new Error('mock read failed'));
				}

				return Promise.resolve(value);
			},

			writeValue(value: number): Promise<void> {
				writes.push(value);

				return Promise.resolve();
			},

			sleep(): Promise<void> {
				return Promise.resolve();
			},
		},
	};
}

describe('Safe masked register write controller', () => {
	it('preserves all bits outside the mask', () => {
		expect(applyRegisterMask(0x1234, 0x0001, 0x0001)).to.equal(0x1235);

		expect(applyRegisterMask(0x1235, 0x0001, 0x0000)).to.equal(0x1234);
	});

	it('compares only controlled bits', () => {
		expect(maskedRegisterMatches(0x1235, 0x0001, 0x0001)).to.equal(true);

		expect(maskedRegisterMatches(0xabcd, 0x0001, 0x0000)).to.equal(false);
	});

	it('does not write when the masked value is already active', async () => {
		const mock = createOperations([0x1235]);

		const result = await executeSafeMaskedRegisterWrite(0x0001, 0x0001, mock.operations);

		expect(result.status).to.equal('unchanged');

		expect(result.writeCount).to.equal(0);

		expect(mock.writes).to.deep.equal([]);
	});

	it('changes only the requested bit', async () => {
		const mock = createOperations([0x1234, 0x1235]);

		const result = await executeSafeMaskedRegisterWrite(0x0001, 0x0001, mock.operations);

		expect(result.status).to.equal('confirmed');

		expect(mock.writes).to.deep.equal([0x1235]);
	});

	it('accepts unrelated bit changes during verification', async () => {
		const mock = createOperations([0x1200, 0x3401]);

		const result = await executeSafeMaskedRegisterWrite(0x0001, 0x0001, mock.operations);

		expect(result.status).to.equal('confirmed');

		expect(result.writeCount).to.equal(1);
		expect(result.readbackCount).to.equal(1);
	});

	it('never repeats a positively acknowledged masked write', async () => {
		const mock = createOperations([0x1200, 0x1200, 0x1200, 0x1200, 0x1200, 0x1200, 0x1200]);

		const result = await executeSafeMaskedRegisterWrite(0x0001, 0x0001, mock.operations);

		expect(result.status).to.equal('failed');

		expect(result.writeCount).to.equal(1);

		expect(mock.writes).to.deep.equal([0x1201]);
	});

	it('recomputes a retry from the latest register value', async () => {
		const reads = [0x1200, 0x2200, 0x2200, 0x2200, 0x2200, 0x2200, 0x2200, 0x2201];

		const writes: number[] = [];
		let writeCalls = 0;

		const operations: SafeMaskedWriteOperations = {
			waitForBusIdle(): Promise<void> {
				return Promise.resolve();
			},

			readCurrentValue(): Promise<number> {
				const value = reads.shift();

				if (value === undefined) {
					return Promise.reject(new Error('no mock read value'));
				}

				return Promise.resolve(value);
			},

			writeValue(value: number): Promise<void> {
				writes.push(value);
				writeCalls++;

				if (writeCalls === 1) {
					return Promise.reject(new Error('write response timeout'));
				}

				return Promise.resolve();
			},

			sleep(): Promise<void> {
				return Promise.resolve();
			},
		};

		const result = await executeSafeMaskedRegisterWrite(0x0001, 0x0001, operations);

		expect(result.status).to.equal('confirmed');

		expect(result.writeCount).to.equal(2);

		expect(writes).to.deep.equal([0x1201, 0x2201]);
	});

	it('can succeed on the third masked write attempt', async () => {
		const reads = [
			0x1000,

			0x2000, 0x2000, 0x2000, 0x2000, 0x2000, 0x2000,

			0x3000, 0x3000, 0x3000, 0x3000, 0x3000, 0x3000,

			0x3001,
		];

		const writes: number[] = [];
		let writeCalls = 0;

		const result = await executeSafeMaskedRegisterWrite(0x0001, 0x0001, {
			waitForBusIdle(): Promise<void> {
				return Promise.resolve();
			},

			readCurrentValue(): Promise<number> {
				const value = reads.shift();

				if (value === undefined) {
					return Promise.reject(new Error('no mock read value'));
				}

				return Promise.resolve(value);
			},

			writeValue(value: number): Promise<void> {
				writes.push(value);
				writeCalls++;

				if (writeCalls < 3) {
					return Promise.reject(new Error('write response timeout'));
				}

				return Promise.resolve();
			},

			sleep(): Promise<void> {
				return Promise.resolve();
			},
		});

		expect(result.status).to.equal('confirmed');
		expect(result.writeCount).to.equal(3);

		expect(writes).to.deep.equal([0x1001, 0x2001, 0x3001]);
	});

	it('keeps conservative defaults fixed', () => {
		expect(defaultSafeMaskedWriteOptions).to.deep.equal({
			initialReadDelayMs: 1000,
			maxInitialReads: 3,
			postWriteDelayMs: 1500,
			readbackDelayMs: 1000,
			rewriteDelayMs: 3000,
			maxReadbacksPerWrite: 6,
			maxWrites: 3,
		});
	});
});
