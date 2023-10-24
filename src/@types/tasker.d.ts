/**
 * Global tasker function definitions
 */

/** Tasker `global` function. This overrides the native node.js `global` */
declare var global: (varName: string) => string | undefined;
declare function readFile(path: string): string;
declare function shell(command: string, asRoot?: boolean, timeoutSecs?: number): string;

declare const tk = {
	global: global,
	readFile: readFile,
	shell: shell,
};
type TaskerApi = typeof tk
