/**
 * CommonJS and node.js module loader for Tasker
 *
 * Modules are loaded from the path(s) specified in the JS_PATH global variable,
 * or from the dirname of the CommonJS global var, if JS_PATH is not defined.
 * Due to limitations in Tasker, relative paths are not supported in JS_PATH or
 * the main script. Relative paths required from modules should load normally.
 *
 * @author Daniel Matthies <mageluingil@gmail.com>
 * @see http://wiki.commonjs.org/wiki/Modules/1.1
 * @version {{date}}
 */
'use strict';

/** Filesystem path */
type Filepath = string;

/** Partial definition for a Node.js package file */
type Package = {
	main?: Filepath;
}

/** 
 * Module object
 */
class Module {
	id: ModuleId;
	default: object;
	exports: object;
	
	constructor(id: ModuleId) {
		Object.defineProperty(this, 'id', { value: id });
		Object.defineProperty(this, 'default', { value: {} });
		this.exports = this.default;
	}
}

var require: RequireFn, module: Module, exports: object;
{
	// Access tasker API regardless of whether it's been wrapped in `tk`
	const tasker: TaskerApi = (typeof tk == 'object') ? tk : { global: global, readFile: readFile, shell: shell };
	
	const moduleCache: Map<Filepath, Module> = new Map();
	const resolveCache: Map<string, Filepath> = new Map();
	
	/** Return the input value */
	const identity = <Type>(arg: Type): Type => arg;
	
	/**
	 * Initialize JS search paths. Uses array to conform with CommonJS spec.
	 */
	const initJsPaths = function(): Filepath[] {
		const PATH: string = tasker.global('JS_PATH') || dirname(tasker.global('CommonJS') || '');
		
		// Use a set to remove possible duplicates
		const paths = new Set(PATH.split(':').map(normalizePath).filter(path => stat(path) == FileType.Directory));
		return Array.from(paths);
	};
	
	const cloneEnumerableProperties = function(source: object, target: object): object {
		Object.keys(source).map(name => Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(source, name) as PropertyDescriptor));
		return target;
	};
	
	const safeParseJson = function(json: string) {
		try {
			return JSON.parse(json);
		} catch(e) { /* noop */ }
	};
	
	/*********************
	 * File path helpers *
	 *********************/
	
	/**
	 * Return the last segment of a path
	 */
	const basename = function(filepath: Filepath): string | undefined {
		// Find first non-empty path segment starting from the end
		return filepath.split('/').reverse().find(identity);
	};
	
	/**
	 * Return the parent directory of a path
	 */
	const dirname = function(filepath: Filepath): Filepath {
		if (!filepath) return '.';
		// Remove all trailing segments until a non-empty segment is removed
		const segments = filepath.split('/');
		while (segments.length && !segments.pop());
		// If no segments remain, return / for absolute paths and . for relative
		return segments.join('/') || ((filepath[0] == '/') ? '/' : '.');
	};
	
	/**
	 * Return the file extension for a path
	 */
	const extname = function(filepath: Filepath): string {
		const matches = basename(filepath)?.match(/^.+(\.[^.]+)$/);
		return matches ? matches[1] : '';
	};
	
	/**
	 * Join path segments together
	 */
	const joinPath = function(...paths: string[]): Filepath {
		// Filter out any empty arguments
		return paths.filter(identity).reduce(
			(path: string, seg: string) => {
				// Ensure trailing slash on path, remove leading slash on segment
				return path.replace(/\/?$/, '/') + seg.replace(/^\//, '');
			},
			''
		);
	};
	
	/**
	 * Resolve . and .. segments and remove repeated path separators
	 */
	const normalizePath = function(filepath: Filepath): Filepath {
		const segments: string[] = [];
		for (const cur of filepath.split('/')) {
			const last = segments[segments.length - 1];
			// For .. remove the last segment (if non-empty) unless it's also ..
			if (cur == '..' && last && last != '..') {
				segments.pop();
			}
			// Append empty value only if it's the first segment (for root)
			// Append .. only if it's the first segment or preceded by ..
			// Never append .
			if ((cur || last === undefined) && cur != '.' && (cur != '..' || last === undefined || last == '..')) {
				segments.push(cur);
			}
		}
		// Retain trailing slash
		if (filepath.slice(-1) == '/') segments.push('');
		return segments.join('/');
	};
	
	/***********************
	 * File system helpers *
	 ***********************/
	
	/**
	 * Enum to represent responses from `stat`
	 */
	const FileType = {
		Directory: 'directory',
		RegularFile: 'regular file',
		Unknown: 'unknown'
	} as const;
	type FileType = string;
	
	/**
	 * Run system call to find the type of a file
	 *
	 * @param {String} filepath  The file path to check
	 * @returns {FileType}
	 */
	const stat = function(filepath: Filepath): FileType {
		// Quote path for safe shell usage
		const escapedFilepath = `'${filepath.replace(/'/g, "'\\''")}'`;
		// `stat` isn't always available in android, so use a POSIX safe test
		return tasker.shell(`
			if [ -d ${escapedFilepath} ]; then
				echo "${FileType.Directory}"
			elif [ -f ${escapedFilepath} ]; then
				echo "${FileType.RegularFile}"
			fi
		`, false, 30) || FileType.Unknown;
	};
	
	/**
	 * Determine which directories to search based on the module ID and current directory
	 */
	const resolveSearchPaths = function(moduleId: ModuleId, directory: Filepath): Filepath[] {
		if (moduleId[0] == '/') {
			// Absolute identifier; don't search within any paths
			return [''];
		} else if (/^\.{1,2}\//.test(moduleId) && directory && directory != '.') {
			// Relative identifier; only search within current directory
			return [directory];
		} else if (directory && directory != '.') {
			// Top-level identifier; also search within current directory
			return require.paths.concat([directory]);
		} else {
			return require.paths;
		}
	};
	
	/**
	 * Given a module ID, resolve it to the fully qualified path to the file
	 * that is the entry point to that module.
	 *
	 * @param {String} moduleId  Name or path for a module
	 * @param {String} directory  Directory from which the module was requested
	 * @return {String|undefined}
	 */
	const resolveFile = function(moduleId: ModuleId, directory: Filepath): Filepath | undefined {
		// Cache results to prevent unnecessary filesystem calls
		const cache = resolveCache, key = JSON.stringify([...arguments]);
		if (cache.has(key)) return cache.get(key);
		
		// Some module IDs need to modify the search paths
		const paths = resolveSearchPaths(moduleId, directory);
		for (const path of paths) {
			const filepath = normalizePath(joinPath(path, moduleId));
			const filetype = stat(filepath);
			
			if (filetype == FileType.RegularFile) {
				return cache.set(key, filepath).get(key);
			} else if (filetype == FileType.Directory) {
				const file = resolvePackage(filepath);
				if (file) return cache.set(key, file).get(key);
			}
			
			// If it's not a path, check if it's a module in node_modules/
			if (moduleId.indexOf('/') == -1 && basename(path) != 'node_modules') {
				const modulepath = normalizePath(joinPath(path, 'node_modules', moduleId));
				const file = stat(modulepath) == FileType.Directory && resolvePackage(modulepath);
				if (file) return cache.set(key, file).get(key);
			}
			
			// Maybe it's just missing an extension
			if (filepath.slice(-1) != '/') {
				const file = resolveExtension(filepath);
				if (file) return cache.set(key, file).get(key);
			}
		}
	};
	
	/**
	 * Resolve a given directory path to the main file for a CommonJS package
	 *
	 * @param  {String} filepath  The directory to resolve
	 * @return {String|undefined}
	 */
	const resolvePackage = function(filepath: Filepath): Filepath | undefined {
		// Check for package definition
		const pkgfile = joinPath(filepath, 'package.json');
		const pkg = stat(pkgfile) == FileType.RegularFile ? safeParseJson(tasker.readFile(pkgfile)) as Package : undefined;
		if (pkg?.main) {
			if (stat(pkg.main) == FileType.Directory) {
				// Support package.main set to a directory (for node.js modules)
				return resolveExtension(joinPath(pkg.main, 'index'));
			} else {
				const main = normalizePath(joinPath(filepath, pkg.main));
				return resolveExtension(main, true);
			}
		} else {
			// For node.js, the default main is index.js[on]
			return resolveExtension(joinPath(filepath, 'index'));
		}
	};
	
	/**
	 * Resolve a filepath without a file extension to an existing file
	 *
	 * @param {String} filepath The path to the file
	 * @param {Boolean} checkWithNoExt Whether to check for the file without
	 *  appending an extension
	 * @return {String|undefined}
	 */
	const resolveExtension = function(filepath: Filepath, checkWithNoExt: boolean = false): Filepath | undefined {
		if (checkWithNoExt && stat(filepath) == FileType.RegularFile) return filepath;
		for (const ext of ['.js', '.json']) {
			if (stat(filepath + ext) == FileType.RegularFile) return filepath + ext;
		}
	};
	
	/****************************
	 * Module loading functions *
	 ****************************/
	
	/**
	 * Parse a file as a module
	 */
	const loadFile = function(filepath: Filepath): Module | undefined {
		// Return cached module if available
		if (moduleCache.has(filepath)) return moduleCache.get(filepath);
		
		// Return undefined if file is inaccessible or empty
		const source = tasker.readFile(filepath);
		if (!source) return;
		
		// Prevent cyclic dependencies by caching before parsing
		const module = new Module(filepath);
		moduleCache.set(filepath, module);
		
		// Load by file extension (supports json and js)
		if (extname(filepath) == '.json') {
			// Allow exceptions to bubble up
			module.exports = JSON.parse(source);
		} else {
			// Run in module scope
			const namespacedRequire = cloneEnumerableProperties(require, require.bind(module));
			const functionBody = `${source};(${resolveExports.toString()})();`;
			const fn = new Function('require', 'module', 'exports', functionBody);
			fn.call(module, namespacedRequire, module, module.exports);
		}
		
		return module;
	};
	
	/**
	 * Allow setting exported API by assignment to either `module.exports` or `exports`
	 */
	const resolveExports = function() {
		switch (module.default) {
			case module.exports:
				if (module.exports !== exports) {
					// `exports` was modified directly, update `module.exports`
					module.exports = exports;
				}
				break;
			case exports:
				// `module.exports` was modified directly, no change needed
				break;
			default:
				// Both `exports` and `module.exports` were reassigned
				if (module.exports !== exports) {
					throw new Error('Failed to resolve export - \'exports\' and \'module.exports\' have been assigned different values.');
				}
		}
	};
	
	/**
	 * Load a module
	 *
	 * @param {String} moduleId  Name or path for a module
	 * @return {Object}
	 */
	require = function(moduleId: ModuleId) {
		// If require was called from a module, save a reference to it
		const parent = (this instanceof Module) ? this : require.main;
		
		// Canonicalize module name
		const filepath = resolveFile(moduleId, dirname(parent.id));
		if (!filepath) {
			throw new Error('Module "' + moduleId + '" not found');
		}
		
		// Check for cached, or load new
		const module = loadFile(filepath);
		if (!module) {
			throw new Error('Failed to load module "' + moduleId + '"');
		}
		
		return module.exports;
	} as RequireFn;
	
	// Initialize main module and paths
	Object.defineProperty(require, 'main', { value: new Module(''), enumerable: true, configurable: false });
	Object.defineProperty(require, 'paths', { value: initJsPaths(), enumerable: true, configurable: false });
	
	module = require.main;
	exports = module.exports;
}
