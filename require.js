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
 * @version 2023/10/20
 */

/**
 * Module object
 */
class Module {
	constructor(id) {
		Object.defineProperty(this, 'id', { value: id });
		this.exports = {};
	}
}

var require, module, exports;
{
	const moduleCache = new Map();
	const resolveCache = new Map();
	
	const identity = (arg) => arg;
	
	/****************
	 * Misc helpers *
	 ****************/
	
	/**
	 * Initialize JS search paths. Uses array to conform with CommonJS spec.
	 */
	const initJsPaths = function() {
		const PATH = global('JS_PATH') || dirname(global('CommonJS'));
		
		// Use a set to remove possible duplicates
		const paths = new Set(PATH.split(':').map(normalizePath).filter(stat));
		return Array.from(paths);
	};
	
	const cloneEnumerableProperties = function(target, source) {
		Object.keys(source).map(name => Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(source, name)));
		return target;
	};
	
	const safeParseJson = function(str) {
		try {
			return JSON.parse(str);
		} catch (e) {}
	};
	
	/*********************
	 * File path helpers *
	 *********************/
	
	/**
	 * Return the last segment of a path
	 */
	const basename = function(filepath) {
		// Find first non-empty path segment starting from the end
		return filepath.split('/').reverse().find(identity);
	};
	
	/**
	 * Return the parent directory of a path
	 */
	const dirname = function(filepath) {
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
	const extname = function(filepath) {
		const matches = basename(filepath).match(/^.+(\.[^.]+)$/);
		return matches ? matches[1] : '';
	};
	
	/**
	 * Join path segments together
	 */
	const joinPath = function(...paths) {
		// Filter out any empty arguments
		return paths.filter(identity).reduce((path, seg) => {
			// Ensure trailing slash on path, remove leading slash on segment
			return path.replace(/\/?$/, '/') + seg.replace(/^\//, '');
		}, '');
	};
	
	/**
	 * Resolve . and .. segments and remove repeated path separators
	 */
	const normalizePath = function(filepath) {
		const segments = [];
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
	 * Run system call to find the type of a file
	 *
	 * @param {String} filepath  The file path to check
	 * @return {String}
	 */
	const stat = function(filepath) {
		// Quote path for safe shell usage
		const escapedFilepath = "'" + filepath.replace(/'/g, "'\\''") + "'";
		// `stat` isn't always available in android, so use a POSIX safe test
		return shell(`
			if [ -d ${escapedFilepath} ]; then
				echo "directory"
			elif [ -f ${escapedFilepath} ]; then
				echo "regular file"
			fi
		`);
	};
	
	/**
	 * Determine which directories to search based on the module ID and current directory
	 */
	const resolveSearchPaths = function(moduleId, directory) {
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
	const resolveFile = function(moduleId, directory) {
		// Cache results to prevent unnecessary filesystem calls
		const cache = resolveCache, key = JSON.stringify([...arguments]);
		if (cache.has(key)) return cache.get(key);
		
		// For most module identifiers, search within predefined paths
		const paths = resolveSearchPaths(moduleId, directory);
		for (const path of paths) {
			const filepath = normalizePath(joinPath(path, moduleId));
			const filetype = stat(filepath);
			
			if (filetype == 'regular file') {
				return cache.set(key, filepath).get(key);
			} else if (filetype == 'directory') {
				const file = resolvePackage(filepath);
				if (file) return cache.set(key, file).get(key);
			}
			
			// If it's not a path, check if it's a module in node_modules/
			if (moduleId.indexOf('/') == -1 && basename(path) != 'node_modules') {
				const modulepath = normalizePath(joinPath(path, 'node_modules', moduleId));
				const file = stat(modulepath) && resolvePackage(modulepath);
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
	const resolvePackage = function(filepath) {
		// Check for package definition
		const pkgfile = joinPath(filepath, 'package.json');
		const pkg = stat(pkgfile) == 'regular file' ? safeParseJson(readFile(pkgfile)) : undefined;
		if (pkg && pkg.main) {
			if (stat(pkg.main) == 'directory') {
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
	const resolveExtension = function(filepath, checkWithNoExt) {
		if (checkWithNoExt && stat(filepath) == 'regular file') return filepath;
		for (const ext of ['.js', '.json']) {
			if (stat(filepath + ext) == 'regular file') return filepath + ext;
		}
	};
	
	/******************
	 * Main functions *
	 ******************/
	
	/**
	 * Parse a file as a module
	 */
	const loadFile = function(filepath) {
		// Return cached module if available
		if (moduleCache.has(filepath)) return moduleCache.get(filepath);
		
		// Return undefined if file is inaccessible or empty
		const source = readFile(filepath);
		if (!source) return;
		
		// Prevent cyclic dependencies by caching before parsing
		const module = new Module(filepath);
		moduleCache.set(filepath, module);
		
		// Load by file extension (supports json and js)
		if (extname(filepath) == '.json') {
			module.exports = JSON.parse(source);
		} else {
			// Run in module scope
			const namespacedRequire = cloneEnumerableProperties(require.bind(module), require);
			const fn = new Function('require', 'module', 'exports', source);
			fn.call(module, namespacedRequire, module, module.exports);
		}
		
		return module;
	};
	
	/**
	 * Load a module
	 *
	 * @param {String} moduleId  Name or path for a module
	 * @return {Object}
	 */
	require = function(moduleId) {
		if (!require.paths) {
			require.paths = initJsPaths();
		}
		
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
	};
	Object.defineProperty(require, 'main', { value: new Module(), enumerable: true });
	module = require.main;
	exports = module.exports;
}
