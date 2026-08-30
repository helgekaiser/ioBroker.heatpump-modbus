import { expect } from 'chai';

import { BusScheduler, type BusSchedulerClock } from './busScheduler';

function createClock(initialTime = 10000): {
	clock: BusSchedulerClock;
	getTime(): number;
	sleeps: number[];
} {
	let currentTime = initialTime;
	const sleeps: number[] = [];

	const clock: BusSchedulerClock = {
		now(): number {
			return currentTime;
		},

		sleep(milliseconds: number): Promise<void> {
			sleeps.push(milliseconds);
			currentTime += milliseconds;
			return Promise.resolve();
		},
	};

	return {
		clock,

		getTime(): number {
			return currentTime;
		},

		sleeps,
	};
}

describe('Shared RS485 bus scheduler', () => {
	it('waits 500 ms after the most recent received traffic', async () => {
		const mock = createClock();

		const scheduler = new BusScheduler(
			{
				busIdleMs: 500,
				minAccessGapMs: 250,
			},
			mock.clock,
		);

		scheduler.recordRx();

		await scheduler.schedule(() => Promise.resolve('done'));

		expect(mock.sleeps).to.deep.equal([500]);
		expect(mock.getTime()).to.equal(10500);
	});

	it('does not wait when the bus is already idle', async () => {
		const mock = createClock();

		const scheduler = new BusScheduler(
			{
				busIdleMs: 500,
				minAccessGapMs: 250,
			},
			mock.clock,
		);

		const result = await scheduler.schedule(() => Promise.resolve(123));

		expect(result).to.equal(123);
		expect(mock.sleeps).to.deep.equal([]);
	});

	it('enforces the minimum gap between own active accesses', async () => {
		const mock = createClock();

		const scheduler = new BusScheduler(
			{
				busIdleMs: 500,
				minAccessGapMs: 250,
			},
			mock.clock,
		);

		await scheduler.schedule(() => Promise.resolve());

		await scheduler.schedule(() => Promise.resolve());

		expect(mock.sleeps).to.deep.equal([250]);
	});

	it('continues processing after a failed operation', async () => {
		const mock = createClock();

		const scheduler = new BusScheduler(
			{
				busIdleMs: 500,
				minAccessGapMs: 250,
			},
			mock.clock,
		);

		let firstFailed = false;

		try {
			await scheduler.schedule(() => Promise.reject(new Error('test failure')));
		} catch {
			firstFailed = true;
		}

		const result = await scheduler.schedule(() => Promise.resolve('second'));

		expect(firstFailed).to.equal(true);
		expect(result).to.equal('second');
		expect(mock.sleeps).to.deep.equal([250]);
	});
});
