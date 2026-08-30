import type { RegisterDefinition } from './registers';

/**
 * Additional status registers verified on the tested SWD WP6 R290.
 *
 * Some registers are marked as reserved in PW58329 but contain additional
 * status values on the tested real device firmware.
 */
export const statusRegisters: Record<string, RegisterDefinition> = {
	suctionGasTemperature: {
		address: 0x0015,
		name: 'Suction gas temperature',
		stateId: 'temperature.suctionGas',
		scale: 0.5,
		unit: '°C',
		signed: true,
	},

	evaporatorTemperature: {
		address: 0x0016,
		name: 'Evaporator temperature',
		stateId: 'temperature.evaporator',
		scale: 0.5,
		unit: '°C',
		signed: true,
	},

	innerCoilTemperature: {
		address: 0x001a,
		name: 'Inner coil temperature',
		stateId: 'temperature.innerCoil',
		scale: 0.5,
		unit: '°C',
		signed: true,
	},

	exhaustGasTemperature: {
		address: 0x001b,
		name: 'Exhaust gas temperature',
		stateId: 'temperature.exhaustGas',
		scale: 1,
		unit: '°C',
		signed: true,
	},

	mainExpansionValve: {
		address: 0x001c,
		name: 'Main expansion valve opening',
		stateId: 'expansionValve.main',
		scale: 1,
		unit: 'P',
	},

	auxExpansionValve: {
		address: 0x001d,
		name: 'Auxiliary expansion valve opening',
		stateId: 'expansionValve.auxiliary',
		scale: 1,
		unit: 'P',
	},

	compressorFrequency: {
		address: 0x001e,
		name: 'Compressor actual frequency',
		stateId: 'compressor.frequency',
		scale: 1,
		unit: 'Hz',
	},

	dcBusVoltage: {
		address: 0x0021,
		name: 'DC bus voltage',
		stateId: 'electrical.dcBusVoltage',
		scale: 1,
		unit: 'V',
	},

	heatSinkTemperature: {
		address: 0x0022,
		name: 'Heat sink temperature',
		stateId: 'temperature.heatSink',
		scale: 0.5,
		unit: '°C',
		signed: true,
	},

	compressorCurrent: {
		address: 0x0023,
		name: 'Compressor current',
		stateId: 'compressor.current',
		scale: 0.1,
		unit: 'A',
	},

	compressorTargetFrequency: {
		address: 0x0024,
		name: 'Compressor target frequency',
		stateId: 'compressor.targetFrequency',
		scale: 1,
		unit: 'Hz',
	},

	fanSpeed1: {
		address: 0x0026,
		name: 'DC fan 1 speed',
		stateId: 'fan.speed1',
		scale: 1,
		unit: 'rpm',
	},

	fanSpeed2: {
		address: 0x0027,
		name: 'DC fan 2 speed',
		stateId: 'fan.speed2',
		scale: 1,
		unit: 'rpm',
	},

	lowPressureConversionTemperature: {
		address: 0x0028,
		name: 'Low pressure conversion temperature',
		stateId: 'temperature.lowPressureConversion',
		scale: 0.1,
		unit: '°C',
		signed: true,
	},

	waterPumpActualSpeed: {
		address: 0x002a,
		name: 'DC water pump actual speed',
		stateId: 'pump.speed',
		scale: 0.1,
		unit: '%',
	},

	lowPressure: {
		address: 0x002b,
		name: 'Low pressure',
		stateId: 'pressure.low',
		scale: 0.01,
		unit: 'bar',
	},

	waterPumpTargetSpeed: {
		address: 0x002f,
		name: 'DC water pump target speed',
		stateId: 'pump.targetSpeed',
		scale: 1,
		unit: '%',
	},

	waterFlow: {
		address: 0x0030,
		name: 'Water flow',
		stateId: 'water.flow',
		scale: 0.01,
		unit: 'm³/h',
	},

	mainsVoltage: {
		address: 0x0031,
		name: 'Mains voltage',
		stateId: 'electrical.voltage',
		scale: 1,
		unit: 'V',
	},

	totalCurrent: {
		address: 0x0032,
		name: 'Total machine current',
		stateId: 'electrical.current',
		scale: 0.1,
		unit: 'A',
	},

	totalPower: {
		address: 0x0035,
		name: 'Total machine power',
		stateId: 'electrical.power',
		scale: 1,
		unit: 'W',
	},
};
