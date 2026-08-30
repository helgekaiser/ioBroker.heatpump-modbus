/**
 * Serializes complete high-level operations.
 *
 * The Modbus bus scheduler already serializes individual accesses.
 * This queue additionally prevents complete multi-step write workflows
 * from interleaving with each other.
 */
export class AsyncOperationQueue {
	private tail: Promise<void> = Promise.resolve();

	/**
	 * Adds one asynchronous operation to the queue.
	 *
	 * A failed operation does not block subsequent operations.
	 *
	 * @param operation Operation to execute.
	 * @returns Promise for this individual operation.
	 */
	public enqueue(operation: () => Promise<void>): Promise<void> {
		const current = this.tail.then(operation);

		this.tail = current.catch(() => undefined);

		return current;
	}
}
