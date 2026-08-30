import { expect } from 'chai';

import { AsyncOperationQueue } from './operationQueue';

describe('High-level write operation queue', () => {
	it('executes complete operations sequentially', async () => {
		const queue = new AsyncOperationQueue();

		const events: string[] = [];

		let releaseFirst: (() => void) | undefined;

		const firstWait = new Promise<void>(resolve => {
			releaseFirst = resolve;
		});

		const first = queue.enqueue(() => {
			events.push('first-start');

			return firstWait.then(() => {
				events.push('first-end');
			});
		});

		const second = queue.enqueue(() => {
			events.push('second');

			return Promise.resolve();
		});

		await Promise.resolve();

		expect(events).to.deep.equal(['first-start']);

		releaseFirst?.();

		await Promise.all([first, second]);

		expect(events).to.deep.equal(['first-start', 'first-end', 'second']);
	});

	it('continues after a failed operation', async () => {
		const queue = new AsyncOperationQueue();

		const events: string[] = [];

		const failed = queue.enqueue(() => {
			events.push('failed');

			return Promise.reject(new Error('test failure'));
		});

		const following = queue.enqueue(() => {
			events.push('following');

			return Promise.resolve();
		});

		try {
			await failed;
		} catch {
			// Expected.
		}

		await following;

		expect(events).to.deep.equal(['failed', 'following']);
	});
});
