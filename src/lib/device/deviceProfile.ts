import { type RegisterDefinition, verifiedRegisters } from './registers';
import { statusRegisters } from './statusRegisters';

/**
 * Register profile currently verified on the tested SWD WP6 R290.
 *
 * EVU and SG are intentionally not included yet:
 * - input.evu: planned, not yet verified
 * - input.sg: planned, not yet verified
 */
export const deviceRegisters: Record<string, RegisterDefinition> = {
	...verifiedRegisters,
	...statusRegisters,
};
