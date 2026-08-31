import net from 'node:net';
import { SerialPort } from 'serialport';

export type TransportType = 'tcp' | 'serial';

export interface TcpTransportConfig {
	type: 'tcp';
	host: string;
	port: number;
}

export interface SerialTransportConfig {
	type: 'serial';
	path: string;
}

export type TransportConfig = TcpTransportConfig | SerialTransportConfig;

export type DataHandler = (data: Uint8Array) => void;
export type ErrorHandler = (error: Error) => void;
export type CloseHandler = () => void;

export class Transport {
	private socket?: net.Socket;
	private serialPort?: SerialPort;

	public constructor(
		private readonly config: TransportConfig,
		private readonly onData: DataHandler,
		private readonly onError: ErrorHandler,
		private readonly onClose: CloseHandler,
	) {}

	public async connect(): Promise<void> {
		if (this.config.type === 'tcp') {
			await this.connectTcp(this.config);
			return;
		}

		await this.connectSerial(this.config);
	}

	private async connectTcp(config: TcpTransportConfig): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const socket = net.createConnection({
				host: config.host,
				port: config.port,
			});

			this.socket = socket;

			const onInitialError = (error: Error): void => {
				// Callback is registered below but may be removed on an initial error.
				// eslint-disable-next-line @typescript-eslint/no-use-before-define
				socket.off('connect', onConnect);
				reject(error);
			};

			const onConnect = (): void => {
				socket.off('error', onInitialError);

				socket.on('data', data => {
					this.onData(data);
				});

				socket.on('error', error => {
					this.onError(error);
				});

				socket.on('close', () => {
					this.onClose();
				});

				resolve();
			};

			socket.once('error', onInitialError);
			socket.once('connect', onConnect);
		});
	}

	private async connectSerial(config: SerialTransportConfig): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const port = new SerialPort({
				path: config.path,
				baudRate: 9600,
				dataBits: 8,
				parity: 'none',
				stopBits: 1,
				autoOpen: false,
			});

			this.serialPort = port;

			port.open(error => {
				if (error) {
					reject(error);
					return;
				}

				port.on('data', data => {
					this.onData(data);
				});

				port.on('error', serialError => {
					this.onError(serialError);
				});

				port.on('close', () => {
					this.onClose();
				});

				resolve();
			});
		});
	}

	public async write(data: Uint8Array): Promise<void> {
		if (this.socket) {
			await new Promise<void>((resolve, reject) => {
				this.socket!.write(data, error => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				});
			});

			return;
		}

		if (this.serialPort) {
			await new Promise<void>((resolve, reject) => {
				this.serialPort!.write(data, error => {
					if (error) {
						reject(error);
						return;
					}

					this.serialPort!.drain(drainError => {
						if (drainError) {
							reject(drainError);
						} else {
							resolve();
						}
					});
				});
			});

			return;
		}

		throw new Error('Transport is not connected');
	}

	public async close(): Promise<void> {
		if (this.socket) {
			this.socket.destroy();
			this.socket = undefined;
		}

		if (this.serialPort) {
			const port = this.serialPort;
			this.serialPort = undefined;

			if (port.isOpen) {
				await new Promise<void>(resolve => {
					port.close(() => resolve());
				});
			}
		}
	}
}
