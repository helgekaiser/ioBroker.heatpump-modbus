/**
 * Result of one protected masked register write.
 */
export interface SafeMaskedWriteResult {
	/** Final result of the masked write request. */
	status: 'unchanged' | 'confirmed' | 'failed';

	/** Last successfully read complete register value. */
	lastReadValue: number | undefined;

	/** Last complete register value sent to the device. */
	lastWrittenValue: number | undefined;

	/** Number of actual Modbus write requests sent. */
	writeCount: number;

	/** Number of verification reads after writes. */
	readbackCount: number;
}

/**
 * Hardware operations required for a protected masked register write.
 */
export interface SafeMaskedWriteOperations {
	/** Waits until the shared RS485 bus is idle. */
	waitForBusIdle(): Promise<void>;

	/** Reads the current complete 16-bit register value. */
	readCurrentValue(): Promise<number>;

	/** Writes one complete 16-bit register value. */
	writeValue(value: number): Promise<void>;

	/** Waits for the requested delay. */
	sleep(milliseconds: number): Promise<void>;

	/** Reports a failed initial read attempt. */
	onInitialReadError?(attemptNumber: number, error: Error): void;

	/** Reports the result of one write attempt. */
	onWriteResult?(writeNumber: number, acknowledged: boolean, error?: Error): void;

	/** Reports a failed verification read. */
	onReadbackError?(readbackNumber: number, error: Error): void;
}

/**
 * Timing and retry policy.
 */
export interface SafeMaskedWriteOptions {
	/** Delay between failed initial reads. */
	initialReadDelayMs: number;

	/** Maximum number of initial read attempts. */
	maxInitialReads: number;

	/** Delay before the first verification read. */
	postWriteDelayMs: number;

	/** Delay between verification reads. */
	readbackDelayMs: number;

	/** Delay before an allowed retry write. */
	rewriteDelayMs: number;

	/** Maximum verification reads after each write. */
	maxReadbacksPerWrite: number;

	/** Absolute maximum write attempts per user action. */
	maxWrites: number;
}

/**
 * Conservative defaults matching the normal safe register writer.
 */
export const defaultSafeMaskedWriteOptions: SafeMaskedWriteOptions = {
	initialReadDelayMs: 1000,
	maxInitialReads: 3,
	postWriteDelayMs: 1500,
	readbackDelayMs: 1000,
	rewriteDelayMs: 3000,
	maxReadbacksPerWrite: 6,
	maxWrites: 3,
};

/**
 * Applies masked bits to a complete 16-bit register value.
 *
 * All bits outside mask are preserved.
 *
 * @param currentValue Current complete register value.
 * @param mask Bits controlled by this operation.
 * @param desiredBits Desired values inside mask.
 */
export function applyRegisterMask(currentValue: number, mask: number, desiredBits: number): number {
	return (currentValue & (~mask & 0xffff)) | (desiredBits & mask);
}

/**
 * Checks whether the controlled bits already have their desired values.
 *
 * @param value Complete register value.
 * @param mask Bits controlled by this operation.
 * @param desiredBits Desired values inside mask.
 */
export function maskedRegisterMatches(value: number, mask: number, desiredBits: number): boolean {
	return (value & mask) === (desiredBits & mask);
}

/**
 * Safely changes selected bits of one 16-bit register.
 *
 * The full register is read first. Only the requested bits are changed.
 * Verification compares only the controlled bits so unrelated controller
 * bits may change independently without causing a false failure.
 *
 * A second write is allowed only when the first write was not acknowledged.
 * Before such a retry, the target word is recomputed from the most recent
 * successfully read register value to preserve unrelated bits.
 *
 * @param mask Bits that may be changed.
 * @param desiredBits Desired values inside mask.
 * @param operations Hardware operations.
 * @param options Timing and retry policy.
 */
export async function executeSafeMaskedRegisterWrite(
	mask: number,
	desiredBits: number,
	operations: SafeMaskedWriteOperations,
	options: SafeMaskedWriteOptions = defaultSafeMaskedWriteOptions,
): Promise<SafeMaskedWriteResult> {
	if (!Number.isInteger(mask) || mask < 1 || mask > 0xffff) {
		throw new Error(`Invalid register mask: ${mask}`);
	}

	if (!Number.isInteger(desiredBits) || desiredBits < 0 || desiredBits > 0xffff) {
		throw new Error(`Invalid desired register bits: ${desiredBits}`);
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

	let lastReadValue: number | undefined;
	let latestSuccessfulRead: number | undefined;
	let lastWrittenValue: number | undefined;

	let writeCount = 0;
	let readbackCount = 0;

	let lastInitialReadError: Error | undefined;

	/*
	 * Initial read. No write is permitted until a complete current
	 * register value has been obtained.
	 */
	for (let attempt = 0; attempt < options.maxInitialReads; attempt++) {
		await operations.waitForBusIdle();

		try {
			lastReadValue = await operations.readCurrentValue();

			latestSuccessfulRead = lastReadValue;

			break;
		} catch (error) {
			const normalizedError = error instanceof Error ? error : new Error(String(error));

			lastInitialReadError = normalizedError;

			operations.onInitialReadError?.(attempt + 1, normalizedError);

			if (attempt < options.maxInitialReads - 1) {
				await operations.sleep(options.initialReadDelayMs);
			}
		}
	}

	if (latestSuccessfulRead === undefined) {
		throw lastInitialReadError ?? new Error('Initial register read failed');
	}

	if (maskedRegisterMatches(latestSuccessfulRead, mask, desiredBits)) {
		return {
			status: 'unchanged',
			lastReadValue: latestSuccessfulRead,
			lastWrittenValue,
			writeCount,
			readbackCount,
		};
	}

	for (let writeAttempt = 0; writeAttempt < options.maxWrites; writeAttempt++) {
		/*
		 * Recompute the complete register word from the most recent
		 * successful read. This preserves unrelated bits even if they
		 * changed since the first attempt.
		 */
		const targetValue = applyRegisterMask(latestSuccessfulRead, mask, desiredBits);

		lastWrittenValue = targetValue;

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

				latestSuccessfulRead = lastReadValue;
			} catch (error) {
				const normalizedError = error instanceof Error ? error : new Error(String(error));

				operations.onReadbackError?.(readbackCount + 1, normalizedError);
			}

			readbackCount++;

			if (lastReadValue !== undefined && maskedRegisterMatches(lastReadValue, mask, desiredBits)) {
				return {
					status: 'confirmed',
					lastReadValue,
					lastWrittenValue,
					writeCount,
					readbackCount,
				};
			}

			if (readbackAttempt < options.maxReadbacksPerWrite - 1) {
				await operations.sleep(options.readbackDelayMs);
			}
		}

		/*
		 * Never repeat an acknowledged write merely because
		 * verification traffic was disturbed.
		 */
		if (writeAcknowledged) {
			break;
		}

		if (writeAttempt < options.maxWrites - 1) {
			await operations.sleep(options.rewriteDelayMs);
		}
	}

	return {
		status: 'failed',
		lastReadValue,
		lastWrittenValue,
		writeCount,
		readbackCount,
	};
}
