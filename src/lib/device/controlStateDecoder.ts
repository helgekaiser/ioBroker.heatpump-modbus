/**
 * Operating modes documented by the SWD Modbus protocol.
 */
export type OperatingMode = 'hotWater' | 'heating' | 'cooling' | 'hotWaterHeating' | 'hotWaterCooling' | 'unknown';

/**
 * Compressor frequency modes offered by the controller.
 */
export type FrequencyMode = 'smart' | 'powerful' | 'silent' | 'invalid';

/**
 * Decoded values from the vendor-specific extended register block
 * starting at 0x003F.
 */
export interface ExtendedControlState {
	/** Logical controller power switch. */
	power: 'on' | 'off';

	/** Selected heating/cooling/hot-water operating mode. */
	operatingMode: OperatingMode;

	/** Selected compressor frequency mode. */
	frequencyMode: FrequencyMode;

	/** Whether vacation mode is enabled. */
	vacationMode: boolean;

	/** Domestic hot-water target temperature in °C. */
	hotWaterSetpoint: number;

	/** Cooling target temperature in °C. */
	coolingSetpoint: number;

	/** Heating target temperature in °C. */
	heatingSetpoint: number;

	/** Vacation-mode target temperature in °C. */
	vacationSetpoint: number;

	/** Raw register 0x003F. */
	rawParameterFlag1: number;

	/** Raw register 0x0040. */
	rawControlFlag1: number;

	/** Raw register 0x0041. */
	rawControlFlag2: number;

	/** Raw operating-mode register 0x0043. */
	rawMode: number;
}

/**
 * Returns one register from an extended block starting at 0x003F.
 *
 * @param registers Register values.
 * @param address Absolute Modbus register address.
 */
function getRegister(registers: readonly number[], address: number): number {
	const index = address - 0x003f;

	if (index < 0 || index >= registers.length) {
		throw new Error(`Register 0x${address.toString(16)} is outside the extended block`);
	}

	return registers[index];
}

/**
 * Converts the numeric operating mode into a stable adapter value.
 *
 * @param raw Raw value from register 0x0043.
 */
function decodeOperatingMode(raw: number): OperatingMode {
	switch (raw) {
		case 0:
			return 'hotWater';

		case 1:
			return 'heating';

		case 2:
			return 'cooling';

		case 3:
			return 'hotWaterHeating';

		case 4:
			return 'hotWaterCooling';

		default:
			return 'unknown';
	}
}

/**
 * Decodes Smart / Powerful / Silent from control flag 0x0040.
 *
 * Powerful = bit 4
 * Silent   = bit 5
 * Smart    = neither bit set
 *
 * @param raw Raw value from register 0x0040.
 */
function decodeFrequencyMode(raw: number): FrequencyMode {
	const powerful = (raw & (1 << 4)) !== 0;
	const silent = (raw & (1 << 5)) !== 0;

	if (powerful && silent) {
		return 'invalid';
	}

	if (powerful) {
		return 'powerful';
	}

	if (silent) {
		return 'silent';
	}

	return 'smart';
}

/**
 * Decodes the extended 0x003F controller block.
 *
 * @param registers Register block beginning at 0x003F.
 */
export function decodeExtendedControlState(registers: readonly number[]): ExtendedControlState {
	const parameterFlag1 = getRegister(registers, 0x003f);
	const controlFlag1 = getRegister(registers, 0x0040);
	const controlFlag2 = getRegister(registers, 0x0041);
	const mode = getRegister(registers, 0x0043);

	return {
		power: (parameterFlag1 & 0x0001) !== 0 ? 'on' : 'off',

		operatingMode: decodeOperatingMode(mode),

		frequencyMode: decodeFrequencyMode(controlFlag1),

		vacationMode: (controlFlag2 & (1 << 1)) !== 0,

		hotWaterSetpoint: getRegister(registers, 0x00be),

		coolingSetpoint: getRegister(registers, 0x00bf),

		heatingSetpoint: getRegister(registers, 0x00c0),

		vacationSetpoint: getRegister(registers, 0x00d0),

		rawParameterFlag1: parameterFlag1,
		rawControlFlag1: controlFlag1,
		rawControlFlag2: controlFlag2,
		rawMode: mode,
	};
}
