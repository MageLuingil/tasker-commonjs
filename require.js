/**
 * Require implementation for Tasker
 * @param  {String} library The relative path to the library file
 * @see https://www.reddit.com/r/tasker/comments/4ty9di/help_loading_javascript_file_from_javascript/
 */
function require(library) {
	var module = {};
	var script_path = global('SCRIPTPATH') || 'Tasker/javascript';
	script_path = script_path.replace(/\/?$/, '/');
	
	// Resolve file path
	if (library.indexOf('/') == -1) {
		var mod_path = 'node_modules/' + library + '/';
		var package  = JSON.parse(readFile(script_path + mod_path + 'package.json'));
		var filename = package.main || 'index.js';
		filename = filename.replace(/(\.js)?$/, '.js');
		library = script_path + mod_path + filename;
	}
	
	var filepath = library.replace(/^\.\//, script_path);
	var library = eval(readFile(filepath));
	
	return module.exports || library || undefined;
}
