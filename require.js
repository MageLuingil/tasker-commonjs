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
	
	/**
	 * Given a module ID, resolve it to the fully qualified path to the file
	 * that is the entry point to that module.
	 *
	 * @param {String} module_id  Name or path for a module
	 * @param {String} directory  Directory from which the module was requested
	 * @return {String|false}
	 */
	let resolveFile = function(module_id, directory) {
		// Cache results to prevent unnecessary filesystem calls
		let cache = resolve_cache, key = JSON.stringify({id: module_id, dir: directory});
		if (cache[key]) return cache[key];
		
		// For most module identifiers, search within predefined paths
		let paths = require.paths;
		if (module_id[0] == '/') {
			// Absolute identifier; don't search within any paths
			paths = [ '' ];
		} else if (/^\.{1,2}\//.test(module_id) && directory && directory != '.') {
			// Relative identifier; only search within current directory
			paths = [ directory ];
		} else if (directory && directory != '.') {
			// Top-level identifier; also search within current directory
			paths.push(directory);
		}
		
		for (let path of paths) {
			let filepath = normalizePath(joinPath(path, module_id));
			let filetype = stat(filepath);
			
			if (filetype == 'regular file') {
				return cache[key] = filepath;
			} else if (filetype == 'directory') {
				// Try loading as a CommonJS/node.js package
				try {
					let pkg = JSON.parse(readFile(joinPath(filepath, 'package.json')));
					let main = pkg.main && resolveExtension(joinPath(filepath, pkg.main), true);
					if (main) return cache[key] = main;
				} catch (e) {}
				// If loading main from package.json failed, try index.js
				let indexpath = joinPath(filepath, 'index.js');
				if (stat(indexpath)) return cache[key] = indexpath;
			}
			
			// If it's not a path, check if it's a module in node_modules/
			if (module_id.indexOf('/') == -1 && basename(path) != 'node_modules') {
				let file = resolveFile(joinPath(path, 'node_modules', module_id, '/'));
				if (file) return cache[key] = file;
			}
			
			// Maybe it's just missing an extension
			if (filepath.slice(-1) != '/') {
				let file = resolveExtension(filepath);
				if (file) return cache[key] = file;
			}
		}
		
		return false;
	};
	
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
	
	/******************
	 * Main functions *
	 ******************/
	
	/**
	 * Initialize search paths
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
			throw new Error('Module not found');
		}
		
		// Check for cached, or load new
		let module = module_cache[filepath];
		if (!module) {
			module = new Module(filepath);
			module_cache[filepath] = module;
			
			let source = readFile(filepath);
			if (!source) {
				throw new Error('Unable to load ' + module_id);
			}
			
			// Load by file extension (supports json and js)
			if (extname(filepath) == '.json') {
				module.exports = JSON.parse(source);
			} else {
				// Run in module scope
				let fn = new Function('require', 'module', 'exports', source);
				fn.call(module, require, module, module.exports);
			}
		}
		
		return module.exports;
	};
	Object.defineProperty(require, 'main', { value: new Module() });
	module = require.main;
	exports = module.exports;
}
