/**
 * CommonJS and node.js module loader for Tasker
 *
 * Due to limitations in Tasker, this loader does not support paths relative to
 * the running script. All modules are loaded relative to the path(s) specified
 * in the %JS_PATH global variable in Tasker.
 *
 * @author Daniel Matthies <mageluingil@gmail.com>
 * @see http://wiki.commonjs.org/wiki/Modules/1.1
 */
var require = (function() {
	var module_cache = {};
	var relative = /^\.\//;
	
	/**
	 * Module object passed into loaded code scope
	 */
	var Module = function(id) {
		Object.defineProperty(this, 'id', { value: id });
		this.exports = {};
	};
	
	/**
	 * Initialize search paths
	 *
	 * Modules are loaded from directories in %JS_PATH, or relative to
	 * {SD path}/Tasker/code/javascript by default
	 */
	var initPaths = function() {
		var paths = global('JS_PATH') || 'Tasker/code/javascript';
		if (paths) {
			paths = paths.split(':');
			
			// For each path, also search in a node_modules subdirectory
			for (var i=paths.length-1; i>=0; i--) {
				if (paths[i].slice(-12) != 'node_modules') {
					paths.splice(i+1, 0, joinPath(paths[i], 'node_modules'));
				}
			}
		}
		
		return paths;
	};
	
	/**
	 * Join path segments together
	 *
	 * @param {String} ...paths  A sequence of path segments
	 * @return {String}
	 */
	var joinPath = function() {
		return Array.prototype.reduce.call(
			arguments,
			function(path, segment) {
				// Ensure trailing slash on path, remove leading slash on segment
				path = path ? path.replace(/\/?$/, '/') : '';
				return path + segment.replace(/^\//, '');
			}
		);
	};
	
	/**
	 * Given a module ID, resolve it to the fully qualified path to the file
	 * that is the entry point to that module.
	 *
	 * @param {String} module_id  Name or path for a module
	 * @return {String}
	 */
	var resolveFile = function(module_id) {
		for (var path of require.paths) {
			// Make sure path exists
			if (!stat(path)) continue;
			
			// There is no way to get the current directory from Tasker, so all
			// files are loaded relative to the PATH
			if (relative.test(module_id)) {
				module_id = module_id.replace(relative, '');
			}
			var filepath = joinPath(path, module_id);
			
			var type = stat(filepath);
			if (type == 'regular file') {
				return filepath;
			} else if (type == 'directory') {
				// Try loading as a node.js module
				try {
					var pkg = JSON.parse(readFile(joinPath(filepath, 'package.json')));
				} catch (e) {}
				if (pkg && pkg.main) {
					var mainpath = joinPath(filepath, pkg.main);
					for (var ext of ['', '.js', '.json']) {
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
				for (var ext of ['.js', '.json']) {
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
		return shell('stat -c %F ' + filepath);
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
		
		// Canonicalize module name
		var filepath = resolveFile(module_id);
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
			if (filepath.slice(-5) == '.json') {
				module.exports = JSON.parse(source);
			} else {
				// Run in global scope
				var fn = new Function('require', 'module', 'exports', source);
				fn(require, module, module.exports);
			}
		}
		
		return module.exports;
	};
	
	return require;
})();
