/**
 * Logical heat-pump power state detected from the existing controller traffic.
 */
export type PassivePowerState = 'on' | 'off' | 'unknown';

/**
 * Configuration for passive power-state detection.
 */
export interface PassivePowerDetectorOptions {
	/**
	 * Maximum time without a 0x003F block before the device is considered off.
	 */
	powerBlockTimeoutMs: number;

	/**
	 * Maximum time without basic bus traffic before communication is considered
	 * unavailable.
	 */
	busTimeoutMs: number;
}

/**
 * Tracks passive bus traffic and infers the logical heat-pump power state.
 */
export class PassivePowerDetector {
	private firstBaseTraffic?: number;
	private lastBaseTraffic?: number;
	private lastPowerBlock?: number;

	/**
	 * Creates a passive power-state detector.
	 *
	 * @param options Detection timeout configuration.
	 */
	public constructor(
		private readonly options: PassivePowerDetectorOptions = {
			powerBlockTimeoutMs: 6000,
			busTimeoutMs: 8000,
		},
	) {}

	/**
	 * Records reception of the regular 0x0000 status block.
	 *
	 * @param timestamp Timestamp in milliseconds.
	 */
	public recordBaseTraffic(timestamp: number): void {
		if (this.firstBaseTraffic === undefined) {
			this.firstBaseTraffic = timestamp;
		}

		this.lastBaseTraffic = timestamp;
	}

	/**
	 * Records reception of the large block starting at 0x003F.
	 *
	 * @param timestamp Timestamp in milliseconds.
	 */
	public recordPowerBlock(timestamp: number): void {
		this.lastPowerBlock = timestamp;
	}

	/**
	 * Returns the currently inferred logical heat-pump state.
	 *
	 * @param now Current timestamp in milliseconds.
	 * @returns Inferred power state.
	 */
	public getState(now: number): PassivePowerState {
		if (this.lastBaseTraffic === undefined || now - this.lastBaseTraffic > this.options.busTimeoutMs) {
			return 'unknown';
		}

		if (this.lastPowerBlock !== undefined && now - this.lastPowerBlock <= this.options.powerBlockTimeoutMs) {
			return 'on';
		}

		if (
			this.lastPowerBlock === undefined &&
			this.firstBaseTraffic !== undefined &&
			now - this.firstBaseTraffic <= this.options.powerBlockTimeoutMs
		) {
			return 'unknown';
		}

		return 'off';
	}
}
