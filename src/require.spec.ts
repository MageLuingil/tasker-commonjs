import { assert } from 'chai';
import { readFileSync } from 'node:fs';
import * as path from 'path';
import MockTaskerCommonJsContext from './taskerCommonJsContext.mock';

const ProjectDir = path.normalize(`${__dirname}/..`);
const ScriptPath = `${ProjectDir}/build/require.js`;
const ModulePath = `${ProjectDir}/test/modules`;

const context = new MockTaskerCommonJsContext('tasker-commonjs', ScriptPath, ModulePath);
context.testInContext((require, module, exports) => {
	describe('require', () => {
		// In a module, there is a free variable "require", that is a Function. 
		it('should be a function', () => {
			assert.isFunction(require);
		});
		
		// The "require" function accepts a module identifier.
		// "require" returns the exported API of the foreign module.
		it('should return the exported API', () => {
			const loadedWithExtension = require('moduleThatHasLogic.js');
			const loadedWithNoExtension = require('moduleThatHasLogic');
			assert.isObject(loadedWithExtension);
			assert.equal(loadedWithExtension.result, 2);
			assert.equal(loadedWithExtension, loadedWithNoExtension);
		});
		
		it('should load json files', () => {
			const expected = JSON.parse(readFileSync(`${ModulePath}/jsonModule.json`, 'utf8'));
			const loadedWithExtension = require('jsonModule.json');
			const loadedWithNoExtension = require('jsonModule');
			assert.deepEqual(loadedWithExtension, expected);
			assert.deepEqual(loadedWithExtension, loadedWithNoExtension);
		});
		
		it('should load node modules', () => {
			const nodeModuleWithIndex = require('node-module-with-index');
			assert.include(nodeModuleWithIndex, { 'node-module-with-index': true });
			const nodeModuleWithMain = require('node-module-with-main');
			assert.include(nodeModuleWithMain, { 'node-module-with-main': true });
			const nodeModuleWithJson = require('node-module-with-json');
			assert.include(nodeModuleWithJson, { 'node-module-with-json': true });
		});
		
		it('should load relative paths', () => {
			const relativeModule = require('./subdir1/moduleInSubDirectory');
			assert.include(relativeModule, { moduleInSubDirectory: true });
			assert.throws(() => require('./subdir1/moduleWithMissingRelativeDependency'));
		});
		
		it('should load absolute paths', () => {
			const absoluteModule = require(`${ModulePath}/subdir1/moduleInSubDirectory`);
			assert.include(absoluteModule, { moduleInSubDirectory: true });
			assert.throws(() => require('/jsonModule'));
		});
		
		it('should load submodules', () => {
			const moduleWithModules = require('moduleThatLoadsModules');
			assert.include(moduleWithModules, {
				moduleInSameDirectory: true,
				moduleInSubDirectory: true,
			});
		});
		
		// If there is a dependency cycle, the foreign module may not have finished executing at the time it is required
		// by one of its transitive dependencies; in this case, the object returned by "require" must contain at least the
		// exports that the foreign module has prepared before the call to require that led to the current module's execution.
		it('should handle circular dependencies', () => {
			const circularDep1 = require('circularDep1');
			const circularDep2 = circularDep1.circularDep2;
			assert.strictEqual(circularDep1.circularDep2, circularDep2);
			assert.strictEqual(circularDep2.circularDep1, circularDep1);
			assert.equal(circularDep2.dep1pre, circularDep1.pre);
			assert.equal(circularDep1.dep2pre, circularDep2.pre);
		});
		
		// If the requested module cannot be returned, "require" must throw an error.
		it('should throw for non-existant modules', () => {
			assert.throws(() => require('moduleThatDoesNotExist'));
		});
		
		// The "require" function may have a "main" property that is read-only, don't delete and represents the top-level
		// "module" object of the program. 
		describe('require.main', () => {
			it('should be a module', () => {
				assert.isObject(require.main);
				// Because the `Module` class is defined outside the scope of the node.js ecosystem, we can't compare
				// the constructor directly - we have to check by name instead.
				assert.equal(require.main.constructor.name, 'Module');
			});
			
			it('should be read-only', () => {
				const prop = Object.getOwnPropertyDescriptor(require, 'main');
				assert.isFalse(prop?.writable);
			});
			
			// If this property is provided, it must be referentially identical to the "module" object of the main program.
			it('should be referentially identical to the main module', () => {
				assert.strictEqual(require.main, module);
			});
		});
		
		// The "require" function may have a "paths" attribute, that is a prioritized Array of path Strings
		describe('require.paths', () => {
			it('should be an array of strings', () => {
				assert.isArray(require.paths);
				assert.isString(require.paths[0]);
			});
			
			// In-place modification of the contents of "paths" must be reflected by corresponding module search behavior.
			it('should change module search behavior, should load in prioritized order', () => {
				require.paths.push(`${ModulePath}/subdir1`);
				assert.doesNotThrow(() => require('moduleInSubDirectory'));
				
				require.paths.push(`${ModulePath}/subdir2`);
				const duplicateDependency = require('moduleWithDuplicateName');
				assert.equal(duplicateDependency, 'duplicate 1');
			});
			
			// The "paths" attribute must be referentially identical in all modules.
			it('should be referentially identical in all modules', () => {
				const echoModule = require('echoCommonJs');
				assert.strictEqual(require.paths, echoModule.require.paths);
			});
			
			// Replacing the "paths" object with an alternate object may have no effect.
			it('should not be mutable', () => {
				const origPaths = require.paths;
				// Modifying non-writable properties throws in strict mode
				assert.throw(() => require.paths = []);
				assert.throw(() => Object.defineProperty(require, 'paths', { value: [] }));
				assert.strictEqual(require.paths, origPaths);
			});
		});
	});
	
	// In a module, there is a free variable called "exports", that is an object that the module may add its API to as it executes.
	describe('exports', () => {
		it('should exist', () => assert.isObject(exports));
		it('should be mutable', () => assert.doesNotThrow(() => { exports = 'Lonk'; }));
		it('should export module API', () => {
			const directExport = require('moduleThatSetsExports');
			assert.include(directExport, { moduleThatSetsExports: true });
			const modifyExport = require('moduleThatUpdatesExports');
			assert.include(modifyExport, { moduleThatUpdatesExports: true });
		});
	});
	
	// In a module, there must be a free variable "module", that is an Object. 
	describe('module', () => {
		it('should be an object', () => assert.isObject(module));
		
		// The "module" object must have a read-only, don't delete "id" property that is the top-level "id" of the module.
		it('should define module.id', () => {
			assert.isString(module.id);
			const prop = Object.getOwnPropertyDescriptor(module, 'id');
			assert.equal(prop?.writable, false);
		});
		
		// The "id" property must be such that require(module.id) will return the exports object from which the module.id
		// originated. (That is to say module.id can be passed to another module, and requiring that must return the original module).
		it('require(module.id) should return the original exports object', () => {
			const echoModule = require('echoCommonJs');
			const reloadModule = require(echoModule.module.id);
			assert.strictEqual(echoModule, reloadModule);
		});
		
		it('should implement module.exports', () => {
			assert.isObject(module.exports);
			const directExport = require('moduleThatSetsModuleExports');
			assert.include(directExport, { moduleThatSetsModuleExports: true });
			const modifyExport = require('moduleThatUpdatesModuleExports');
			assert.include(modifyExport, { moduleThatUpdatesModuleExports: true });
		});
		
		it('should allow updating both exports and module.exports', () => {
			const modifyExport = require('moduleThatUpdatesBoth');
			assert.include(modifyExport, { moduleThatUpdatesExports: true });
			assert.include(modifyExport, { moduleThatUpdatesModuleExports: true });
		});
		
		it('should not allow directly assigning both exports and module.exports', () => {
			assert.throws(() => require('moduleThatSetsBoth'));
		});
	});
});
