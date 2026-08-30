import { expect } from 'chai';

import { buildReadHoldingRegistersRequest, buildWriteSingleRegisterRequest } from './requests';

import { RtuRequestBusyError, SharedRtuRequestTransport } from './sharedRtuRequestTransport';

describe('Shared RTU request transport', () => {
	it('finds the matching read response after unrelated traffic', async () => {
		const writes: Buffer[] = [];

		const transport = new SharedRtuRequestTransport(frame => {
			writes.push(Buffer.from(frame));
		});

		const request = buildReadHoldingRegistersRequest(1, 0x00c0, 1);

		const resultPromise = transport.request(request, 1000);

		transport.feed(Buffer.from('010300110002940e', 'hex'));

		transport.feed(Buffer.from('010302001ff98c', 'hex'));

		const response = await resultPromise;

		expect(response.toString('hex')).to.equal('010302001ff98c');

		expect(writes[0].toString('hex')).to.equal('010300c000018436');
	});

	it('handles a fragmented read response', async () => {
		const transport = new SharedRtuRequestTransport(() => undefined);

		const promise = transport.request(buildReadHoldingRegistersRequest(1, 0x00c0, 1), 1000);

		transport.feed(Buffer.from('010302', 'hex'));

		transport.feed(Buffer.from('001f', 'hex'));

		transport.feed(Buffer.from('f98c', 'hex'));

		const response = await promise;

		expect(response.toString('hex')).to.equal('010302001ff98c');
	});

	it('finds the exact function 06 echo response', async () => {
		const transport = new SharedRtuRequestTransport(() => undefined);

		const request = buildWriteSingleRegisterRequest(1, 0x00c0, 31);

		const promise = transport.request(request, 1000);

		transport.feed(Buffer.from('010600c0001ec9fe', 'hex'));

		transport.feed(Buffer.from('010600c0001fc83e', 'hex'));

		const response = await promise;

		expect(response.toString('hex')).to.equal('010600c0001fc83e');
	});

	it('rejects a second simultaneous active request', async () => {
		const transport = new SharedRtuRequestTransport(() => undefined);

		const request = buildReadHoldingRegistersRequest(1, 0x00c0, 1);

		const first = transport.request(request, 1000);

		let error: unknown;

		try {
			await transport.request(request, 1000);
		} catch (caught) {
			error = caught;
		}

		expect(error).to.be.instanceOf(RtuRequestBusyError);

		transport.feed(Buffer.from('010302001ff98c', 'hex'));

		await first;
	});

	it('can abort a pending request when the socket closes', async () => {
		const transport = new SharedRtuRequestTransport(() => undefined);

		const promise = transport.request(buildReadHoldingRegistersRequest(1, 0x00c0, 1), 1000);

		transport.abort('TCP socket closed');

		let message = '';

		try {
			await promise;
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(message).to.equal('TCP socket closed');
	});
});
