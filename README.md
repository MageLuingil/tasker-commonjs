Tasker Module Loader
====================

A CommonJS module loader for [Tasker](http://tasker.dinglisch.net/).

* Require JS/JSON files from within your code
* Supports individual files or module directories
* Can include *some* node.js modules (see notes below)
* Conforms to most of the [CommonJS Modules](http://wiki.commonjs.org/wiki/Modules/1.1) spec (see notes below)
* Write your Tasker actions in modular [javascript](http://tasker.dinglisch.net/userguide/en/javascript.html)

```js
const sprintf = require('sprintf-js').sprintf;

let now = new Date();
flash(sprintf('%i:%02i', now.getHours(), now.getMinutes()));
```

Usage
-----

To use in your JavaScript actions, you need to:

1. Save [tasker-commonjs](https://github.com/MageLuingil/tasker-commonjs/archive/master.zip) to your device
2. Create a global variable `%CommonJS` with the full path to the require.js file
3. Create a global variable `%JS_PATH` with the full path to the directory of files/modules you want to include
4. In your JavaScript action, add `%CommonJS` to your Libraries

That's it! Now you can call `require()` from your javascript!

### Defining JS_PATH ###

`JS_PATH` should be a colon-delimited list of absolute directory paths. Relative paths *are not supported* in `JS_PATH`. `require()` will search for modules within each directory in the order they are defined in `JS_PATH` (left-to-right).

If `JS_PATH` is not defined, `require()` uses the directory from the `CommonJS` global variable. If neither is defined, `require()` will throw an error.

If you are loading node.js modules, you do not need to include the "node_modules/" path segment in your `JS_PATH` -- `require()` will search for node.js modules automatically. For details (and caveats) see the notes section below.

### Example ###

Let's build an example project using the excellent [sprintf.js](https://github.com/alexei/sprintf.js) library, and a collection of shared common functions. Set up a directory on your SD card that looks something like this:

```
/sdcard/tasker/javascript
 ├─ sprintf-js/
 │  └─ (module files)
 ├─ tasker-commonjs/
 │  └─ require.js
 ├─ action.js
 └─ functions.js
```

Put the following code in your functions.js and action.js files:

```js
/* functions.js */
const sprintf = require('sprintf-js').sprintf;
// You can require() additional modules here

/**
 * Format the current time in h:mm:ss format
 */
function formatTime() {
    let now = new Date();
    return sprintf(
        "%i:%02i:%02i",
        now.getHours(),
        now.getMinutes(),
        now.getSeconds()
    );
}
exports.formatTime = formatTime;

// You can define additional functions and add them to the exports object here
```

```js
/* action.js */
const helpers = require('functions.js'); // You can include individual files as well as module directories

flash('Task started at ' + helpers.formatTime()); // flash() comes from the Tasker JS API
// do some long task here...
flash('Task finished at ' + helpers.formatTime());
```

Now, let's set up a task to run our new script. In Tasker, do the following (changing the paths to point to your files):
* Set your `%CommonJS` global variable to "/sdcard/tasker/javascript/tasker-commonjs/require.js"
* Set your `%JS_PATH` global variable to "/sdcard/tasker/javascript/"
* Create a task with a JavaScript action using the following values:  
  `Path`: /sdcard/tasker/javascript/action.js  
  `Libraries`: %CommonJS  

Run the task. If you see the time flash twice, it worked! You're ready to create your own modules and actions.

If it didn't work, double-check that your globals have the absolute paths to your require.js file and module directory - relative paths do not work.

### Further Resources ###

You can find all the Tasker JS functions available in the [Tasker JavaScript documentation](http://tasker.dinglisch.net/userguide/en/javascript.html).

If you aren't familiar with CommonJS modules, try reading the [node.js docs](https://nodejs.org/api/modules.html) on their implementation.

Notes
-----

### Relative paths ###

Due to limitations in Tasker, including relative paths *is not supported* from the main script. You can include relative paths from within submodules, however.

You can get around this limitation by putting your main scripts in the same directory as your modules (as in the example above); that way, your 'relative' directories are available from the JS_PATH and can be included the same as if they were relative paths.

I have not found any way to determine the directory of the current script from within the WebView Tasker uses. (If anyone is aware of a reasonable workaround for this, please feel free to contact me or submit a pull request.)

### Including node.js modules ###

Including node.js modules is supported. `require()` will automatically search for modules inside a node_modules/ subdirectory for each path (including the current directory, if called from within a submodule) if the module ID passed is not a path.

However, modules that use core node.js modules (such as `fs` or `path`) **will not work**. Tasker uses a WebView to run javascript, and while it has good ES6 support, it does not have any support for node.js. You're limited to modules written in pure javascript (such as those designed for both node.js and browser environments).
