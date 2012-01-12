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
    memoizeAsync = require('../memoizeAsync'),
    memoizer = require('memoizer');

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

    var memoizerByDir = {};
    function getExistsByFileName(dir, cb) {
        if (!(dir in memoizerByDir)) {
            memoizerByDir[dir] = memoizeAsync(function (cb_) {
                fs.readdir(dir, function (err, fileNames) {
                    if (err) {
                        if (err.code === 'ENOENT') {
                            // Pretend that non-existent directories are empty
                            return cb(null, {});
                        } else {
                            return cb(err);
                        }
                    }
                    var existsByFileName = {};
                    if (!err) {
                        fileNames.forEach(function (fileName) {
                            existsByFileName[fileName] = true;
                        });
                    }
                    cb_(null, existsByFileName);
                });
            });
        }
        memoizerByDir[dir](cb);
    }

    var fileNameByDirAndLocaleCookieValue = {};
    function getTargetUrl(dir, fileName, prioritizedLocaleIds, cb) {
        if (fileNameByDirAndLocaleCookieValue[dir] && fileNameByDirAndLocaleCookieValue[dir][localeCookieValue]) {
            return cb(null, fileNameByDirAndLocaleCookieValue[dir][localeCookieValue]);
        } else {
            getExistsByFileName(Path.resolve(options.root, dir.substr(1)), passError(cb, function (existsByFileName) {
                for (var i = 0 ; i < prioritizedLocaleIds.length ; i += 1) {
                    var localizedFileName = (fileName || 'index') + '.' + prioritizedLocaleIds[i] + '.html';
                    if (existsByFileName[localizedFileName]) {
                        return cb(null, dir + localizedFileName);
                    }
                }
                if (fileName === '' && existsByFileName['index.html']) {
                    cb(null, dir + "index.html"); // Useful in development mode
                } else {
                    // No suitable localized version found, don't rewrite the request:
                    cb();
                }
            }));
        }
    }

    var getPrioritizedLocaleIds = memoizer(function (localeCookieValue, acceptLanguageHeaderValue) {
        var prioritizedLocaleIds = [];
        if (localeCookieValue) {
            localeCookieValue.split(',').forEach(function (localeId) {
                Array.prototype.push.apply(prioritizedLocaleIds, expandLocaleIdToPrioritizedList(localeId));
            });
        }
        if (acceptLanguageHeaderValue) {
            acceptLanguageHeaderValue.replace(/;[^,]*/g, "").split(",").forEach(function (localeId) {
                localeId = localeId.replace(/-/g, '_');
                Array.prototype.push.apply(prioritizedLocaleIds, expandLocaleIdToPrioritizedList(localeId));
            });
        }
        prioritizedLocaleIds.push('en_US', 'en');
        return prioritizedLocaleIds;
    });

    var cookieNameLowerCased = options.cookieName && options.cookieName.toLowerCase();

    return function rewriteToLocalizedIndexHtml(req, res, next) {
        if (req.accepts('html')) {
            var matchDirAndFileName = req.url.match(/^(\/(?:[\w%+@*\-\.]+\/)*)(\w*)((?:\?.*)?$)/);
            if (matchDirAndFileName) {
                var dir = matchDirAndFileName[1],
                    fileName = matchDirAndFileName[2],
                    queryString = matchDirAndFileName[3],
                    cookieValue = cookieNameLowerCased && req.cookies && req.cookies[cookieNameLowerCased],
                    prioritizedLocaleIds = getPrioritizedLocaleIds(cookieValue, req.headers['accept-language']);

                return getTargetUrl(dir, fileName, prioritizedLocaleIds, passError(next, function (targetUrl) {
                    if (typeof targetUrl === 'string') {
                        req.url = targetUrl + queryString;

                        // Only allow ETag revalidation with conditional GET for these requests, otherwise the static middleware
                        // might reply with a 304 after a locale switch.
                        delete req.headers['if-modified-since'];
                    }
                    next();
                }));
            }
        }
        next();
    };
};
