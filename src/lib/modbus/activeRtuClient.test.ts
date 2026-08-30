import { expect } from 'chai';

import { ActiveRtuClient, type ActiveRtuTransport, ModbusWriteResponseError } from './activeRtuClient';

class MockTransport implements ActiveRtuTransport {
	public readonly requests: Buffer[] = [];

	public constructor(private readonly responses: Buffer[]) {}

	public request(request: Buffer, _timeoutMs: number): Promise<Buffer> {
		this.requests.push(request);

		const response = this.responses.shift();

		if (!response) {
			return Promise.reject(new Error('No mocked response available'));
		}

		return Promise.resolve(response);
	}
}

describe('Active Modbus RTU client', () => {
	it('reads the verified heating setpoint', async () => {
		const transport = new MockTransport([Buffer.from('010302001ff98c', 'hex')]);

		const client = new ActiveRtuClient(transport, {
			slaveId: 1,
			timeoutMs: 1500,
		});

		const values = await client.readHoldingRegisters(0x00c0, 1);

		expect(values).to.deep.equal([31]);

		expect(transport.requests[0].toString('hex')).to.equal('010300c000018436');
	});

	it('validates the verified function 06 echo response', async () => {
		const transport = new MockTransport([Buffer.from('010600c0001fc83e', 'hex')]);

		const client = new ActiveRtuClient(transport, {
			slaveId: 1,
			timeoutMs: 1500,
		});

		await client.writeSingleRegister(0x00c0, 31);

		expect(transport.requests[0].toString('hex')).to.equal('010600c0001fc83e');
	});

	it('rejects a function 06 response with invalid CRC', async () => {
		const transport = new MockTransport([Buffer.from('010600c0001fc800', 'hex')]);

		const client = new ActiveRtuClient(transport, {
			slaveId: 1,
			timeoutMs: 1500,
		});

		let error: unknown;

		try {
			await client.writeSingleRegister(0x00c0, 31);
		} catch (caught) {
			error = caught;
		}

		expect(error).to.be.instanceOf(ModbusWriteResponseError);
	});

	it('rejects a function 06 echo for another value', async () => {
		const transport = new MockTransport([Buffer.from('010600c0001ec9fe', 'hex')]);

		const client = new ActiveRtuClient(transport, {
			slaveId: 1,
			timeoutMs: 1500,
		});

		let failed = false;

		try {
			await client.writeSingleRegister(0x00c0, 31);
		} catch {
			failed = true;
		}

		expect(failed).to.equal(true);
	});
});
