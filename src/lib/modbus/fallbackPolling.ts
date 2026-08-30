/**
 * Configuration for fallback active polling.
 */
export interface FallbackPollingOptions {
	/** Whether fallback polling is enabled by the user. */
	enabled: boolean;

	/**
	 * Time without useful passive data before fallback polling is allowed.
	 */
	passiveTimeoutMs: number;

	/**
	 * Minimum interval between two fallback polling cycles.
	 */
	pollingIntervalMs: number;
}

/**
 * Runtime information used to decide whether active fallback polling
 * is currently required.
 */
export interface FallbackPollingState {
	/** Current timestamp. */
	now: number;

	/** Adapter startup timestamp. */
	startedAt: number;

	/** Timestamp of the last useful passive Modbus response. */
	lastPassiveDataAt?: number;

	/** Timestamp of the last active fallback polling cycle. */
	lastFallbackPollAt?: number;

	/** Whether an active fallback cycle is already running. */
	pollInProgress: boolean;
}

/**
 * Conservative timeout before passive monitoring is considered stale.
 */
export const defaultPassiveTimeoutMs = 15000;

/**
 * Determines whether one active fallback polling cycle should start.
 *
 * The adapter first gives passive communication a full observation period
 * after startup. Passive communication always has priority afterwards.
 *
 * @param options Fallback configuration.
 * @param state Current runtime state.
 */
export function shouldRunFallbackPoll(options: FallbackPollingOptions, state: FallbackPollingState): boolean {
	if (!options.enabled) {
		return false;
	}

	if (state.pollInProgress) {
		return false;
	}

	/*
	 * Startup grace period:
	 * Never start active fallback polling immediately after adapter startup.
	 */
	if (state.now - state.startedAt < options.passiveTimeoutMs) {
		return false;
	}

	/*
	 * When useful passive data has been received recently,
	 * active polling remains completely silent.
	 */
	if (state.lastPassiveDataAt !== undefined && state.now - state.lastPassiveDataAt < options.passiveTimeoutMs) {
		return false;
	}

	/*
	 * Respect the configured interval between fallback cycles.
	 */
	if (state.lastFallbackPollAt !== undefined && state.now - state.lastFallbackPollAt < options.pollingIntervalMs) {
		return false;
	}

	return true;
}
