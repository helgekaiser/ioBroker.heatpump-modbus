import * as utils from '@iobroker/adapter-core';

import {
	decodeRegisterValue,
	encodeRegisterValue,
	registers,
	registersByAddress,
	writableRegisters,
	type RegisterDefinition,
	type StateValue,
} from './registers';

import { PassiveParser, type RegisterBlock } from './passiveParser';
import { Transport, type TransportConfig } from './transport';
import { buildWrite06 } from './rtu';

interface WriteRequest {
	definition: RegisterDefinition;
	target: StateValue;
}

interface ActiveWrite extends WriteRequest {
	attempts: number;
	blocksSeen: number;
	waitingForResult: boolean;
}

interface FaultBit {
	address: number;
	mask: number;
	code: string;
	message: string;
}

const faultBits: readonly FaultBit[] = [
	{ address: 0x0007, mask: 0x0001, code: 'Er14', message: 'Water tank temperature failure' },
	{ address: 0x0007, mask: 0x0002, code: 'Er21', message: 'Ambient temperature failure' },
	{ address: 0x0007, mask: 0x0004, code: 'Er16', message: 'External coil temperature failure' },
	{ address: 0x0007, mask: 0x0010, code: 'Er27', message: 'Leaving water temperature failure' },
	{ address: 0x0007, mask: 0x0020, code: 'Er05', message: 'High pressure failure' },
	{ address: 0x0007, mask: 0x0040, code: 'Er06', message: 'Low pressure failure' },

	{ address: 0x0008, mask: 0x0001, code: 'Er03', message: 'Water flow failure' },
	{ address: 0x0008, mask: 0x0004, code: 'Er32', message: 'Leaving water overheat protection in heating mode' },

	{ address: 0x0009, mask: 0x0040, code: 'Er18', message: 'Discharge gas temperature failure' },

	{ address: 0x000a, mask: 0x0001, code: 'Er15', message: 'Inlet water temperature failure' },
	{ address: 0x000a, mask: 0x0002, code: 'Er12', message: 'Discharge gas overheat protection' },
	{ address: 0x000a, mask: 0x0020, code: 'Er23', message: 'Leaving water overcooling protection in cooling mode' },
	{ address: 0x000a, mask: 0x0040, code: 'Er29', message: 'Suction gas temperature failure' },

	{ address: 0x000b, mask: 0x0001, code: 'Er69', message: 'Low pressure protection' },
	{ address: 0x000b, mask: 0x0004, code: 'Er33', message: 'High external coil temperature' },
	{ address: 0x000b, mask: 0x0008, code: 'Er42', message: 'Inner coil temperature sensor failure' },
	{ address: 0x000b, mask: 0x0020, code: 'Er72', message: 'DC fan communication failure' },
	{ address: 0x000b, mask: 0x0080, code: 'Er67', message: 'Low pressure sensor failure' },

	{ address: 0x000c, mask: 0x0004, code: 'Er26', message: 'Radiator temperature failure' },
	{ address: 0x000c, mask: 0x0008, code: 'Er34', message: 'Inverter module temperature too high' },
	{ address: 0x000c, mask: 0x0010, code: '0x000C.bit4', message: 'Secondary antifreeze' },
	{ address: 0x000c, mask: 0x0020, code: '0x000C.bit5', message: 'Primary antifreeze' },

	{ address: 0x000d, mask: 0x0010, code: '0x000D.bit4', message: 'Inverter module communication failure' },
	{ address: 0x000d, mask: 0x0020, code: 'Er66', message: 'DC fan 2 failure' },
	{ address: 0x000d, mask: 0x0040, code: 'Er64', message: 'DC fan 1 failure' },
];

class HeatpumpModbus extends utils.Adapter {
	private readonly parser = new PassiveParser();

	private transport?: Transport;
	private connectionTimer?: ioBroker.Interval;

	private lastValidFrameAt = 0;
	private lastBusActivity = 0;

	/*
	 * Immer der allerletzte passiv empfangene Gerätewert.
	 */
	private readonly rawRegisters = new Map<number, number>();
	private readonly actualValues = new Map<string, StateValue>();

