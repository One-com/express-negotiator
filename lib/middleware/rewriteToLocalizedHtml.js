/*
 * Middleware that rewrites `req.url` to `/<fileName>.<localeId>.html`
 * (as output by `buildProduction`) based on the value of a cookie
 * (set by `options.cookieName`) and the directory contents.
 *
 * Requires the `cookieParser` middleware to run before, and is
 * intended to run right before `static` pointed at the same directory
 * as options.root.
 */

var fs = require('fs'),
    Path = require('path'),
    passError = require('../passError'),
    memoizeAsync = require('../memoizeAsync');

/*
 * Helper for getting a prioritized list of relevant locale ids from a
 * specific locale id. For instance, `en_US` produces `["en_US", "en"]`.
 */
function expandLocaleIdToPrioritizedList(localeId) {
    var localeIds = [localeId];
    while (/_[^_]+$/.test(localeId)) {
        localeId = localeId.replace(/_[^_]+$/, '');
        localeIds.push(localeId);
    }
    return localeIds;
}

module.exports = function (options) {
    options = options || {};
    if (!('root' in options)) {
        throw new Error('rewriteToLocalizedHtml: options.root is required');
    }
    if (!('cookieName' in options)) {
        throw new Error('rewriteToLocalizedHtml: options.cookieName is required');
    }

    var memoizerByDir = {};
    function getExistsByFileName(dir, cb) {
        if (!(dir in memoizerByDir)) {
            memoizerByDir[dir] = memoizeAsync(function (cb_) {
                fs.readdir(dir, function (err, fileNames) {
                    if (err) {
                        return cb_(new Error("rewriteToLocalizedHtml: Couldn't readdir " + dir));
                    }
                    var existsByFileName = {};
                    fileNames.forEach(function (fileName) {
                        existsByFileName[fileName] = true;
                    });
                    cb_(null, existsByFileName);
                });
            });
        }
        memoizerByDir[dir](cb);
    }

    var fileNameByDirAndLocaleCookieValue = {};
    function getTargetUrl(dir, fileName, localeCookieValue, cb) {
        if (fileNameByDirAndLocaleCookieValue[dir] && fileNameByDirAndLocaleCookieValue[dir][localeCookieValue]) {
            return cb(null, fileNameByDirAndLocaleCookieValue[dir][localeCookieValue]);
        } else {
            getExistsByFileName(Path.resolve(options.root, dir.substr(1)), passError(cb, function (existsByFileName) {
                var prioritizedLocaleIds = [];
                if (localeCookieValue) {
                    localeCookieValue.split(',').forEach(function (localeId) {
                        Array.prototype.push.apply(prioritizedLocaleIds, expandLocaleIdToPrioritizedList(localeId));
                    });
                }
                prioritizedLocaleIds.push('en_US', 'en');
                for (var i = 0 ; i < prioritizedLocaleIds.length ; i += 1) {
                    var localizedFileName = (fileName || 'index') + '.' + prioritizedLocaleIds[i] + '.html';
                    if (existsByFileName[localizedFileName]) {
                        return cb(null, dir + localizedFileName);
                    }
                }
                if (dir === '' && existsByFileName['index.html']) {
                    cb(null, dir + "/index.html"); // Useful in development mode
                } else {
                    cb(new Error('rewriteToLocalizedIndexHtml: No suitable localized file found for the dir "' + dir + '" and file name "' + fileName) + '"');
                }
            }));
        }
    }

    return function rewriteToLocalizedIndexHtml(req, res, next) {
        if (req.accepts('html')) {
            var matchDirAndFileName = req.url.match(/^(\/(?:[\w%+@*\-\.]+\/)*)(\w*)$/);
            if (matchDirAndFileName) {
                // TODO: Fall back to the locales specified by the Accept-Language header?
                getTargetUrl(matchDirAndFileName[1], matchDirAndFileName[2], req.cookies && req.cookies[options.cookieName], passError(next, function (targetUrl) {
                    req.url = targetUrl;

                    // Only allow ETag revalidation with conditional GET for these requests, otherwise the static middleware
                    // will reply with a 304 after a locale switch.
                    delete req.headers['if-modified-since'];
                    next();
                }));
            } else {
                next();
            }
        } else {
            next();
        }
    };
};
