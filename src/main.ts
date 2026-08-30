/*
 * Created with @iobroker/create-adapter v3.1.5
 */

import net from 'node:net';
import { SerialPort } from 'serialport';
import * as utils from '@iobroker/adapter-core';

import { decodeBaseStatus } from './lib/device/baseStatusDecoder';
import { decodeExtendedControlState } from './lib/device/controlStateDecoder';
import { deviceRegisters } from './lib/device/deviceProfile';
import { mapPassiveRegisterBlock } from './lib/device/passiveStateMapper';

import { ActiveRtuClient } from './lib/modbus/activeRtuClient';
import { BusScheduler } from './lib/modbus/busScheduler';
import { defaultPassiveTimeoutMs, shouldRunFallbackPoll } from './lib/modbus/fallbackPolling';
import { PassiveFrameParser } from './lib/modbus/passiveFrameParser';
import { AsyncOperationQueue } from './lib/modbus/operationQueue';
import { executeSafeMaskedRegisterWrite } from './lib/modbus/safeMaskedWriteController';
import { executeSafeRegisterWrite } from './lib/modbus/safeWriteController';
import { SharedRtuRequestTransport } from './lib/modbus/sharedRtuRequestTransport';

class HeatpumpModbus extends utils.Adapter {
	private socket?: net.Socket;
	private serialPort?: SerialPort;
	private statusTimer?: ioBroker.Interval;

	private readonly parser = new PassiveFrameParser();
	private readonly busScheduler: BusScheduler;
	private readonly writeQueue = new AsyncOperationQueue();

	private activeTransport?: SharedRtuRequestTransport;
	private activeClient?: ActiveRtuClient;

	private readonly startedAt = Date.now();

	private lastBusTraffic?: number;
	private lastBaseTraffic?: number;
	private lastControlBlockTraffic?: number;
	private lastControllerPower?: 'on' | 'off';

	private activeProbeStarted = false;

	private lastPassiveDataAt?: number;
	private lastFallbackPollAt?: number;
	private fallbackPollInProgress = false;

