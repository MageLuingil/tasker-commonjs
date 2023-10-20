const moduleInSubDirectory = require('./subdir1/moduleInSubDirectory');
const moduleThatHasLogic = require('moduleThatHasLogic');

exports = {
	moduleInSameDirectory: !!moduleThatHasLogic.result,
	moduleInSubDirectory: !!moduleInSubDirectory.moduleInSubDirectory
};
