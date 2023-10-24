import { execSync } from 'child_process';
import { readFileSync } from 'node:fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CallbackFunction = (...args: any[]) => void;
type FunctionWithCallback = (cb: CallbackFunction) => void;
type VoidFunction = () => void;

interface TaskerEnvironment {
	cwd?: string,
	globals?: Record<string, string>,
}

/**********************
 * Mock Task Wrappers *
 **********************/

/**
 * Representation of a task to run in the mock tasker environment
 */
abstract class TaskerAction {
	source: string;
	parameters: Record<string, unknown>;
	runner: TaskerActionRunner;
	
	constructor(source: string, parameters: Record<string, unknown>) {
		this.source = source;
		this.parameters = parameters;
	}
	
	/**
	 * Updates the environment in the action runner
	 */
	withEnvironment(env: TaskerEnvironment) {
		if (env.cwd) this.runner.cwd = env.cwd;
		if (env.globals) this.runner.globalMap = new Map(Object.entries(env.globals));
		return this;
	}
	
	run() { this.runner.run(this); }
}

abstract class MockTaskerAction extends TaskerAction {
	runner = new MockTaskerActionRunner();
}

/**
 * Wraps arbitrary javascript to be run in a mock tasker environment
 */
export class MockTaskerJsTask extends MockTaskerAction {
	constructor(source: string, callback?: CallbackFunction, ...argNames: string[]) {
		const callbackDefinition = callback ? `MockTaskerActionJsTaskCallback(${argNames.join(', ')});` : '';
		const actionDefinition = `${source};${callbackDefinition}`;
		super(actionDefinition, { 'MockTaskerActionJsTaskCallback': callback });
	}
}

/**
 * Wraps a javascript file to be run in a mock tasker environment
 */
export class MockTaskerJsFileTask extends MockTaskerJsTask {
	constructor(filename: string, callback?: CallbackFunction, ...argNames: string[]) {
		const actionSource = readFileSync(filename.toString(), 'utf8');
		super(actionSource, callback, ...argNames);
		this.withEnvironment({ cwd: path.dirname(filename) });
	}
}

/**
 * Wraps a javascript function to be run in a mock tasker environment
 */
export class MockTaskerJsFunctionTask extends MockTaskerAction {
	constructor(fn: FunctionWithCallback | VoidFunction, callback?: CallbackFunction) {
		const callbackIdentifier = callback ? 'MockTaskerActionJsFunctionTaskCallback' : '';
		const actionDefinition = `(${fn})(${callbackIdentifier});`;
		super(actionDefinition, { 'MockTaskerActionJsFunctionTaskCallback': callback });
	}
}

/************************
 * Tasker Action Runner *
 ************************/

/**
 * Provides an environment in which to run tasker actions
 */
abstract class TaskerActionRunner {
	cwd: string = process.cwd();
	globalMap: Map<string, string> = new Map();
	abstract run(action: TaskerAction): void;
}

class MockTaskerActionRunner extends TaskerActionRunner {
	tkFunctions = {
		'global': this.global.bind(this),
		'readFile': this.readFile,
		'shell': this.shell.bind(this),
	};
	
	run(action: TaskerAction) {
		const fnNames = Object.keys(this.tkFunctions);
		const argNames = Object.keys(action.parameters);
		const taskRunner = new Function(...fnNames, ...argNames, action.source);
		
		const fnValues = Object.values(this.tkFunctions);
		const argValues = Object.values(action.parameters);
		taskRunner(...fnValues, ...argValues);
	}
	
	/*
	 * Mock tasker functions
	 */
	
	global(name: string): string | undefined {
		return this.globalMap.get(name);
	}
	
	readFile(path: string): string {
		return readFileSync(path, 'utf8');
	}
	
	shell(command: string, asRoot: boolean = false, timeoutSecs: number = 0): string {
		const timeout = (timeoutSecs) * 1000;
		return execSync(command, {
			cwd: this.cwd,
			timeout: timeout,
			maxBuffer: 750 * 1024,
			encoding: 'utf8',
		}).trim();
	}
}
