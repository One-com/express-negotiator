// Middleware that rewrites req.url from / to /index.<localeId>.html (as output by buildProduction) based
// on the value of a cookie (options.cookieName) and the presence of index.*.html in a directory (options.root).
// Requires the "cookieParser" middleware to run before, and is intended to run right before "static" pointed
// at the same directory as options.root.

var fs = require('fs'),
    Path = require('path'),
    passError = require('../passError'),
    memoizeAsync = require('../memoizeAsync');

// Helper for getting a prioritized list of relevant locale ids from a specific locale id.
// For instance, "en_US" produces ["en_US", "en"]
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
        throw new Error('rewriteToLocalizedIndexHtml: options.root is required');
    }
    if (!('cookieName' in options)) {
        throw new Error('rewriteToLocalizedIndexHtml: options.cookieName is required');
    }
    var existsByFileNameMemoized = memoizeAsync(function (cb) {
        fs.readdir(options.root, function (err, fileNames) {
            if (err) {
                return cb(new Error("rewriteToLocalizedIndexHtml: Couldn't readdir " + options.root));
            }
            var existsByFileName = {};
            fileNames.forEach(function (fileName) {
                existsByFileName[fileName] = true;
            });
            cb(null, existsByFileName);
        });
    });

    var fileNameByLocaleCookieValue = {};
    function getIndexFileNameByLocaleCookieValue(localeCookieValue, cb) {
        if (localeCookieValue in fileNameByLocaleCookieValue) {
            return cb(null, fileNameByLocaleCookieValue[localeCookieValue]);
        } else {
            existsByFileNameMemoized(passError(cb, function (existsByFileName) {
                var prioritizedLocaleIds = [];
                if (localeCookieValue) {
                    localeCookieValue.split(',').forEach(function (localeId) {
                        Array.prototype.push.apply(prioritizedLocaleIds, expandLocaleIdToPrioritizedList(localeId));
                    });
                }
                prioritizedLocaleIds.push('en_US', 'en');
                for (var i = 0 ; i < prioritizedLocaleIds.length ; i += 1) {
                    var fileName = 'index.' + prioritizedLocaleIds[i] + '.html';
                    if (existsByFileName[fileName]) {
                        return cb(null, fileName);
                    }
                }
                cb(new Error('rewriteToLocalizedIndexHtml: No suitable index.html found for ' + localeCookieValue));
            }));
        }
    }

    return function rewriteToLocalizedIndexHtml(req, res, next) {
        if (req.url === '/') {
            // TODO: Fall back to the locales specified by the Accept-Language header?
            getIndexFileNameByLocaleCookieValue(req.cookies && req.cookies[options.cookieName], passError(next, function (fileName) {
                // Only allow ETag revalidation with conditional GET for these requests, otherwise the static middleware
                // will reply with a 304 after a locale switch.
                delete req.headers['if-modified-since'];
                req.url = '/' + fileName;
                next();
            }));
        } else {
            next();
        }
    };
};
