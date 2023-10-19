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
 * @version 2018/01/19
 */
var require, module, exports;
{
	let module_cache = {};
	let resolve_cache = {};
	
	/*****************
	 * Module object *
	 *****************/
	
	let Module = function(id) {
		Object.defineProperty(this, 'id', { value: id });
		this.exports = {};
	};
	
	/****************
	 * Misc helpers *
	 ****************/
	
	/**
	 * Initialize JS search paths. Uses array to conform with CommonJS spec.
	 */
	let initPaths = function() {
		const PATH = global('JS_PATH') || dirname(global('CommonJS'));
		
		// Use a set to remove possible duplicates
		let paths = new Set();
		for (let path of PATH.split(':').map(normalizePath)) {
			// Remove invalid paths now to save time later
			if (!stat(path)) continue;
			paths.add(path);
		}
		return Array.from(paths);
	};
	
	let cloneEnumerableProperties = function(target, source) {
		return Object.keys(source).reduce(
			(_, name) => Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(source, name)),
			undefined
		);
	};
	
	let safeParseJSON = function(str) {
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
	let basename = function(filepath) {
		let name, segments = filepath.split('/');
		do {
			name = segments.pop();
		} while (!name && segments.length);
		return name;
	};
	
	/**
	 * Return the parent directory of a path
	 */
	let dirname = function(filepath) {
		if (!filepath) return '.';
		// Remove all trailing segments until a non-empty segment is removed
		let segments = filepath.split('/');
		while (segments.length && !segments.pop());
		// If no segments remain, return / for absolute paths and . for relative
		return segments.join('/') || ((filepath[0] == '/') ? '/' : '.');
	};
	
	/**
	 * Return the file extension for a path
	 */
	let extname = function(filepath) {
		let matches = basename(filepath).match(/^.+(\.[^.]+)$/);
		return matches ? matches[1] : '';
	};
	
	/**
	 * Join path segments together
	 */
	let joinPath = function(...paths) {
		// Filter out any empty arguments
		paths = paths.filter((s) => s.length);
		return paths.length ? paths.reduce(
			// Ensure trailing slash on path, remove leading slash on segment
			(path, seg) => path.replace(/\/?$/, '/') + seg.replace(/^\//, '')
		) : '';
	};
	
	/**
	 * Resolve . and .. segments and remove repeated path separators
	 */
	let normalizePath = function(filepath) {
		let segments = [];
		for (let cur of filepath.split('/')) {
			let last = segments[segments.length - 1];
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
	let stat = function(filepath) {
		// Quote path for safe shell usage
		filepath = "'" + filepath.replace(/'/g, "'\\''") + "'";
		// `stat` isn't always available in android, so use a POSIX safe test
		return shell(`
			if [ -d ${filepath} ]; then
				echo "directory"
			elif [ -f ${filepath} ]; then
				echo "regular file"
			fi
		`);
	};
	
	/**
	 * Determine which directories to search based on the module ID and current directory
	 */
	let resolveSearchPaths = function(module_id, directory) {
		if (module_id[0] == '/') {
			// Absolute identifier; don't search within any paths
			return [''];
		} else if (/^\.{1,2}\//.test(module_id) && directory && directory != '.') {
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
	 * @param {String} module_id  Name or path for a module
	 * @param {String} directory  Directory from which the module was requested
	 * @return {String|undefined}
	 */
	let resolveFile = function(module_id, directory) {
		// Cache results to prevent unnecessary filesystem calls
		let cache = resolve_cache, key = JSON.stringify([...arguments]);
		if (cache[key]) return cache[key];
		
		// For most module identifiers, search within predefined paths
		let paths = resolveSearchPaths(module_id, directory);
		for (let path of paths) {
			let filepath = normalizePath(joinPath(path, module_id));
			let filetype = stat(filepath);
			
			if (filetype == 'regular file') {
				return cache[key] = filepath;
			} else if (filetype == 'directory') {
				let file = resolvePackage(filepath);
				if (file) return cache[key] = file;
			}
			
			// If it's not a path, check if it's a module in node_modules/
			if (module_id.indexOf('/') == -1 && basename(path) != 'node_modules') {
				let modulepath = normalizePath(joinPath(path, 'node_modules', module_id));
				let file = stat(modulepath) && resolvePackage(modulepath);
				if (file) return cache[key] = file;
			}
			
			// Maybe it's just missing an extension
			if (filepath.slice(-1) != '/') {
				let file = resolveExtension(filepath);
				if (file) return cache[key] = file;
			}
		}
	};
	
	/**
	 * Resolve a given directory path to the main file for a CommonJS package
	 *
	 * @param  {String} filepath  The directory to resolve
	 * @return {String|undefined}
	 */
	let resolvePackage = function(filepath) {
		// For node.js, the default main is index.js[on]
		let main = joinPath(filepath, 'index');
		
		// If package.main is set, override the default
		let pkgfile = joinPath(filepath, 'package.json');
		let pkg = stat(pkgfile) && safeParseJSON(readFile(pkgfile));
		if (pkg && pkg.main) {
			main = normalizePath(joinPath(filepath, pkg.main));
			// Support package.main set to a directory (for node.js modules)
			if (stat(main) == 'directory') {
				main = joinPath(main, 'index');
			}
		}
		
		return resolveExtension(main, true);
	};
	
	/**
	 * Resolve a filepath without a file extension to an existing file
	 *
	 * @param {String} filepath The path to the file
	 * @param {Boolean} check_wo_ext Whether to check for the file without
	 *  appending an extension
	 * @return {String|undefined}
	 */
	let resolveExtension = function(filepath, check_wo_ext) {
		if (check_wo_ext && stat(filepath) == 'regular file') return filepath;
		for (let ext of ['.js', '.json']) {
			if (stat(filepath + ext) == 'regular file') return filepath + ext;
		}
	};
	
	/******************
	 * Main functions *
	 ******************/
	
	/**
	 * Parse a file as a module
	 */
	let loadFile = function(filepath) {
		// Return cached module if available
		if (module_cache[filepath]) return module_cache[filepath];
		
		// Return undefined if file is inaccessible or empty
		let source = readFile(filepath);
		if (!source) return;
		
		// Prevent cyclic dependencies by caching before parsing
		let module = new Module(filepath);
		module_cache[filepath] = module;
		
		// Load by file extension (supports json and js)
		if (extname(filepath) == '.json') {
			module.exports = JSON.parse(source);
		} else {
			// Run in module scope
			let module_require = cloneEnumerableProperties(require.bind(module), require);
			let fn = new Function('require', 'module', 'exports', source);
			fn.call(module, module_require, module, module.exports);
		}
		
		return module;
	}
	
	/**
	 * Load a module
	 *
	 * @param {String} module_id  Name or path for a module
	 * @return {Object}
	 */
	require = function(module_id) {
		if (!require.paths) {
			require.paths = initPaths();
		}
		
		// If require was called from a module, save a reference to it
		let parent = (this instanceof Module) ? this : require.main;
		
		// Canonicalize module name
		let filepath = resolveFile(module_id, dirname(parent.id));
		if (!filepath) {
			throw new Error('Module "' + module_id + '" not found');
		}
		
		// Check for cached, or load new
		let module = loadFile(filepath);
		if (!module) {
			throw new Error('Failed to load module "' + module_id + '"');
		}
		
		return module.exports;
	};
	Object.defineProperty(require, 'main', { value: new Module(), enumerable: true });
	module = require.main;
	exports = module.exports;
}