	/**
	 * Creates the adapter instance.
	 *
	 * @param options ioBroker adapter options.
	 */
	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: 'heatpump-modbus',
		});

		this.busScheduler = new BusScheduler(undefined, {
			now: () => Date.now(),
			sleep: milliseconds =>
				new Promise(resolve => {
					this.setTimeout(resolve, milliseconds);
				}),
		});

		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	/**
	 * Handles adapter startup.
	 */
	private async onReady(): Promise<void> {
		await this.createObjects();

		await this.removeLegacyObjects();

		this.subscribeStates('hotWater.setpoint');
		this.subscribeStates('cooling.setpoint');
		this.subscribeStates('heating.setpoint');
		this.subscribeStates('operatingMode.setpoint');
		this.subscribeStates('device.power');
		this.subscribeStates('vacation.enabled');
		this.subscribeStates('frequencyMode.setpoint');

		await this.extendObjectAsync('diagnostics.forceFallbackPoll', {
			type: 'state',
			common: {
				name: 'Force one fallback polling cycle',
				type: 'boolean',
				role: 'button',
				read: false,
				write: true,
				def: false,
			},
			native: {},
		});

		this.subscribeStates('diagnostics.forceFallbackPoll');

		await this.setStateAsync('info.connection', {
			val: false,
			ack: true,
		});

		await this.setStateAsync('device.power', {
			val: 'unknown',
			ack: true,
		});

		this.log.info('Starting passive heat pump Modbus monitoring');

		this.connect();

		this.statusTimer = this.setInterval(() => {
			void this.updateStatusStates();
			void this.runFallbackPollingCheck();
		}, 2000);
	}

	/**
	 * Removes objects from earlier development versions which have either
	 * been renamed or intentionally removed from the public state tree.
	 */
	private async removeLegacyObjects(): Promise<void> {
		const legacyIds = [
			'temperature.return',
			'temperature.flow',
			'device.operatingMode',
			'device.frequencyMode',
			'device.vacationMode',

			'status.hotWaterFlag',
			'status.heatingFlag',
			'status.coolingFlag',
			'status.dcFan1ValidityFlag',
			'status.dcFan2ValidityFlag',

			'status.rawWorkingStatus',
			'status.rawOutputFlags1',
			'status.rawOutputFlags2',
			'status.rawOutputFlags3',

			'fault.rawFlags',
		];

		for (const id of legacyIds) {
			try {
				await this.delStateAsync(id);
			} catch {
				// The state may not exist on a fresh installation.
			}

			try {
				await this.delObjectAsync(id);
			} catch {
				// The object may not exist on a fresh installation.
			}
		}
	}

	/**
	 * Creates all currently supported ioBroker states.
	 */
	private async createObjects(): Promise<void> {
		const rawDiagnosticStates = [
			{
				id: 'diagnostics.rawWorkingStatus',
				name: 'Raw working status register 0x0003',
				address: 0x0003,
			},
			{
				id: 'diagnostics.rawOutputFlags1',
				name: 'Raw output flags register 0x0004',
				address: 0x0004,
			},
			{
				id: 'diagnostics.rawOutputFlags2',
				name: 'Raw output flags register 0x0005',
				address: 0x0005,
			},
			{
				id: 'diagnostics.rawOutputFlags3',
				name: 'Raw output flags register 0x0006',
				address: 0x0006,
			},
		];

		for (const definition of rawDiagnosticStates) {
			await this.setObjectNotExistsAsync(definition.id, {
				type: 'state',
				common: {
					name: definition.name,
					type: 'number',
					role: 'value',
					read: true,
					write: false,
					min: 0,
					max: 65535,
				},
				native: {
					modbusAddress: definition.address,
				},
			});
		}

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

		await this.extendObjectAsync('device.power', {
			type: 'state',
			common: {
				name: 'Controller power state',
				type: 'string',
				role: 'text',
				read: true,
				write: true,
				states: {
					unknown: 'Unknown',
					off: 'Off',
					on: 'On',
				},
			},
			native: {
				modbusAddress: 0x003f,
				bit: 0,
			},
		});

		await this.setObjectNotExistsAsync('operatingMode.setpoint', {
			type: 'state',
			common: {
				name: 'Operating mode',
				type: 'string',
				role: 'text',
				read: true,
				write: true,
				states: {
					hotWater: 'Hot water',
					heating: 'Heating',
					cooling: 'Cooling',
					hotWaterHeating: 'Hot water + heating',
					hotWaterCooling: 'Hot water + cooling',
					unknown: 'Unknown',
				},
			},
			native: {
				modbusAddress: 0x0043,
			},
		});

		await this.extendObjectAsync('operatingMode.setpoint', {
			common: {
				write: true,
			},
		});

		await this.setObjectNotExistsAsync('frequencyMode.setpoint', {
			type: 'state',
			common: {
				name: 'Frequency mode',
				type: 'string',
				role: 'text',
				read: true,
				write: true,
				states: {
					smart: 'Smart',
					powerful: 'Powerful',
					silent: 'Silent',
					invalid: 'Invalid',
				},
			},
			native: {
				modbusAddress: 0x0040,
			},
		});

		await this.setObjectNotExistsAsync('vacation.enabled', {
			type: 'state',
			common: {
				name: 'Vacation mode',
				type: 'boolean',
				role: 'indicator',
				read: true,
				write: true,
			},
			native: {
				modbusAddress: 0x0041,
				bit: 1,
			},
		});

		await this.setObjectNotExistsAsync('vacation.setpoint', {
			type: 'state',
			common: {
				name: 'Vacation setpoint',
				type: 'number',
				role: 'value.temperature',
				read: true,
				write: false,
				unit: '°C',
			},
			native: {
				modbusAddress: 0x00d0,
				verifiedWriteRange: false,
			},
		});

		const booleanBaseStates = [
			{
				id: 'status.defrosting',
				name: 'Defrosting',
				address: 0x0003,
				bit: 7,
			},
			{
				id: 'output.compressor',
				name: 'Compressor output',
				address: 0x0004,
				bit: 0,
			},
			{
				id: 'output.fanMotor',
				name: 'Fan motor output',
				address: 0x0004,
				bit: 5,
			},
			{
				id: 'output.fourWayValve',
				name: 'Four-way valve output',
				address: 0x0004,
				bit: 6,
			},
			{
				id: 'output.chassisHeater',
				name: 'Chassis electric heater output',
				address: 0x0005,
				bit: 0,
			},
			{
				id: 'output.acElectricHeater',
				name: 'A/C electric heater output',
				address: 0x0005,
				bit: 5,
			},
			{
				id: 'output.threeWayValve',
				name: 'Three-way valve output',
				address: 0x0005,
				bit: 6,
			},
			{
				id: 'output.tankElectricHeater',
				name: 'Water tank electric heater output',
				address: 0x0005,
				bit: 7,
			},
			{
				id: 'output.circulationPump',
				name: 'Circulation pump output',
				address: 0x0006,
				bit: 0,
			},
			{
				id: 'output.crankcaseHeater',
				name: 'Crankcase electric heater output',
				address: 0x0006,
				bit: 1,
			},
			{
				id: 'fault.active',
				name: 'Active fault',
			},
		];

		for (const definition of booleanBaseStates) {
			await this.setObjectNotExistsAsync(definition.id, {
				type: 'state',
				common: {
					name: definition.name,
					type: 'boolean',
					role: 'indicator',
					read: true,
					write: false,
				},
				native: {
					modbusAddress: definition.address,
					bit: definition.bit,
				},
			});
		}

		const textFaultStates = [
			{
				id: 'fault.codes',
				name: 'Active fault codes',
			},
			{
				id: 'fault.messages',
				name: 'Active fault descriptions',
			},
			{
				id: 'diagnostics.rawFaultFlags',
				name: 'Raw fault flag registers 0x0007-0x000D',
			},
		];

		for (const definition of textFaultStates) {
			await this.setObjectNotExistsAsync(definition.id, {
				type: 'state',
				common: {
					name: definition.name,
					type: 'string',
					role: 'text',
					read: true,
					write: false,
				},
				native: {},
			});
		}

		const setpoints = [
			{
				id: 'hotWater.setpoint',
				name: 'Hot water setpoint',
				address: 0x00be,
				min: 28,
				max: 60,
			},
			{
				id: 'cooling.setpoint',
				name: 'Cooling setpoint',
				address: 0x00bf,
				min: 7,
				max: 30,
			},
			{
				id: 'heating.setpoint',
				name: 'Heating setpoint',
				address: 0x00c0,
				min: 15,
				max: 50,
			},
		];

		for (const setpoint of setpoints) {
			await this.setObjectNotExistsAsync(setpoint.id, {
				type: 'state',
				common: {
					name: setpoint.name,
					type: 'number',
					role: 'level.temperature',
					read: true,
					write: true,
					unit: '°C',
					min: setpoint.min,
					max: setpoint.max,
				},
				native: {
					modbusAddress: setpoint.address,
				},
			});
		}
		/*
		 * Setpoint states may already exist from an older adapter version.
		 * setObjectNotExistsAsync() does not update existing objects.
		 */
		for (const setpoint of setpoints) {
			await this.extendObjectAsync(setpoint.id, {
				common: {
					write: true,
				},
			});
		}

		const definitions = Object.values(deviceRegisters);

		for (const definition of definitions) {
			await this.setObjectNotExistsAsync(definition.stateId, {
				type: 'state',
				common: {
					name: definition.name,
					type: 'number',
					role: 'value',
					read: true,
					write: false,
					unit: definition.unit,
				},
				native: {
					modbusAddress: definition.address,
					scale: definition.scale,
					passive: true,
				},
			});
		}

		/*
		 * Planned but not yet verified:
		 *
		 * input.evu
		 * input.sg
		 */
	}

	/**
	 * Updates documented working, output and fault states.
	 *
	 * @param registers Register block beginning at address 0x0000.
	 */
	private async updateBaseStatusStates(registers: readonly number[]): Promise<void> {
		const status = decodeBaseStatus(registers);

		await this.setStateAsync('diagnostics.rawWorkingStatus', {
			val: registers[0x0003],
			ack: true,
		});

		await this.setStateAsync('diagnostics.rawOutputFlags1', {
			val: registers[0x0004],
			ack: true,
		});

		await this.setStateAsync('diagnostics.rawOutputFlags2', {
			val: registers[0x0005],
			ack: true,
		});

		await this.setStateAsync('diagnostics.rawOutputFlags3', {
			val: registers[0x0006],
			ack: true,
		});

		const booleanStates: Record<string, boolean> = {
			'status.defrosting': status.defrosting,

			'output.compressor': status.compressorOutput,
			'output.fanMotor': status.fanMotorOutput,
			'output.fourWayValve': status.fourWayValveOutput,
			'output.chassisHeater': status.chassisHeaterOutput,
			'output.acElectricHeater': status.acElectricHeaterOutput,
			'output.threeWayValve': status.threeWayValveOutput,
			'output.tankElectricHeater': status.tankElectricHeaterOutput,
			'output.circulationPump': status.circulationPumpOutput,
			'output.crankcaseHeater': status.crankcaseHeaterOutput,

			'fault.active': status.faultActive,
		};

		for (const [stateId, value] of Object.entries(booleanStates)) {
			await this.setStateAsync(stateId, {
				val: value,
				ack: true,
			});
		}

		await this.setStateAsync('fault.codes', {
			val: status.faultCodes.join(', '),
			ack: true,
		});

		await this.setStateAsync('fault.messages', {
			val: status.faultMessages.join(' | '),
			ack: true,
		});

		await this.setStateAsync('diagnostics.rawFaultFlags', {
			val: status.rawFaultFlags,
			ack: true,
		});
	}

	/**
	 * Opens the TCP connection to the transparent RS485 gateway.
	 */
	private connect(): void {
		const connectionType = this.config.connectionType || 'tcp';

		const slaveId = Number(this.config.slaveId || 1);

		if (connectionType === 'serial') {
			this.connectSerial(slaveId);
			return;
		}

		this.connectTcp(slaveId);
	}

	/**
	 * Handles a received raw Modbus RTU byte stream.
	 *
	 * TCP and USB / Serial transports deliberately use exactly the same
	 * parser, scheduler and active-request matcher.
	 *
	 * @param chunk Raw Modbus RTU bytes.
	 */
	private handleTransportData(chunk: Buffer): void {
		this.busScheduler.recordRx();

		this.activeTransport?.feed(chunk);

		void this.handleBusData(chunk);
	}

	/**
	 * Opens a transparent TCP-to-RS485 connection.
	 *
	 * @param slaveId Configured Modbus RTU slave ID.
	 */
	private connectTcp(slaveId: number): void {
		const host = this.config.host || '192.168.2.225';

		const port = Number(this.config.port || 502);

		this.log.info(`Opening TCP connection to ${host}:${port}, Modbus slave ${slaveId}`);

		this.socket = net.createConnection({
			host,
			port,
		});

		this.activeTransport = new SharedRtuRequestTransport(frame => {
			if (!this.socket || this.socket.destroyed) {
				throw new Error('TCP socket is not available');
			}

			this.socket.write(frame);
		});

		this.activeClient = new ActiveRtuClient(this.activeTransport, {
			slaveId,
			timeoutMs: 1500,
		});

		this.socket.on('connect', () => {
			this.log.info(`Connected to Modbus RTU gateway ${host}:${port}`);
		});

		this.socket.on('data', chunk => {
			this.handleTransportData(chunk);
		});

		this.socket.on('error', error => {
			this.log.warn(`TCP connection error: ${error.message}`);
		});

		this.socket.on('close', () => {
			this.log.warn('Modbus gateway connection closed');

			this.activeTransport?.abort('TCP socket closed');

			void this.setStateAsync('info.connection', {
				val: false,
				ack: true,
			});
		});
	}

	/**
	 * Opens a direct USB / Serial Modbus RTU connection.
	 *
	 * Serial parameters are intentionally fixed:
	 * 9600 baud, 8 data bits, no parity and 1 stop bit.
	 *
	 * @param slaveId Configured Modbus RTU slave ID.
	 */
	private connectSerial(slaveId: number): void {
		const serialDevice = this.config.serialDevice || '/dev/ttyUSB0';

		this.log.info(`Opening USB / Serial connection ${serialDevice}, 9600 8N1, Modbus slave ${slaveId}`);

		const serialPort = new SerialPort({
			path: serialDevice,
			baudRate: 9600,
			dataBits: 8,
			stopBits: 1,
			parity: 'none',
			autoOpen: false,
		});

		this.serialPort = serialPort;

		this.activeTransport = new SharedRtuRequestTransport(frame => {
			if (!this.serialPort || !this.serialPort.isOpen) {
				throw new Error('USB / Serial port is not open');
			}

			this.serialPort.write(frame, error => {
				if (error) {
					this.log.warn(`USB / Serial write error: ${error.message}`);
				}
			});
		});

		this.activeClient = new ActiveRtuClient(this.activeTransport, {
			slaveId,
			timeoutMs: 1500,
		});

		serialPort.on('data', (chunk: Buffer) => {
			this.handleTransportData(chunk);
		});

		serialPort.on('error', error => {
			this.log.warn(`USB / Serial connection error: ${error.message}`);
		});

		serialPort.on('close', () => {
			this.log.warn('USB / Serial connection closed');

			this.activeTransport?.abort('USB / Serial port closed');

			void this.setStateAsync('info.connection', {
				val: false,
				ack: true,
			});
		});

		serialPort.open(error => {
			if (error) {
				this.log.warn(`Could not open USB / Serial device ${serialDevice}: ${error.message}`);

				void this.setStateAsync('info.connection', {
					val: false,
					ack: true,
				});

				return;
			}

			this.log.info(`USB / Serial device ${serialDevice} opened successfully at 9600 8N1`);
		});
	}

	/**
	 * Performs one conservative active read test.
	 *
	 * This method never writes to the device. It only reads the already
	 * verified heating setpoint register 0x00C0.
	 */
	private async runActiveReadProbe(): Promise<void> {
		if (!this.activeClient) {
			return;
		}

		try {
			const client = this.activeClient;

			const values = await this.busScheduler.schedule(() => client.readHoldingRegisters(0x00c0, 1));

			const heatingSetpoint = values[0];

			this.log.info(`Active read probe succeeded: heating setpoint = ${heatingSetpoint} °C`);

			await this.setStateAsync('heating.setpoint', {
				val: heatingSetpoint,
				ack: true,
			});
		} catch (error) {
			this.log.warn(`Active read probe failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Processes passively received Modbus traffic.
	 *
	 * @param chunk Bytes received from the transparent TCP gateway.
	 */
	private async handleBusData(chunk: Buffer): Promise<void> {
		const events = this.parser.feed(chunk);

		for (const event of events) {
			if (event.type !== 'readResponse') {
				continue;
			}

			const timestamp = Date.now();

			this.lastBusTraffic = timestamp;
			this.lastPassiveDataAt = timestamp;

			if (event.startAddress === 0x0000 && event.quantity === 63) {
				this.lastBaseTraffic = timestamp;

				const states = mapPassiveRegisterBlock(event.startAddress, event.registers, deviceRegisters);

				for (const state of states) {
					await this.setStateAsync(state.stateId, {
						val: state.value,
						ack: true,
					});
				}

				await this.updateBaseStatusStates(event.registers);

				/*
				 * Start exactly one active read probe only after
				 * genuine passive controller traffic has been seen.
				 */
				if (!this.activeProbeStarted) {
					this.activeProbeStarted = true;
					void this.runActiveReadProbe();
				}
			}

			if (event.startAddress === 0x003f && event.quantity === 310) {
				this.lastControlBlockTraffic = timestamp;

				const control = decodeExtendedControlState(event.registers);

				this.lastControllerPower = control.power;

				await this.setStateAsync('device.power', {
					val: control.power,
					ack: true,
				});

				await this.setStateAsync('operatingMode.setpoint', {
					val: control.operatingMode,
					ack: true,
				});

				await this.setStateAsync('frequencyMode.setpoint', {
					val: control.frequencyMode,
					ack: true,
				});

				await this.setStateAsync('vacation.enabled', {
					val: control.vacationMode,
					ack: true,
				});

				await this.setStateAsync('hotWater.setpoint', {
					val: control.hotWaterSetpoint,
					ack: true,
				});

				await this.setStateAsync('cooling.setpoint', {
					val: control.coolingSetpoint,
					ack: true,
				});

				await this.setStateAsync('heating.setpoint', {
					val: control.heatingSetpoint,
					ack: true,
				});

				await this.setStateAsync('vacation.setpoint', {
					val: control.vacationSetpoint,
					ack: true,
				});
			}

			await this.updateStatusStates();
		}
	}

	/**
	 * Checks whether active fallback polling is currently required.
	 *
	 * Passive data always has priority. When passive communication is healthy,
	 * this method sends no Modbus requests.
	 */
	private async runFallbackPollingCheck(): Promise<void> {
		if (!this.activeClient) {
			return;
		}

		const enabled = this.config.fallbackPollingEnabled === true;

		const configuredIntervalSeconds = Number(this.config.fallbackPollingInterval || 60);

		const pollingIntervalMs = Math.max(30, configuredIntervalSeconds) * 1000;

		if (
			!shouldRunFallbackPoll(
				{
					enabled,
					passiveTimeoutMs: defaultPassiveTimeoutMs,
					pollingIntervalMs,
				},
				{
					now: Date.now(),
					startedAt: this.startedAt,
					lastPassiveDataAt: this.lastPassiveDataAt,
					lastFallbackPollAt: this.lastFallbackPollAt,
					pollInProgress: this.fallbackPollInProgress,
				},
			)
		) {
			return;
		}

		this.fallbackPollInProgress = true;
		this.lastFallbackPollAt = Date.now();

		this.log.info('Passive data is stale; starting active fallback polling');

		try {
			await this.runFallbackPoll();
		} catch (error) {
			this.log.warn(`Fallback polling failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.fallbackPollInProgress = false;
		}
	}

	/**
	 * Performs one read-only fallback polling cycle.
	 *
	 * All requests use standard Modbus function 03 and stay below the
	 * documented 120-register limit.
	 */
	private async runFallbackPoll(): Promise<void> {
		if (!this.activeClient) {
			return;
		}

		const client = this.activeClient;

		/*
		 * Use only register ranges verified on the real controller.
		 * Large reads spanning reserved or unused areas are intentionally
		 * avoided because the tested controller may not answer them reliably.
		 */
		const measurementBlocks = [
			{ start: 0x000e, quantity: 5, label: 'temperatures 0x000E-0x0012' },
			{ start: 0x0015, quantity: 2, label: 'temperatures 0x0015-0x0016' },
			{ start: 0x001a, quantity: 5, label: 'compressor block 0x001A-0x001E' },
			{ start: 0x0021, quantity: 4, label: 'electrical block 0x0021-0x0024' },
			{ start: 0x0026, quantity: 6, label: 'fan/pump block 0x0026-0x002B' },
			{ start: 0x002f, quantity: 7, label: 'flow/power block 0x002F-0x0035' },
		] as const;

		for (const block of measurementBlocks) {
			this.log.debug(
				`Fallback read ${block.label}: start=0x${block.start.toString(16).padStart(4, '0')} quantity=${block.quantity}`,
			);

			const registers = await this.busScheduler.schedule(() =>
				client.readHoldingRegisters(block.start, block.quantity),
			);

			const states = mapPassiveRegisterBlock(block.start, registers, deviceRegisters);

			for (const state of states) {
				await this.setStateAsync(state.stateId, {
					val: state.value,
					ack: true,
				});
			}
		}

		/*
		 * Controller state block 0x003F ... 0x0043.
		 */
		this.log.debug('Fallback read control block: 0x003F quantity 5');

		const controlRegisters = await this.busScheduler.schedule(() => client.readHoldingRegisters(0x003f, 5));

		const controlWord = controlRegisters[0];
		const frequencyWord = controlRegisters[1];
		const vacationWord = controlRegisters[2];
		const operatingModeRaw = controlRegisters[4];

		const power = (controlWord & 0x0001) !== 0 ? 'on' : 'off';

		const powerful = (frequencyWord & 0x0010) !== 0;
		const silent = (frequencyWord & 0x0020) !== 0;

		const frequencyMode = powerful && silent ? 'invalid' : powerful ? 'powerful' : silent ? 'silent' : 'smart';

		const vacationMode = (vacationWord & 0x0002) !== 0;

		const operatingModes: Record<number, string> = {
			0: 'hotWater',
			1: 'heating',
			2: 'cooling',
			3: 'hotWaterHeating',
			4: 'hotWaterCooling',
		};

		await this.setStateAsync('device.power', {
			val: power,
			ack: true,
		});

		this.lastControllerPower = power;

		await this.setStateAsync('frequencyMode.setpoint', {
			val: frequencyMode,
			ack: true,
		});

		await this.setStateAsync('vacation.enabled', {
			val: vacationMode,
			ack: true,
		});

		await this.setStateAsync('operatingMode.setpoint', {
			val: operatingModes[operatingModeRaw] ?? 'unknown',
			ack: true,
		});

		/*
		 * Setpoints verified together as a three-register read.
		 */
		this.log.debug('Fallback read setpoints: 0x00BE quantity 3');

		const setpoints = await this.busScheduler.schedule(() => client.readHoldingRegisters(0x00be, 3));

		await this.setStateAsync('hotWater.setpoint', {
			val: setpoints[0],
			ack: true,
		});

		await this.setStateAsync('cooling.setpoint', {
			val: setpoints[1],
			ack: true,
		});

		await this.setStateAsync('heating.setpoint', {
			val: setpoints[2],
			ack: true,
		});

		/*
		 * Vacation setpoint is read separately because the former large
		 * 0x00BE ... 0x00D0 read was unreliable on the tested controller.
		 */
		this.log.debug('Fallback read vacation setpoint: 0x00D0 quantity 1');

		const vacationSetpoint = await this.busScheduler.schedule(() => client.readHoldingRegisters(0x00d0, 1));

		await this.setStateAsync('vacation.setpoint', {
			val: vacationSetpoint[0],
			ack: true,
		});

		/*
		 * Active communication proves connectivity, but must not be treated
		 * as healthy passive communication.
		 */
		this.lastBusTraffic = Date.now();

		await this.setStateAsync('info.connection', {
			val: true,
			ack: true,
		});

		this.log.info(
			`Fallback polling succeeded: heating=${setpoints[2]} °C, hotWater=${setpoints[0]} °C, cooling=${setpoints[1]} °C`,
		);
	}

	/**
	 * Updates communication and controller power states.
	 */
	private async updateStatusStates(): Promise<void> {
		const timestamp = Date.now();

		const connected = this.lastBusTraffic !== undefined && timestamp - this.lastBusTraffic <= 8000;

		await this.setStateAsync('info.connection', {
			val: connected,
			ack: true,
		});

		if (!connected) {
			await this.setStateAsync('device.power', {
				val: 'unknown',
				ack: true,
			});

			return;
		}

		if (
			this.lastControlBlockTraffic !== undefined &&
			timestamp - this.lastControlBlockTraffic <= 6000 &&
			this.lastControllerPower !== undefined
		) {
			await this.setStateAsync('device.power', {
				val: this.lastControllerPower,
				ack: true,
			});

			return;
		}

		const observationStarted = this.lastBaseTraffic ?? this.startedAt;

		if (timestamp - observationStarted > 6000) {
			await this.setStateAsync('device.power', {
				val: 'off',
				ack: true,
			});
		}
	}

	/**
	 * Queues one complete user-initiated write workflow.
	 *
	 * @param label Human-readable operation label.
	 * @param operation Complete asynchronous write workflow.
	 */
	private enqueueWrite(label: string, operation: () => Promise<void>): void {
		void this.writeQueue.enqueue(operation).catch(error => {
			this.log.warn(`Queued write ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	/**
	 * Handles external state changes.
	 *
	 * Supported write states are serialized through the high-level
	 * operation queue before accessing the shared Modbus bus.
	 *
	 * @param id Changed ioBroker state id.
	 * @param state Changed state value.
	 */
	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (!state || state.ack) {
			return;
		}

		const localId = id.startsWith(`${this.namespace}.`) ? id.substring(this.namespace.length + 1) : id;

		if (localId === 'diagnostics.forceFallbackPoll') {
			if (state.val === true) {
				this.log.info('Manual fallback polling requested');

				try {
					await this.runFallbackPoll();

					this.log.info('Manual fallback polling completed');
				} catch (error) {
					this.log.warn(
						`Manual fallback polling failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			/*
			 * Reset manual fallback polling button.
			 */
			await this.setStateAsync('diagnostics.forceFallbackPoll', {
				val: false,
				ack: true,
			});

			return;
		}

		if (localId === 'hotWater.setpoint' || localId === 'cooling.setpoint' || localId === 'heating.setpoint') {
			this.enqueueWrite(localId, () => this.writeSetpoint(localId, state.val));

			return;
		}

		if (localId === 'operatingMode.setpoint') {
			this.enqueueWrite('operatingMode.setpoint', () => this.writeOperatingMode(state.val));

			return;
		}

		if (localId === 'device.power') {
			this.enqueueWrite('device.power', () => this.writePower(state.val));

			return;
		}

		if (localId === 'vacation.enabled') {
			this.enqueueWrite('vacation.enabled', () => this.writeVacationMode(state.val));

			return;
		}

		if (localId === 'frequencyMode.setpoint') {
			this.enqueueWrite('frequencyMode.setpoint', () => this.writeFrequencyMode(state.val));

			return;
		}

		this.log.warn(`Ignoring unsupported write request for ${id}: ${state.val}`);
	}

	/**
	 * Safely changes compressor frequency mode in register 0x0040.
	 *
	 * Bit 4 = Powerful
	 * Bit 5 = Silent
	 * neither = Smart
	 *
	 * @param requestedValue Requested compressor frequency mode.
	 */
	private async writeFrequencyMode(requestedValue: ioBroker.StateValue): Promise<void> {
		const modeToBits = {
			smart: 0x0000,
			powerful: 0x0010,
			silent: 0x0020,
		} as const;

		if (typeof requestedValue !== 'string' || !(requestedValue in modeToBits)) {
			this.log.warn(`Rejected frequency mode: invalid value ${requestedValue}`);

			await this.restoreFrequencyMode();
			return;
		}

		if (!this.activeClient) {
			this.log.warn('Cannot write frequency mode: active Modbus client is not available');

			return;
		}

		const requestedMode = requestedValue as keyof typeof modeToBits;

		const desiredBits = modeToBits[requestedMode];

		const client = this.activeClient;

		this.log.info(`Frequency mode change requested: ${requestedMode}`);

		try {
			let activeReadNumber = 0;

			const result = await executeSafeMaskedRegisterWrite(0x0030, desiredBits, {
				waitForBusIdle: () => this.busScheduler.waitForBusIdle(),

				readCurrentValue: async () => {
					const values = await this.busScheduler.schedule(() => client.readHoldingRegisters(0x0040, 1));

					const raw = values[0];

					activeReadNumber++;

					const powerful = (raw & 0x0010) !== 0;

					const silent = (raw & 0x0020) !== 0;

					let mode: 'smart' | 'powerful' | 'silent' | 'invalid';

					if (powerful && silent) {
						mode = 'invalid';
					} else if (powerful) {
						mode = 'powerful';
					} else if (silent) {
						mode = 'silent';
					} else {
						mode = 'smart';
					}

					this.log.info(
						`Frequency mode active read #${activeReadNumber}: ${mode}, raw=0x${raw.toString(16).padStart(4, '0')}`,
					);

					return raw;
				},

				writeValue: async value => {
					this.log.info(
						`Frequency mode complete register write value: 0x${value.toString(16).padStart(4, '0')}`,
					);

					await this.busScheduler.schedule(() => client.writeSingleRegister(0x0040, value));
				},

				sleep: milliseconds =>
					new Promise(resolve => {
						this.setTimeout(resolve, milliseconds);
					}),

				onInitialReadError: (attemptNumber, error) => {
					this.log.warn(`Frequency mode initial read #${attemptNumber} failed: ${error.message}`);
				},

				onWriteResult: (writeNumber, acknowledged, error) => {
					if (acknowledged) {
						this.log.info(`Frequency mode write #${writeNumber}: Modbus echo confirmed`);
					} else {
						this.log.warn(
							`Frequency mode write #${writeNumber}: no valid Modbus confirmation (${error?.message ?? 'unknown error'})`,
						);
					}
				},

				onReadbackError: (readbackNumber, error) => {
					this.log.warn(`Frequency mode readback #${readbackNumber} failed: ${error.message}`);
				},
			});

			if (result.status === 'confirmed' || result.status === 'unchanged') {
				await this.setStateAsync('frequencyMode.setpoint', {
					val: requestedMode,
					ack: true,
				});

				this.log.info(
					`Frequency mode ${result.status}: ${requestedMode}, writes=${result.writeCount}, readbacks=${result.readbackCount}`,
				);

				return;
			}

			this.log.warn(
				`Frequency mode write could not be confirmed: target=${requestedMode}, writes=${result.writeCount}, readbacks=${result.readbackCount}`,
			);

			await this.restoreFrequencyMode();
		} catch (error) {
			this.log.warn(`Frequency mode write failed: ${error instanceof Error ? error.message : String(error)}`);

			await this.restoreFrequencyMode();
		}
	}

	/**
	 * Reads register 0x0040 and restores the actual frequency mode.
	 */
	private async restoreFrequencyMode(): Promise<void> {
		if (!this.activeClient) {
			return;
		}

		try {
			const values = await this.busScheduler.schedule(() => this.activeClient!.readHoldingRegisters(0x0040, 1));

			const raw = values[0];

			const powerful = (raw & 0x0010) !== 0;

			const silent = (raw & 0x0020) !== 0;

			let mode: 'smart' | 'powerful' | 'silent' | 'invalid';

			if (powerful && silent) {
				mode = 'invalid';
			} else if (powerful) {
				mode = 'powerful';
			} else if (silent) {
				mode = 'silent';
			} else {
				mode = 'smart';
			}

			await this.setStateAsync('frequencyMode.setpoint', {
				val: mode,
				ack: true,
			});
		} catch (error) {
			this.log.warn(
				`Could not restore frequency mode: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Safely changes vacation mode in register 0x0041 bit 1.
	 *
	 * @param requestedValue Requested vacation-mode state.
	 */
	private async writeVacationMode(requestedValue: ioBroker.StateValue): Promise<void> {
		if (typeof requestedValue !== 'boolean') {
			this.log.warn(`Rejected vacation mode state: invalid value ${requestedValue}`);

			await this.restoreVacationMode();
			return;
		}

		if (!this.activeClient) {
			this.log.warn('Cannot write vacation mode: active Modbus client is not available');

			return;
		}

		const desiredBits = requestedValue ? 0x0002 : 0x0000;

		const client = this.activeClient;

		this.log.info(`Vacation mode change requested: ${requestedValue}`);

		try {
			let activeReadNumber = 0;

			const result = await executeSafeMaskedRegisterWrite(0x0002, desiredBits, {
				waitForBusIdle: () => this.busScheduler.waitForBusIdle(),

				readCurrentValue: async () => {
					const values = await this.busScheduler.schedule(() => client.readHoldingRegisters(0x0041, 1));

					const raw = values[0];

					activeReadNumber++;

					const active = (raw & 0x0002) !== 0;

					this.log.info(
						`Vacation mode active read #${activeReadNumber}: ${active}, raw=0x${raw.toString(16).padStart(4, '0')}`,
					);

					return raw;
				},

				writeValue: async value => {
					this.log.info(
						`Vacation mode complete register write value: 0x${value.toString(16).padStart(4, '0')}`,
					);

					await this.busScheduler.schedule(() => client.writeSingleRegister(0x0041, value));
				},

				sleep: milliseconds =>
					new Promise(resolve => {
						this.setTimeout(resolve, milliseconds);
					}),

				onInitialReadError: (attemptNumber, error) => {
					this.log.warn(`Vacation mode initial read #${attemptNumber} failed: ${error.message}`);
				},

				onWriteResult: (writeNumber, acknowledged, error) => {
					if (acknowledged) {
						this.log.info(`Vacation mode write #${writeNumber}: Modbus echo confirmed`);
					} else {
						this.log.warn(
							`Vacation mode write #${writeNumber}: no valid Modbus confirmation (${error?.message ?? 'unknown error'})`,
						);
					}
				},

				onReadbackError: (readbackNumber, error) => {
					this.log.warn(`Vacation mode readback #${readbackNumber} failed: ${error.message}`);
				},
			});

			if (result.status === 'confirmed' || result.status === 'unchanged') {
				await this.setStateAsync('vacation.enabled', {
					val: requestedValue,
					ack: true,
				});

				this.log.info(
					`Vacation mode ${result.status}: ${requestedValue}, writes=${result.writeCount}, readbacks=${result.readbackCount}`,
				);

				return;
			}

			this.log.warn(
				`Vacation mode write could not be confirmed: target=${requestedValue}, writes=${result.writeCount}, readbacks=${result.readbackCount}`,
			);

			await this.restoreVacationMode();
		} catch (error) {
			this.log.warn(`Vacation mode write failed: ${error instanceof Error ? error.message : String(error)}`);

			await this.restoreVacationMode();
		}
	}

	/**
	 * Reads register 0x0041 and restores the actual vacation-mode state.
	 */
	private async restoreVacationMode(): Promise<void> {
		if (!this.activeClient) {
			return;
		}

		try {
			const values = await this.busScheduler.schedule(() => this.activeClient!.readHoldingRegisters(0x0041, 1));

			const active = (values[0] & 0x0002) !== 0;

			await this.setStateAsync('vacation.enabled', {
				val: active,
				ack: true,
			});
		} catch (error) {
			this.log.warn(`Could not restore vacation mode: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Safely changes controller power in register 0x003F bit 0.
	 *
	 * @param requestedValue Requested logical controller power state.
	 */
	private async writePower(requestedValue: ioBroker.StateValue): Promise<void> {
		if (requestedValue !== 'on' && requestedValue !== 'off') {
			this.log.warn(`Rejected controller power state: invalid value ${requestedValue}`);

			await this.restorePower();
			return;
		}

		if (!this.activeClient) {
			this.log.warn('Cannot write controller power: active Modbus client is not available');

			return;
		}

		const desiredBits = requestedValue === 'on' ? 0x0001 : 0x0000;

		const client = this.activeClient;

		this.log.info(`Controller power change requested: ${requestedValue}`);

		try {
			let activeReadNumber = 0;

			const result = await executeSafeMaskedRegisterWrite(0x0001, desiredBits, {
				waitForBusIdle: () => this.busScheduler.waitForBusIdle(),

				readCurrentValue: async () => {
					const values = await this.busScheduler.schedule(() => client.readHoldingRegisters(0x003f, 1));

					const raw = values[0];

					activeReadNumber++;

					const power = (raw & 0x0001) !== 0 ? 'on' : 'off';

					this.log.info(
						`Controller power active read #${activeReadNumber}: ${power}, raw=0x${raw.toString(16).padStart(4, '0')}`,
					);

					return raw;
				},

				writeValue: async value => {
					this.log.info(
						`Controller power complete register write value: 0x${value.toString(16).padStart(4, '0')}`,
					);

					await this.busScheduler.schedule(() => client.writeSingleRegister(0x003f, value));
				},

				sleep: milliseconds =>
					new Promise(resolve => {
						this.setTimeout(resolve, milliseconds);
					}),

				onInitialReadError: (attemptNumber, error) => {
					this.log.warn(`Controller power initial read #${attemptNumber} failed: ${error.message}`);
				},

				onWriteResult: (writeNumber, acknowledged, error) => {
					if (acknowledged) {
						this.log.info(`Controller power write #${writeNumber}: Modbus echo confirmed`);
					} else {
						this.log.warn(
							`Controller power write #${writeNumber}: no valid Modbus confirmation (${error?.message ?? 'unknown error'})`,
						);
					}
				},

				onReadbackError: (readbackNumber, error) => {
					this.log.warn(`Controller power readback #${readbackNumber} failed: ${error.message}`);
				},
			});

			if (result.status === 'confirmed' || result.status === 'unchanged') {
				await this.setStateAsync('device.power', {
					val: requestedValue,
					ack: true,
				});

				this.lastControllerPower = requestedValue;

				this.log.info(
					`Controller power ${result.status}: ${requestedValue}, writes=${result.writeCount}, readbacks=${result.readbackCount}`,
				);

				return;
			}

			this.log.warn(
				`Controller power write could not be confirmed: target=${requestedValue}, writes=${result.writeCount}, readbacks=${result.readbackCount}`,
			);

			await this.restorePower();
		} catch (error) {
			this.log.warn(`Controller power write failed: ${error instanceof Error ? error.message : String(error)}`);

			await this.restorePower();
		}
	}

	/**
	 * Reads register 0x003F and restores the actual controller power state.
	 */
	private async restorePower(): Promise<void> {
		if (!this.activeClient) {
			return;
		}

		try {
			const values = await this.busScheduler.schedule(() => this.activeClient!.readHoldingRegisters(0x003f, 1));

			const power = (values[0] & 0x0001) !== 0 ? 'on' : 'off';

			this.lastControllerPower = power;

			await this.setStateAsync('device.power', {
				val: power,
				ack: true,
			});
		} catch (error) {
			this.log.warn(
				`Could not restore controller power: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Safely writes the operating mode register 0x0043.
	 *
	 * @param requestedValue Requested ioBroker mode.
	 */
	private async writeOperatingMode(requestedValue: ioBroker.StateValue): Promise<void> {
		const modeToRaw = {
			hotWater: 0,
			heating: 1,
			cooling: 2,
			hotWaterHeating: 3,
			hotWaterCooling: 4,
		} as const;

		if (typeof requestedValue !== 'string' || !(requestedValue in modeToRaw)) {
			this.log.warn(`Rejected operating mode: invalid value ${requestedValue}`);

			await this.restoreOperatingMode();
			return;
		}

		if (!this.activeClient) {
			this.log.warn('Cannot write operating mode: active Modbus client is not available');

			return;
		}

		const requestedMode = requestedValue as keyof typeof modeToRaw;

		const targetValue = modeToRaw[requestedMode];

		const rawToMode = ['hotWater', 'heating', 'cooling', 'hotWaterHeating', 'hotWaterCooling'] as const;

		const client = this.activeClient;

		this.log.info(`Operating mode change requested: ${requestedMode} (${targetValue})`);

		try {
			let activeReadNumber = 0;

			const result = await executeSafeRegisterWrite(targetValue, {
				waitForBusIdle: () => this.busScheduler.waitForBusIdle(),

				readCurrentValue: async () => {
					const values = await this.busScheduler.schedule(() => client.readHoldingRegisters(0x0043, 1));

					activeReadNumber++;

					const raw = values[0];

					const mode = rawToMode[raw] ?? 'unknown';

					this.log.info(`Operating mode active read #${activeReadNumber}: ${mode} (${raw})`);

					return raw;
				},

				writeValue: async value => {
					await this.busScheduler.schedule(() => client.writeSingleRegister(0x0043, value));
				},

				sleep: milliseconds =>
					new Promise(resolve => {
						this.setTimeout(resolve, milliseconds);
					}),

				onInitialReadError: (attemptNumber, error) => {
					this.log.warn(`Operating mode initial read #${attemptNumber} failed: ${error.message}`);
				},

				onWriteResult: (writeNumber, acknowledged, error) => {
					if (acknowledged) {
						this.log.info(`Operating mode write #${writeNumber}: Modbus echo confirmed`);
					} else {
						this.log.warn(
							`Operating mode write #${writeNumber}: no valid Modbus confirmation (${error?.message ?? 'unknown error'})`,
						);
					}
				},

				onReadbackError: (readbackNumber, error) => {
					this.log.warn(`Operating mode readback #${readbackNumber} failed: ${error.message}`);
				},
			});

			if (result.status === 'confirmed' || result.status === 'unchanged') {
				await this.setStateAsync('operatingMode.setpoint', {
					val: requestedMode,
					ack: true,
				});

				this.log.info(
					`Operating mode ${result.status}: ${requestedMode} (${targetValue}), writes=${result.writeCount}, readbacks=${result.readbackCount}`,
				);

				return;
			}

			this.log.warn(
				`Operating mode write could not be confirmed: target=${requestedMode} (${targetValue}), writes=${result.writeCount}, readbacks=${result.readbackCount}`,
			);

			await this.restoreOperatingMode();
		} catch (error) {
			this.log.warn(`Operating mode write failed: ${error instanceof Error ? error.message : String(error)}`);

			await this.restoreOperatingMode();
		}
	}

	/**
	 * Reads register 0x0043 and restores the actual operating mode.
	 */
	private async restoreOperatingMode(): Promise<void> {
		if (!this.activeClient) {
			return;
		}

		const rawToMode = ['hotWater', 'heating', 'cooling', 'hotWaterHeating', 'hotWaterCooling'] as const;

		try {
			const client = this.activeClient;

			const values = await this.busScheduler.schedule(() => client.readHoldingRegisters(0x0043, 1));

			const mode = rawToMode[values[0]] ?? 'unknown';

			await this.setStateAsync('operatingMode.setpoint', {
				val: mode,
				ack: true,
			});
		} catch (error) {
			this.log.warn(
				`Could not restore operating mode: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Safely writes one supported temperature setpoint.
	 *
	 * The same flash-safe write path is used for hot water, cooling and
	 * heating. The current value is read first, a write is only performed
	 * when necessary and the result must be verified by readback.
	 *
	 * @param stateId ioBroker setpoint state id.
	 * @param requestedValue Requested ioBroker value.
	 */
	private async writeSetpoint(
		stateId: 'hotWater.setpoint' | 'cooling.setpoint' | 'heating.setpoint',
		requestedValue: ioBroker.StateValue,
	): Promise<void> {
		const definitions = {
			'hotWater.setpoint': {
				label: 'Hot water setpoint',
				address: 0x00be,
				min: 28,
				max: 60,
			},
			'cooling.setpoint': {
				label: 'Cooling setpoint',
				address: 0x00bf,
				min: 7,
				max: 30,
			},
			'heating.setpoint': {
				label: 'Heating setpoint',
				address: 0x00c0,
				min: 15,
				max: 50,
			},
		} as const;

		const definition = definitions[stateId];

		if (!this.activeClient) {
			this.log.warn(`Cannot write ${definition.label}: active Modbus client is not available`);

			return;
		}

		if (
			typeof requestedValue !== 'number' ||
			!Number.isFinite(requestedValue) ||
			!Number.isInteger(requestedValue)
		) {
			this.log.warn(`Rejected ${definition.label}: invalid value ${requestedValue}`);

			await this.restoreSetpoint(stateId, definition.address);

			return;
		}

		if (requestedValue < definition.min || requestedValue > definition.max) {
			this.log.warn(
				`Rejected ${definition.label} ${requestedValue} °C: allowed range is ${definition.min}..${definition.max} °C`,
			);

			await this.restoreSetpoint(stateId, definition.address);

			return;
		}

		const client = this.activeClient;

		this.log.info(`${definition.label} change requested: ${requestedValue} °C`);

		try {
			let activeReadNumber = 0;

			const result = await executeSafeRegisterWrite(requestedValue, {
				waitForBusIdle: () => this.busScheduler.waitForBusIdle(),

				readCurrentValue: async () => {
					const values = await this.busScheduler.schedule(() =>
						client.readHoldingRegisters(definition.address, 1),
					);

					activeReadNumber++;

					this.log.info(`${definition.label} active read #${activeReadNumber}: ${values[0]} °C`);

					return values[0];
				},

				writeValue: async value => {
					await this.busScheduler.schedule(() => client.writeSingleRegister(definition.address, value));
				},

				sleep: milliseconds =>
					new Promise(resolve => {
						this.setTimeout(resolve, milliseconds);
					}),

				onInitialReadError: (attemptNumber, error) => {
					this.log.warn(`${definition.label} initial read #${attemptNumber} failed: ${error.message}`);
				},

				onWriteResult: (writeNumber, acknowledged, error) => {
					if (acknowledged) {
						this.log.info(`${definition.label} write #${writeNumber}: Modbus echo confirmed`);
					} else {
						this.log.warn(
							`${definition.label} write #${writeNumber}: no valid Modbus confirmation (${error?.message ?? 'unknown error'})`,
						);
					}
				},

				onReadbackError: (readbackNumber, error) => {
					this.log.warn(`${definition.label} readback #${readbackNumber} failed: ${error.message}`);
				},
			});

			if (result.status === 'confirmed' || result.status === 'unchanged') {
				await this.setStateAsync(stateId, {
					val: requestedValue,
					ack: true,
				});

				this.log.info(
					`${definition.label} ${result.status}: ${requestedValue} °C, writes=${result.writeCount}, readbacks=${result.readbackCount}`,
				);

				return;
			}

			this.log.warn(
				`${definition.label} write could not be confirmed: target=${requestedValue} °C, writes=${result.writeCount}, readbacks=${result.readbackCount}`,
			);

			await this.restoreSetpoint(stateId, definition.address);
		} catch (error) {
			this.log.warn(
				`${definition.label} write failed: ${error instanceof Error ? error.message : String(error)}`,
			);

			await this.restoreSetpoint(stateId, definition.address);
		}
	}

	/**
	 * Reads one actual setpoint register and restores its ioBroker state.
	 *
	 * @param stateId ioBroker state to restore.
	 * @param address Modbus register address.
	 */
	private async restoreSetpoint(stateId: string, address: number): Promise<void> {
		if (!this.activeClient) {
			return;
		}

		try {
			const client = this.activeClient;

			const values = await this.busScheduler.schedule(() => client.readHoldingRegisters(address, 1));

			await this.setStateAsync(stateId, {
				val: values[0],
				ack: true,
			});
		} catch (error) {
			this.log.warn(`Could not restore ${stateId}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Handles adapter shutdown.
	 *
	 * @param callback ioBroker unload callback.
	 */
	private onUnload(callback: () => void): void {
		try {
			if (this.statusTimer) {
				this.clearInterval(this.statusTimer);
				this.statusTimer = undefined;
			}

			this.activeTransport?.abort('Adapter is shutting down');

			if (this.serialPort) {
				if (this.serialPort.isOpen) {
					this.serialPort.close(error => {
						if (error) {
							this.log.warn(`Could not close USB / Serial port cleanly: ${error.message}`);
						}
					});
				}

				this.serialPort = undefined;
			}

			this.activeTransport = undefined;
			this.activeClient = undefined;

			if (this.socket) {
				this.socket.removeAllListeners();
				this.socket.destroy();
				this.socket = undefined;
			}

			this.log.info('SWD WP adapter stopped');

			callback();
		} catch {
			callback();
		}
	}
}

if (require.main !== module) {
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new HeatpumpModbus(options);
} else {
	void new HeatpumpModbus();
}
