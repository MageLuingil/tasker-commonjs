import { MockTaskerJsFileTask } from './taskerJavascriptTaskRunner.mock';

/**
 * Runs `require()` in a mock Tasker runtime environment.
 * 
 * Tasker runs Javascript tasks inside an Android webview, with a number of extra functions available in the global
 * scope. This mock uses a protected scope in which we override the `require`, `module`, and `exports` values.
 */
export default class MockTaskerCommonJsContext {
	contextName: string;
	scriptPath: string;
	globals: Record<string, string>;
	
	/**
	 * @param name Name for the collection of tests to be run in this context
	 * @param requireJsPath Path to the require.js file
	 * @param modulePath Path to the base modules directory for tests
	 */
	constructor(name: string, requireJsPath: string, modulePath?: string) {
		this.contextName = name;
		this.scriptPath = requireJsPath;
		this.globals = { 'CommonJS': requireJsPath };
		if (modulePath) this.globals['JS_PATH'] = modulePath;
	}
	
	runInContext(callback: (require: RequireFn, module: Module, exports: unknown) => void) {
		new MockTaskerJsFileTask(this.scriptPath, callback, 'require', 'module', 'exports')
			.withEnvironment({ globals: this.globals })
			.run();
	}
	
	testInContext(callback: (require: RequireFn, module: Module, exports: unknown) => void) {
		describe(this.contextName, () => this.runInContext(callback));
	}
}
