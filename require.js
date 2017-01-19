/**
 * CommonJS and node.js module loader for Tasker
 *
 * Modules are loaded from the path(s) specified in the JS_PATH global variable.
 * JS_PATH does not support Tasker's relative file paths.
 *
 * Due to limitations in Tasker, this loader does not support relative paths in
 * the main script. Relative paths required from the main script will be loaded
 * using JS_PATH. Relative paths required from modules should load normally.
 *
 * @author Daniel Matthies <mageluingil@gmail.com>
 * @see http://wiki.commonjs.org/wiki/Modules/1.1
 */
var require = (function() {
	var module_cache = {};
	
	/*****************
	 * Module object *
	 *****************/
	
	var Module = function(id) {
		Object.defineProperty(this, 'id', { value: id });
		this.exports = {};
	};
	
	/*********************
	 * File path helpers *
	 *********************/
	
	/**
	 * Return the last segment of a path
	 */
	var basename = function(filepath) {
		var segments = filepath.split('/');
		do {
			var name = segments.pop();
		} while (!name && segments.length);
		return name;
	};
	
	/**
	 * Return the parent directory of a path
	 */
	var dirname = function(filepath) {
		if (!filepath) return '.';
		
		// Remove all trailing segments until a non-empty segment is removed
		var segments = filepath.split('/');
		while (segments.length && !segments.pop());
		
		// If no segments remain, return / for absolute paths and . for relative
		var dirname = segments.join('/');
		return dirname || ((filepath[0] == '/') ? '/' : '.');
	};
	
	/**
	 * Return the file extension for a path
	 */
	var extname = function(filepath) {
		var matches = basename(filepath).match(/^.+(\.[^.]+)$/);
		return matches ? matches[1] : '';
	};
	
	/**
	 * Join path segments together
	 */
	var joinPath = function(...paths) {
		return paths.reduce(function(path, seg) {
			// Ensure trailing slash on path, remove leading slash on segment
			return path.replace(/\/?$/, '/') + seg.replace(/^\//, '');
		});
	};
	
	/**
	 * Resolve . and .. segments and remove repeated path separators
	 */
	var normalizePath = function(filepath) {
		var segments = filepath.split('/');
		// Parse right-to-left to allow splicing
		for (let i=segments.length-1, up=0; i; i--) {
			let segment = segments[i];
			if (segment == '.' || (segment == '' && i)) {
				segments.splice(i, 1);
			} else if (segment == '..') {
				segments.splice(i, 1);
				up++;
			} else if (up && i && segment.length) {
				segments.splice(i, 1);
				up--;
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
	 * Given a module ID, resolve it to the fully qualified path to the file
	 * that is the entry point to that module.
	 *
	 * @todo Cache results
	 *
	 * @param {String} module_id  Name or path for a module
	 * @param {String} directory  Directory from which the module is being requested
	 * @return {String}
	 */
	var resolveFile = function(module_id, directory) {
		// For most module identifiers, search within predefined paths
		var paths = require.paths;
		if (module_id[0] == '/') {
			// Absolute identifier, don't search within any paths
			paths = [ '' ];
		} else if (/^\.{1,2}\//.test(module_id) && directory != '.') {
			// Relative identifier, search within current directory
			paths = [ directory ];
		}
		
		for (let path of paths) {
			var filepath = normalizePath(joinPath(path, module_id));
			var filetype = stat(filepath);
			
			if (filetype == 'regular file') {
				return filepath;
			} else if (filetype == 'directory') {
				// Try loading as a node.js module
				try {
					var pkg = JSON.parse(readFile(joinPath(filepath, 'package.json')));
				} catch (e) {}
				if (pkg && pkg.main) {
					var mainpath = joinPath(filepath, pkg.main);
					for (let ext of ['', '.js', '.json']) {
						if (stat(mainpath + ext)) return mainpath + ext;
					}
				}
				// If loading main from package.json failed, try index.js
				var indexpath = joinPath(filepath, 'index.js');
				if (stat(indexpath)) {
					return indexpath;
				}
			} else if (filepath.slice(-1) != '/') {
				// Maybe it's just missing an extension
				for (let ext of ['.js', '.json']) {
					if (stat(filepath + ext)) return filepath + ext;
				}
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
	var stat = function(filepath) {
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
	var initPaths = function() {
		const JS_PATH = global('JS_PATH');
		
		// Use a set to remove possible duplicates
		var paths = new Set();
		for (let path of JS_PATH.split(':')) {
			// Remove invalid paths now to save time later
			if (!stat(path)) continue;
			paths.add(path);
			
			// Also search in any node_modules subdirectories
			let subpath = joinPath(path, 'node_modules');
			if (basename(path) != 'node_modules' && stat(subpath)) {
				paths.add(subpath);
			}
		}
		return Array.from(paths);
	};
	
	/**
	 * Load a module
	 *
	 * @param {String} module_id  Name or path for a module
	 * @return {Object}
	 */
	var require = function(module_id) {
		if (!require.paths) {
			require.paths = initPaths();
		}
		
		// If require was called from a module, save a reference to it
		var parent = module || require.main;
		
		// Canonicalize module name
		var filepath = resolveFile(module_id, dirname(parent.id));
		if (!filepath) {
			throw new Error('Module not found');
		}
		
		// Check for cached, or load new
		var module = module_cache[filepath];
		if (!module) {
			module = new Module(filepath);
			module_cache[filepath] = module;
			
			var source = readFile(filepath);
			if (!source) {
				throw new Error('Unable to load ' + module_id);
			}
			
			// Load by file extension (supports json and js)
			if (extname(filepath) == '.json') {
				module.exports = JSON.parse(source);
			} else {
				// Run in global scope
				var fn = new Function('require', 'module', 'exports', source);
				fn(require, module, module.exports);
			}
		}
		
		return module.exports;
	};
	require.main = new Module();
	
	return require;
})();
