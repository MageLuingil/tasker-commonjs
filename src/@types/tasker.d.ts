/**
 * Global tasker function definitions
 */

/** Tasker `global` function. This overrides the native node.js `global` */
declare var global: (varName: string) => string;
declare function readFile(path: string): string;
declare function shell(command: string): string;
