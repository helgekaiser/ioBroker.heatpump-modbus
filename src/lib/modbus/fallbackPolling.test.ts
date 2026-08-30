import { expect } from 'chai';

import { defaultPassiveTimeoutMs, shouldRunFallbackPoll, type FallbackPollingOptions } from './fallbackPolling';

const options: FallbackPollingOptions = {
	enabled: true,
	passiveTimeoutMs: 15000,
	pollingIntervalMs: 60000,
};

describe('Fallback active polling decision', () => {
	it('does nothing when fallback polling is disabled', () => {
		expect(
			shouldRunFallbackPoll(
				{
					...options,
					enabled: false,
				},
				{
					now: 100000,
					startedAt: 0,
					lastPassiveDataAt: 0,
					pollInProgress: false,
				},
			),
		).to.equal(false);
	});

	it('waits through the startup observation period', () => {
		expect(
			shouldRunFallbackPoll(options, {
				now: 14000,
				startedAt: 0,
				pollInProgress: false,
			}),
		).to.equal(false);
	});

	it('allows fallback after startup when no passive data ever arrived', () => {
		expect(
			shouldRunFallbackPoll(options, {
				now: 16000,
				startedAt: 0,
				pollInProgress: false,
			}),
		).to.equal(true);
	});

	it('does nothing while passive data is healthy', () => {
		expect(
			shouldRunFallbackPoll(options, {
				now: 100000,
				startedAt: 0,
				lastPassiveDataAt: 90000,
				pollInProgress: false,
			}),
		).to.equal(false);
	});

	it('allows fallback polling after passive data is stale', () => {
		expect(
			shouldRunFallbackPoll(options, {
				now: 100000,
				startedAt: 0,
				lastPassiveDataAt: 80000,
				pollInProgress: false,
			}),
		).to.equal(true);
	});

	it('does not run another fallback cycle before the configured interval', () => {
		expect(
			shouldRunFallbackPoll(options, {
				now: 100000,
				startedAt: 0,
				lastPassiveDataAt: 0,
				lastFallbackPollAt: 60000,
				pollInProgress: false,
			}),
		).to.equal(false);
	});

	it('allows another fallback cycle after the configured interval', () => {
		expect(
			shouldRunFallbackPoll(options, {
				now: 130000,
				startedAt: 0,
				lastPassiveDataAt: 0,
				lastFallbackPollAt: 60000,
				pollInProgress: false,
			}),
		).to.equal(true);
	});

	it('does not start two fallback cycles simultaneously', () => {
		expect(
			shouldRunFallbackPoll(options, {
				now: 100000,
				startedAt: 0,
				lastPassiveDataAt: 0,
				pollInProgress: true,
			}),
		).to.equal(false);
	});

	it('uses a conservative 15 second passive timeout', () => {
		expect(defaultPassiveTimeoutMs).to.equal(15000);
	});
});
