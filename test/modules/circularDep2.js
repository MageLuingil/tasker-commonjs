exports.pre = 'pre2';
exports.circularDep1 = require('./circularDep1');
exports.dep1pre = exports.circularDep1.pre;
exports.post = 'post2';