	/*
	 * Nur um unnötige identische ioBroker-Updates zu vermeiden.
	 */
	private readonly publishedValues = new Map<string, StateValue>();

	/*
	 * Genau eine kleine FIFO-Queue und maximal ein aktiver Write.
	 */
	private writeQueue: WriteRequest[] = [];
	private activeWrite?: ActiveWrite;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: 'heatpump-modbus',
		});

		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	private async onReady(): Promise<void> {
		this.log.info('Starting passive heat pump Modbus adapter');

		await this.createObjects();
		await this.subscribeStatesAsync('*');
		await this.setStateAsync('info.connection', false, true);

		const config = this.getTransportConfig();

		this.transport = new Transport(
			config,
			data => this.handleData(data),
			error => this.log.warn(`Transport error: ${error.message}`),
			() => {
				this.log.warn('Transport connection closed');
				void this.setStateAsync('info.connection', false, true);
			},
		);

		try {
			await this.transport.connect();

			if (config.type === 'tcp') {
				this.log.info(`Connected to ${config.host}:${config.port}`);
			} else {
				this.log.info(`Connected to serial port ${config.path}`);
			}
		} catch (error) {
			this.log.error(`Could not connect: ${error instanceof Error ? error.message : String(error)}`);
		}

		this.connectionTimer = this.setInterval(() => void this.updateConnectionState(), 1000);
	}

	private getTransportConfig(): TransportConfig {
		if (this.config.connectionType === 'serial') {
			return {
				type: 'serial',
				path: this.config.serialDevice,
			};
		}

		return {
			type: 'tcp',
			host: this.config.host,
			port: this.config.port,
		};
	}

	/*
	 * Ausschließlich passiver Empfang.
	 * Keine aktiven Read-Anfragen.
	 */
	private handleData(data: Uint8Array): void {
		this.lastBusActivity = Date.now();

		for (const block of this.parser.push(data)) {
			this.handleRegisterBlock(block);
		}
	}

	private handleRegisterBlock(block: RegisterBlock): void {
		if (block.slave !== this.config.slaveId) {
			return;
		}

		this.lastValidFrameAt = Date.now();
		void this.setStateAsync('info.connection', true, true);

		for (let index = 0; index < block.registers.length; index++) {
			const address = block.startAddress + index;
			const raw = block.registers[index];

			this.rawRegisters.set(address, raw);

			const definitions = registersByAddress.get(address);
			if (!definitions) {
				continue;
			}

			for (const definition of definitions) {
				const value = decodeRegisterValue(definition, raw);

				/*
				 * Immer sofort den letzten echten Gerätewert merken.
				 */
				this.actualValues.set(definition.id, value);

				/*
				 * Solange für diesen State ein Write offen ist,
				 * bleibt der Benutzerwert mit ack=false stehen.
				 */
				if (!this.isWritePending(definition.id)) {
					this.publishValue(definition.id, value);
				}

				/*
				 * Derselbe passive Wert kann einen Write bestätigen.
				 */
				this.observeWrite(definition.id, value);
			}
		}

		this.updateFaultStates();
	}

	private updateFaultStates(): void {
		const addresses = [0x0007, 0x0008, 0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x001f, 0x0020];

		if (!addresses.every(address => this.rawRegisters.has(address))) {
			return;
		}

		const codes: string[] = [];
		const messages: string[] = [];

		for (const fault of faultBits) {
			const raw = this.rawRegisters.get(fault.address) ?? 0;

			if ((raw & fault.mask) !== 0) {
				codes.push(fault.code);
				messages.push(fault.message);
			}
		}

		const inverterLow = this.rawRegisters.get(0x001f) ?? 0;
		const inverterHigh = this.rawRegisters.get(0x0020) ?? 0;

		if (inverterLow !== 0) {
			codes.push(`0x001F=0x${inverterLow.toString(16).toUpperCase().padStart(4, '0')}`);
			messages.push('Inverter fault low 8 bits');
		}

		if (inverterHigh !== 0) {
			codes.push(`0x0020=0x${inverterHigh.toString(16).toUpperCase().padStart(4, '0')}`);
			messages.push('Inverter fault high 8 bits');
		}

		const active = addresses.some(address => (this.rawRegisters.get(address) ?? 0) !== 0);

		const rawFaultFlags = addresses
			.map(address => {
				const value = this.rawRegisters.get(address) ?? 0;

				return `0x${address.toString(16).toUpperCase().padStart(4, '0')}=0x${value
					.toString(16)
					.toUpperCase()
					.padStart(4, '0')}`;
			})
			.join(', ');

		this.publishValue('fault.active', active);
		this.publishValue('fault.codes', codes.join(', '));
		this.publishValue('fault.messages', messages.join('; '));
		this.publishValue('diagnostics.rawFaultFlags', rawFaultFlags);
	}

	private publishValue(id: string, value: StateValue): void {
		if (this.publishedValues.get(id) === value) {
			return;
		}

		this.publishedValues.set(id, value);
		void this.setStateAsync(id, value, true);
	}

	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (!state || state.ack) {
			return;
		}

		const idShort = id.replace(`${this.namespace}.`, '');
		const definition = writableRegisters.get(idShort);

		if (!definition) {
			return;
		}

		if (typeof state.val !== 'number' && typeof state.val !== 'boolean' && typeof state.val !== 'string') {
			return;
		}

		const target: StateValue = state.val;

		/*
		 * Prüft:
		 * - Datentyp
		 * - Min / Max
		 * - erlaubte Enum-Werte
		 * - benötigten passiven Raw-Wert
		 */
		try {
			encodeRegisterValue(definition, target, this.rawRegisters.get(definition.address));
		} catch (error) {
			this.log.warn(`Write rejected for ${idShort}: ${String(error)}`);

			await this.restoreActualValue(idShort);
			return;
		}

		const actual = this.actualValues.get(idShort);

		if (actual === undefined) {
			this.log.warn(`Write rejected for ${idShort}: no passive value available`);
			return;
		}

		/*
		 * Falls derselbe Zielwert gerade bereits geschrieben wird,
		 * ist nichts weiter zu tun.
		 */
		if (this.activeWrite?.definition.id === idShort && this.activeWrite.target === target) {
			return;
		}

		/*
		 * Wenn kein älterer Write für denselben State läuft und
		 * der LETZTE PASSIVE Gerätewert bereits dem Wunsch entspricht:
		 *
		 * KEIN Modbus-Write.
		 */
		if (this.activeWrite?.definition.id !== idShort && actual === target) {
			this.removeQueuedWrite(idShort);

			this.publishedValues.set(idShort, target);
			await this.setStateAsync(idShort, target, true);

			this.log.debug(`Write skipped for ${idShort}: device already has ${String(target)}`);

			return;
		}

		this.queueWrite(definition, target);
		this.processNextWrite();
	}

	private queueWrite(definition: RegisterDefinition, target: StateValue): void {
		const queued = this.writeQueue.find(item => item.definition.id === definition.id);

		if (queued) {
			/*
			 * Genau derselbe Wert ist schon in der Queue:
			 * nichts tun.
			 */
			if (queued.target === target) {
				return;
			}

			/*
			 * Derselbe State, aber neuer Sollwert:
			 * nur den neuesten Wunsch behalten.
			 */
			queued.target = target;
			return;
		}

		this.writeQueue.push({
			definition,
			target,
		});
	}

	private removeQueuedWrite(id: string): void {
		this.writeQueue = this.writeQueue.filter(item => item.definition.id !== id);
	}

	private hasQueuedWrite(id: string): boolean {
		return this.writeQueue.some(item => item.definition.id === id);
	}

	private isWritePending(id: string): boolean {
		return this.activeWrite?.definition.id === id || this.hasQueuedWrite(id);
	}

	/*
	 * Immer nur einen Queue-Eintrag gleichzeitig bearbeiten.
	 */
	private processNextWrite(): void {
		if (this.activeWrite) {
			return;
		}

		const next = this.writeQueue.shift();
		if (!next) {
			return;
		}

		/*
		 * Unmittelbar vor dem Schreiben erneut den allerletzten
		 * passiven Gerätewert prüfen.
		 */
		if (this.actualValues.get(next.definition.id) === next.target) {
			this.publishedValues.set(next.definition.id, next.target);

			void this.setStateAsync(next.definition.id, next.target, true).then(() => this.processNextWrite());

			return;
		}

		this.activeWrite = {
			...next,
			attempts: 0,
			blocksSeen: 0,
			waitingForResult: false,
		};

		void this.sendActiveWrite();
	}

	/*
	 * Mindestens 200 ms keinerlei Busaktivität.
	 */
	private async waitForBusQuiet(): Promise<void> {
		while (Date.now() - this.lastBusActivity < 200) {
			const remaining = 200 - (Date.now() - this.lastBusActivity);

			await new Promise<void>(resolve => {
				this.setTimeout(resolve, Math.max(1, remaining));
			});
		}
	}

	private async sendActiveWrite(): Promise<void> {
		const active = this.activeWrite;
		if (!active) {
			return;
		}

		active.waitingForResult = false;

		/*
		 * Vielleicht wurde der gewünschte Wert zwischenzeitlich
		 * bereits passiv erreicht.
		 */
		if (this.actualValues.get(active.definition.id) === active.target) {
			await this.finishActiveWrite(active.target);
			return;
		}

		await this.waitForBusQuiet();

		if (this.activeWrite !== active) {
			return;
		}

		/*
		 * Nach dem Warten noch einmal prüfen.
		 */
		if (this.actualValues.get(active.definition.id) === active.target) {
			await this.finishActiveWrite(active.target);
			return;
		}

		if (!this.transport) {
			await this.failActiveWrite('transport unavailable');
			return;
		}

		try {
			const raw = encodeRegisterValue(
				active.definition,
				active.target,
				this.rawRegisters.get(active.definition.address),
			);

			const frame = buildWrite06({
				slave: this.config.slaveId,
				address: active.definition.address,
				value: raw,
			});

			active.attempts++;
			active.blocksSeen = 0;

			/*
			 * Erst NACH erfolgreichem write() werden die nächsten
			 * zwei passiven Beobachtungen ausgewertet.
			 */
			await this.transport.write(frame);

			if (this.activeWrite !== active) {
				return;
			}

			this.lastBusActivity = Date.now();
			active.waitingForResult = true;

			this.log.info(`Write ${active.definition.id}: ${String(active.target)} (${active.attempts}/3)`);
		} catch (error) {
			if (this.activeWrite !== active) {
				return;
			}

			if (active.attempts >= 3) {
				await this.failActiveWrite(String(error));
				return;
			}

			void this.sendActiveWrite();
		}
	}

	/*
	 * Pro Schreibversuch maximal zwei folgende passive
	 * Beobachtungen dieses Registers auswerten.
	 */
	private observeWrite(id: string, value: StateValue): void {
		const active = this.activeWrite;

		if (!active || !active.waitingForResult || active.definition.id !== id) {
			return;
		}

		/*
		 * Schon der erste passende Rücklesewert reicht.
		 */
		if (value === active.target) {
			void this.finishActiveWrite(value);
			return;
		}

		active.blocksSeen++;

		/*
		 * Nach dem ersten abweichenden Block noch genau
		 * einen weiteren passiven Block abwarten.
		 */
		if (active.blocksSeen < 2) {
			return;
		}

		active.waitingForResult = false;

		/*
		 * Nach drei tatsächlichen Write-Versuchen ist Schluss.
		 */
		if (active.attempts >= 3) {
			void this.failActiveWrite('device did not accept value');
			return;
		}

		/*
		 * Nächster Versuch beginnt wieder mit 200 ms Busruhe.
		 */
		void this.sendActiveWrite();
	}

	private async finishActiveWrite(value: StateValue): Promise<void> {
		const active = this.activeWrite;
		if (!active) {
			return;
		}

		const id = active.definition.id;
		this.activeWrite = undefined;

		/*
		 * Falls inzwischen ein neuer Sollwert für denselben State
		 * wartet, diesen nicht mit dem alten Ergebnis überschreiben.
		 */
		if (!this.hasQueuedWrite(id)) {
			this.publishedValues.set(id, value);
			await this.setStateAsync(id, value, true);
		}

		this.log.info(`Write ${id} confirmed passively`);
		this.processNextWrite();
	}

	private async failActiveWrite(reason: string): Promise<void> {
		const active = this.activeWrite;
		if (!active) {
			return;
		}

		const id = active.definition.id;
		const attempts = active.attempts;

		this.activeWrite = undefined;

		/*
		 * Gibt es keinen neueren Wunsch, wieder den tatsächlich
		 * zuletzt passiv gesehenen Gerätewert anzeigen.
		 */
		if (!this.hasQueuedWrite(id)) {
			await this.restoreActualValue(id);
		}

		this.log.warn(`Write ${id} failed after ${attempts} attempt(s): ${reason}`);

		this.processNextWrite();
	}

	private async restoreActualValue(id: string): Promise<void> {
		const actual = this.actualValues.get(id);

		if (actual === undefined) {
			return;
		}

		this.publishedValues.set(id, actual);
		await this.setStateAsync(id, actual, true);
	}

	private async updateConnectionState(): Promise<void> {
		const connected = this.lastValidFrameAt > 0 && Date.now() - this.lastValidFrameAt < 10_000;

		await this.setStateAsync('info.connection', connected, true);
	}

	private async createObjects(): Promise<void> {
		await this.setObjectNotExistsAsync('info.connection', {
			type: 'state',
			common: {
				name: 'Connection',
				type: 'boolean',
				role: 'indicator.connected',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.extendObjectAsync('fault.active', {
			type: 'state',
			common: {
				name: 'Active fault',
				type: 'boolean',
				role: 'indicator',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.extendObjectAsync('fault.codes', {
			type: 'state',
			common: {
				name: 'Active fault codes',
				type: 'string',
				role: 'text',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.extendObjectAsync('fault.messages', {
			type: 'state',
			common: {
				name: 'Active fault descriptions',
				type: 'string',
				role: 'text',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.extendObjectAsync('diagnostics.rawFaultFlags', {
			type: 'state',
			common: {
				name: 'Raw fault registers 0x0007-0x000D, 0x001F-0x0020',
				type: 'string',
				role: 'text',
				read: true,
				write: false,
			},
			native: {},
		});

		for (const definition of registers) {
			const common: ioBroker.StateCommon = {
				name: definition.name,
				type: definition.type,
				role: definition.role,
				read: true,
				write: definition.access === 'rw',
			};

			if (definition.unit !== undefined) {
				common.unit = definition.unit;
			}

			if (definition.min !== undefined) {
				common.min = definition.min;
			}

			if (definition.max !== undefined) {
				common.max = definition.max;
			}

			if (definition.id === 'pump.constantTemperatureMode') {
				common.states = {
					intermittent: 'Intermittent',
					continuous: 'Continuous',
					stop: 'Stop at constant temperature',
				};
			}

			/* HPV ENUM DROPDOWNS */
			switch (definition.id) {
				case 'operatingMode.setpoint':
					common.states = {
						hotWater: 'Hot water',
						heating: 'Heating',
						cooling: 'Cooling',
						hotWaterHeating: 'Hot water + heating',
						hotWaterCooling: 'Hot water + cooling',
					};
					break;

				case 'frequencyMode.setpoint':
					common.states = {
						smart: 'Smart',
						silent: 'Silent',
						powerful: 'Powerful',
					};
					break;

				case 'pump.mode':
					common.states = {
						disabled: 'Disabled',
						automatic: 'Automatic',
						manual: 'Manual',
					};
					break;
			}

			await this.extendObjectAsync(definition.id, {
				type: 'state',
				common,
				native: {
					modbusAddress: definition.address,
				},
			});
		}
	}

	private async onUnload(callback: () => void): Promise<void> {
		try {
			this.writeQueue = [];
			this.activeWrite = undefined;

			if (this.connectionTimer) {
				this.clearInterval(this.connectionTimer);
				this.connectionTimer = undefined;
			}

			if (this.transport) {
				await this.transport.close();
				this.transport = undefined;
			}

			await this.setStateAsync('info.connection', false, true);

			callback();
		} catch {
			callback();
		}
	}
}

if (require.main !== module) {
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new HeatpumpModbus(options);
} else {
	(() => new HeatpumpModbus())();
}
