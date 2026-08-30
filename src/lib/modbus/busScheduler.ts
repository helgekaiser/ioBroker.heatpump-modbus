import { setTimeout as delay } from 'node:timers/promises';

/**
 * Configuration for safe access to the shared RS485 bus.
 */
export interface BusSchedulerOptions {
	/**
	 * Required silence after the most recently received bus byte.
	 */
	busIdleMs: number;

	/**
	 * Minimum time between two active accesses initiated by this adapter.
	 */
	minAccessGapMs: number;
}

/**
 * Time functions used by the scheduler.
 *
 * They are injectable so the behaviour can be tested without real delays.
 */
export interface BusSchedulerClock {
	/**
	 * Returns the current timestamp in milliseconds.
	 */
	now(): number;

	/**
	 * Waits for the requested duration.
	 *
	 * @param milliseconds Delay in milliseconds.
	 */
	sleep(milliseconds: number): Promise<void>;
}

/**
 * Conservative defaults for the tested SWD RS485 bus.
 */
export const defaultBusSchedulerOptions: BusSchedulerOptions = {
	busIdleMs: 500,
	minAccessGapMs: 250,
};

/**
 * Default real-time clock implementation.
 */
const defaultClock: BusSchedulerClock = {
	now(): number {
		return Date.now();
	},

	sleep(milliseconds: number): Promise<void> {
		return delay(milliseconds);
	},
};

/**
 * Serializes active Modbus accesses and waits for a quiet shared bus.
 *
 * Passive incoming traffic should call recordRx() for every received TCP
 * chunk so the scheduler knows when the RS485 bus was last active.
 */
export class BusScheduler {
	private lastRxAt?: number;
	private lastOwnAccessAt?: number;

	private queue: Promise<void> = Promise.resolve();

	/**
	 * Creates a scheduler.
	 *
	 * @param options Bus timing limits.
	 * @param clock Time implementation.
	 */
	public constructor(
		private readonly options: BusSchedulerOptions = defaultBusSchedulerOptions,
		private readonly clock: BusSchedulerClock = defaultClock,
	) {}

	/**
	 * Records activity received from the RS485 bus.
	 *
	 * @param timestamp Timestamp of the received data.
	 */
	public recordRx(timestamp: number = this.clock.now()): void {
		this.lastRxAt = timestamp;
	}

	/**
	 * Waits until both the passive-bus idle period and our own access gap
	 * have elapsed.
	 */
	public async waitForBusIdle(): Promise<void> {
		while (true) {
			const now = this.clock.now();

			const busWait = this.lastRxAt === undefined ? 0 : this.lastRxAt + this.options.busIdleMs - now;

			const ownWait =
				this.lastOwnAccessAt === undefined ? 0 : this.lastOwnAccessAt + this.options.minAccessGapMs - now;

			const waitMs = Math.max(0, busWait, ownWait);

			if (waitMs === 0) {
				return;
			}

			await this.clock.sleep(waitMs);
		}
	}

	/**
	 * Executes one active bus operation exclusively.
	 *
	 * Operations are processed in invocation order. A failed operation does
	 * not permanently block later operations.
	 *
	 * @param operation Active Modbus operation.
	 */
	public schedule<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(async (): Promise<T> => {
			await this.waitForBusIdle();

			try {
				return await operation();
			} finally {
				this.lastOwnAccessAt = this.clock.now();
			}
		});

		this.queue = result.then(
			() => undefined,
			() => undefined,
		);

		return result;
	}
}
