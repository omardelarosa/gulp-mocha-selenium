'use strict';
var domain = require('domain');
var path = require('path');
var gutil = require('gulp-util');
var through = require('through2');
var Mocha = require('mocha');
var seleniumLauncher = require('selenium-launcher');
var wd = require('wd');

module.exports = function (options) {

  var remote = 'remote';
  if (options.usePromises) {
    remote = 'promiseRemote';
  } else if (options.useChaining) {
    remote = 'promiseChainRemote';
  }

  var mocha = new Mocha(options);
  var cache = {};
  var configPath = options.configPath;
  var isRetry = options.isRetry || false;

  for (var key in require.cache) {
    cache[key] = true;
  }

  function sessionHid () {
    return Math.random().toString('16').slice(2);
  }

  function clearCache() {
    for (var key in require.cache) {
      if (!cache[key]) {
        delete require.cache[key];
      }
    }
  }

  function prepareTests(cb) {
    var stream = this;
    if (options.host && options.port) {
      var selenium = {
        host: options.host,
        port: options.port,
        username: options.username,
        accesskey: options.accesskey
      };
      runTests(selenium, stream, cb);
    } else {

      if (options.browserName === 'phantomjs' && !options.useSystemPhantom) {
        // add npm-supplied phantomjs bin dir to PATH, so selenium can launch it
        process.env.PATH = path.dirname(require('phantomjs').path) + ':' + process.env.PATH;
      }
      seleniumLauncher({ chrome: options.browserName === 'chrome' }, function(err, selenium) {
        if (err) {
          selenium.exit();
          stream.emit('error', new gutil.PluginError('gulp-mocha-selenium', err));
          cb();
          return;
        }
        runTests(selenium, stream, cb);
      });
    }
  }

  function runTests(selenium, stream, cb) {
    var remote = 'remote';
    if (options.usePromises) {
      remote = 'promiseRemote';
    } else if (options.useChaining) {
      remote = 'promiseChainRemote';
    }

    var browser = wd[remote](
      selenium.host,
      selenium.port,
      selenium.username,
      selenium.accessKey
    );

    mocha.suite.on('pre-require', function (context, file, m) {
      context.wd = wd;
      context.browser = browser;
      context.config = require(configPath);
      context.c = context.config.data;
      context.h = context.config.helpers;
      context.CSS = context.config.selectors;
      context.id = sessionHid();
      context.isGulp = true;
      context.isRetry = isRetry;
    });

    browser.on('status', function(info){
      gutil.log('\x1b[36m', info, '\x1b[0m');
    });

    browser.on('command', function(meth, path, data){
      if (options.verbose) {
        gutil.log(' > \x1b[33m', meth, '\x1b[0m: ', path, data || '');
      }
    });

    browser.init(options, function(err) {
      var d = domain.create();

      function handleException(err) {
        clearCache();
        console.log(err.stack)
        browser.quit(function() {
          if (selenium.kill) {
            selenium.kill();
          }
          stream.emit('error', new gutil.PluginError('gulp-mocha', err));
          cb();
        });
      }

      d.on('error', handleException);
      d.run(function () {
        try {
          mocha.run(function (errCount) {
            clearCache();
            if (errCount > 0) {
              stream.emit('error', new gutil.PluginError('gulp-mocha', errCount + ' ' + (errCount === 1 ? 'test' : 'tests') + ' failed.', {
                showStack: true
              }));
            }

            browser.quit(function() {
              if (selenium.kill) {
                selenium.kill();
              }
              cb();
            });
          });
        } catch (err) {
          handleException(err);
        }
      });

    });
  }

  return through.obj(function (file, enc, cb) {
    mocha.addFile(file.path);
    this.push(file);
    cb();
  }, prepareTests);
};
