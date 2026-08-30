// This file extends the AdapterConfig type from "@iobroker/types"

declare global {
	namespace ioBroker {
		interface AdapterConfig {
			connectionType: 'tcp' | 'serial';

			host: string;
			port: number;

			serialDevice: string;

			slaveId: number;

			fallbackPollingEnabled: boolean;
			fallbackPollingInterval: number;
		}
	}
}

export {};
