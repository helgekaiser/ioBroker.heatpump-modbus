import { expect } from 'chai';

import { defaultSafeWriteOptions, executeSafeRegisterWrite, type SafeWriteOperations } from './safeWriteController';

function createOperations(readValues: Array<number | Error>): {
	operations: SafeWriteOperations;
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

describe('Safe register write controller', () => {
	it('does not write when target value is already active', async () => {
		const mock = createOperations([31]);

		const result = await executeSafeRegisterWrite(31, mock.operations);

		expect(result.status).to.equal('unchanged');
		expect(result.writeCount).to.equal(0);
		expect(mock.writes).to.deep.equal([]);
	});

	it('retries a failed initial read without writing', async () => {
		const mock = createOperations([new Error('timeout'), 12]);

		const result = await executeSafeRegisterWrite(12, mock.operations);

		expect(result.status).to.equal('unchanged');
		expect(result.writeCount).to.equal(0);
		expect(mock.writes).to.deep.equal([]);
	});

	it('can succeed on the third initial read', async () => {
		const mock = createOperations([new Error('timeout 1'), new Error('timeout 2'), 12]);

		const result = await executeSafeRegisterWrite(12, mock.operations);

		expect(result.status).to.equal('unchanged');
		expect(result.writeCount).to.equal(0);
	});

	it('aborts without writing when all initial reads fail', async () => {
		const mock = createOperations([new Error('timeout 1'), new Error('timeout 2'), new Error('timeout 3')]);

		let thrown: Error | undefined;

		try {
			await executeSafeRegisterWrite(13, mock.operations);
		} catch (error) {
			thrown = error instanceof Error ? error : new Error(String(error));
		}

		expect(thrown).to.be.instanceOf(Error);
		expect(mock.writes).to.deep.equal([]);
	});

	it('confirms a normal write with one write', async () => {
		const mock = createOperations([32, 31]);

		const result = await executeSafeRegisterWrite(31, mock.operations);

		expect(result.status).to.equal('confirmed');
		expect(result.writeCount).to.equal(1);
		expect(result.readbackCount).to.equal(1);
	});

	it('never repeats a positively acknowledged write', async () => {
		const mock = createOperations([32, 32, 32, 32, 32, 32, 32]);

		const result = await executeSafeRegisterWrite(31, mock.operations);

		expect(result.status).to.equal('failed');
		expect(result.writeCount).to.equal(1);
		expect(result.readbackCount).to.equal(6);
		expect(mock.writes).to.deep.equal([31]);
	});

	it('allows one retry when the first write was not acknowledged', async () => {
		let writeCalls = 0;

		const reads = [32, 32, 32, 32, 32, 32, 32, 31];

		const operations: SafeWriteOperations = {
			waitForBusIdle(): Promise<void> {
				return Promise.resolve();
			},

			readCurrentValue(): Promise<number> {
				const value = reads.shift();

				if (value === undefined) {
					return Promise.reject(new Error('no mock value'));
				}

				return Promise.resolve(value);
			},

			writeValue(): Promise<void> {
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

		const result = await executeSafeRegisterWrite(31, operations);

		expect(result.status).to.equal('confirmed');
		expect(result.writeCount).to.equal(2);
		expect(writeCalls).to.equal(2);
	});

	it('can succeed on the third write attempt', async () => {
		const reads = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11];

		const writes: number[] = [];
		let writeCalls = 0;

		const result = await executeSafeRegisterWrite(11, {
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
		expect(writes).to.deep.equal([11, 11, 11]);
	});

	it('keeps flash-safe defaults fixed', () => {
		expect(defaultSafeWriteOptions).to.deep.equal({
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
