/*
 * Middleware that rewrites `req.url` to `/<fileName>.<localeId>.html`
 * (as output by `buildProduction`) based on the value of a cookie
 * (optional, set by `options.cookieName`), the `Accept-Language`
 * request header, and the directory contents.
 *
 * rewriteToLocalizedHtml is intended to run right before `static`
 * pointed at the same directory as `options.root`.
 *
 * If `options.cookieName` is specified, the `cookieParser` middleware
 * must also be in the middleware chain.
 */

var fs = require('fs'),
    Path = require('path'),
    passError = require('passerror'),
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
    function getTargetUrl(dir, fileName, prioritizedLocaleIds, localeCookieValue, cb) {
        if (fileNameByDirAndLocaleCookieValue[dir] && fileNameByDirAndLocaleCookieValue[dir][localeCookieValue]) {
            return cb(null, fileNameByDirAndLocaleCookieValue[dir][localeCookieValue]);
        } else {
            getExistsByFileName(Path.resolve(options.root, dir.substr(1)), passError(cb, function (existsByFileName) {
                for (var i = 0 ; i < prioritizedLocaleIds.length ; i += 1) {
                    var localeId = prioritizedLocaleIds[i],
                        localizedFileName = (fileName || 'index') + '.' + localeId + '.html';
                    if (existsByFileName[localizedFileName]) {
                        return cb(null, dir + localizedFileName, localeId);
                    }
                }
                if (fileName === '' && existsByFileName['index.html']) {
                    cb(null, dir + "index.html"); // Useful in development mode
                } else if (existsByFileName[fileName + '.html']) {
                    cb(null, dir + fileName + ".html"); // Also useful in development mode
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
        // Express has a bug that doesn't consider wildcards in the 'Accept' header correctly:
        if (req.accepts('html') || /(?:^|,| )(?:text|\*)\/(?:\*|html)(?:,| |$)/.test(req.headers.accept)) {
            var matchDirAndFileName = req.url.match(/^(\/(?:[\w%+@*\-\.]+\/)*)([\w%@\-+]*)(?:\.html)?((?:\?.*)?$)/);
            if (matchDirAndFileName) {
                var dir = matchDirAndFileName[1],
                    fileName = decodeURIComponent(matchDirAndFileName[2]),
                    queryString = matchDirAndFileName[3],
                    localeCookieValue = cookieNameLowerCased && req.cookies && req.cookies[cookieNameLowerCased],
                    prioritizedLocaleIds = getPrioritizedLocaleIds(localeCookieValue, req.headers['accept-language']);

                return getTargetUrl(dir, fileName, prioritizedLocaleIds, localeCookieValue, passError(next, function (targetUrl, localeId) {
                    if (typeof targetUrl === 'string') {
                        targetUrl += queryString;
                        req.url = targetUrl;
                        res.setHeader('Content-Location', targetUrl);
                        res.setHeader('Vary', 'Cookie, Accept-Language');

                        if (!localeId) {
                            return next();
                        }
                        return fs.stat(Path.resolve(options.root, targetUrl.substr(1).replace(/\?.*$/, '')), passError(next, function (stat) {
                            res.setHeader('ETag', '"' + localeId + '-' + stat.size + '-' + Number(stat.mtime) + '"');
                            // Disable conditional GET via If-Modified-Since for these requests, otherwise the static middleware
                            // might reply with a 304 after a locale switch.
                            delete req.headers['if-modified-since'];
                            next();
                        }));
                    }
                    next();
                }));
            }
        }
        next();
    };
};
