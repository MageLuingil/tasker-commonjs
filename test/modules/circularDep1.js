exports.pre = 'pre1';
exports.circularDep2 = require('./circularDep2');
exports.dep2pre = exports.circularDep2.pre;
exports.post = 'post1';
