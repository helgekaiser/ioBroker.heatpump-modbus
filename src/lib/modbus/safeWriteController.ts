/**
 * Result of one protected register write.
 */
export interface SafeWriteResult {
	/** Final result of the requested change. */
	status: 'unchanged' | 'confirmed' | 'failed';

	/** Requested raw register value. */
	targetValue: number;

	/** Last successfully read register value. */
	lastReadValue: number | undefined;

	/** Number of actual Modbus write requests sent. */
	writeCount: number;

	/** Number of verification reads after writes. */
	readbackCount: number;
}

/**
 * Hardware operations required by the safe write controller.
 */
export interface SafeWriteOperations {
	/** Waits until the shared RS485 bus is idle. */
	waitForBusIdle(): Promise<void>;

	/** Reads the current raw register value. */
	readCurrentValue(): Promise<number>;

	/**
	 * Writes one raw register value.
	 *
	 * @param value Raw 16-bit value.
	 */
	writeValue(value: number): Promise<void>;

	/**
	 * Waits for the requested time.
	 *
	 * @param milliseconds Delay in milliseconds.
	 */
	sleep(milliseconds: number): Promise<void>;

	/**
	 * Optional diagnostic callback for a write attempt.
	 *
	 * @param writeNumber One-based write attempt number.
	 * @param acknowledged Whether a valid Modbus response was received.
	 * @param error Error when the write was not acknowledged.
	 */
	onWriteResult?(writeNumber: number, acknowledged: boolean, error?: Error): void;

	/**
	 * Optional diagnostic callback for a failed initial read.
	 *
	 * @param attemptNumber One-based initial read attempt number.
	 * @param error Read error.
	 */
	onInitialReadError?(attemptNumber: number, error: Error): void;

	/**
	 * Optional diagnostic callback for a failed readback.
	 *
	 * @param readbackNumber One-based readback number.
	 * @param error Readback error.
	 */
	onReadbackError?(readbackNumber: number, error: Error): void;
}

/**
 * Timing and retry policy for protected register writes.
 */
export interface SafeWriteOptions {
	/** Delay between failed initial reads. */
	initialReadDelayMs: number;

	/** Maximum initial read attempts before aborting without a write. */
	maxInitialReads: number;

	/** Delay before the first verification read. */
	postWriteDelayMs: number;

	/** Delay between verification reads. */
	readbackDelayMs: number;

	/** Additional pause before an allowed retry write. */
	rewriteDelayMs: number;

	/** Maximum verification reads after each write. */
	maxReadbacksPerWrite: number;

	/** Absolute maximum writes for one user action. */
	maxWrites: number;
}

/**
 * Flash-safe default policy.
 *
 * Initial reads may be retried because they do not modify the device.
 * A second write is possible only when the previous write did not receive
 * a valid Modbus acknowledgement and repeated readbacks still fail to show
 * the requested value.
 */
export const defaultSafeWriteOptions: SafeWriteOptions = {
	initialReadDelayMs: 1000,
	maxInitialReads: 3,
	postWriteDelayMs: 1500,
	readbackDelayMs: 1000,
	rewriteDelayMs: 3000,
	maxReadbacksPerWrite: 6,
	maxWrites: 3,
};

/**
 * Executes one protected register change.
 *
 * The current value is read first to avoid unnecessary flash writes.
 * Initial reads may be retried because reading does not alter flash memory.
 * A positively acknowledged write is never automatically repeated merely
 * because subsequent readback is delayed.
 *
 * @param targetValue Requested raw register value.
 * @param operations Hardware access operations.
 * @param options Timing and retry policy.
 */
export async function executeSafeRegisterWrite(
	targetValue: number,
	operations: SafeWriteOperations,
	options: SafeWriteOptions = defaultSafeWriteOptions,
): Promise<SafeWriteResult> {
	if (!Number.isInteger(targetValue) || targetValue < 0 || targetValue > 0xffff) {
		throw new Error(`Invalid target register value: ${targetValue}`);
	}

	if (options.maxInitialReads < 1) {
		throw new Error('maxInitialReads must be at least 1');
	}

	if (options.maxWrites < 1) {
		throw new Error('maxWrites must be at least 1');
	}

	if (options.maxReadbacksPerWrite < 1) {
		throw new Error('maxReadbacksPerWrite must be at least 1');
	}

	let writeCount = 0;
	let readbackCount = 0;
	let lastReadValue: number | undefined;
	let initialReadSucceeded = false;
	let lastInitialReadError: Error | undefined;

	/*
	 * Read before write:
	 * Retry read-only access on a busy shared RS485 bus.
	 * No write is allowed until a valid current value was obtained.
	 */
	for (let initialReadAttempt = 0; initialReadAttempt < options.maxInitialReads; initialReadAttempt++) {
		await operations.waitForBusIdle();

		try {
			lastReadValue = await operations.readCurrentValue();

			initialReadSucceeded = true;
			break;
		} catch (error) {
			const normalizedError = error instanceof Error ? error : new Error(String(error));

			lastInitialReadError = normalizedError;

			operations.onInitialReadError?.(initialReadAttempt + 1, normalizedError);

			if (initialReadAttempt < options.maxInitialReads - 1) {
				await operations.sleep(options.initialReadDelayMs);
			}
		}
	}

	if (!initialReadSucceeded) {
		throw lastInitialReadError ?? new Error('Initial register read failed');
	}

	if (lastReadValue === targetValue) {
		return {
			status: 'unchanged',
			targetValue,
			lastReadValue,
			writeCount,
			readbackCount,
		};
	}

	for (let writeAttempt = 0; writeAttempt < options.maxWrites; writeAttempt++) {
		await operations.waitForBusIdle();

		let writeAcknowledged = false;

		try {
			await operations.writeValue(targetValue);

			writeAcknowledged = true;

			operations.onWriteResult?.(writeAttempt + 1, true);
		} catch (error) {
			const normalizedError = error instanceof Error ? error : new Error(String(error));

			operations.onWriteResult?.(writeAttempt + 1, false, normalizedError);
		}

		writeCount++;

		await operations.sleep(options.postWriteDelayMs);

		for (let readbackAttempt = 0; readbackAttempt < options.maxReadbacksPerWrite; readbackAttempt++) {
			await operations.waitForBusIdle();

			try {
				lastReadValue = await operations.readCurrentValue();
			} catch (error) {
				lastReadValue = undefined;

				const normalizedError = error instanceof Error ? error : new Error(String(error));

				operations.onReadbackError?.(readbackCount + 1, normalizedError);
			}

			readbackCount++;

			if (lastReadValue === targetValue) {
				return {
					status: 'confirmed',
					targetValue,
					lastReadValue,
					writeCount,
					readbackCount,
				};
			}

			if (readbackAttempt < options.maxReadbacksPerWrite - 1) {
				await operations.sleep(options.readbackDelayMs);
			}
		}

		/*
		 * A valid Function-06 acknowledgement means the write was accepted.
		 * Do not generate another flash write merely because verification
		 * reads are delayed or disturbed.
		 */
		if (writeAcknowledged) {
			break;
		}

		/*
		 * Only an unacknowledged write may receive one final retry after
		 * all verification reads failed.
		 */
		if (writeAttempt < options.maxWrites - 1) {
			await operations.sleep(options.rewriteDelayMs);
		}
	}

	return {
		status: 'failed',
		targetValue,
		lastReadValue,
		writeCount,
		readbackCount,
	};
}
