/**
 * Common types used in the require module system and unit tests.
 */

/** String identifier (name or path) of a module */
type ModuleId = string;

/** Require function type definition */
type RequireFn = {
	main: Module;
	paths: string[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(moduleId: ModuleId): any;
}

/** Public interface of the module class */
interface Module {
	id: ModuleId;
	default: object;
	exports: object;
}
