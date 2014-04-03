var fs = require('fs'),
    Path = require('path'),
    _ = require('underscore'),
    async = require('async'),
    passError = require('passerror'),
    memoizeAsync = require('memoizeasync'),
    memoizeSync = require('memoizesync'),
    mime = require('mime'),
    mario = require('mario'),
    // List taken from an older version of CLDR, so it's probably incomplete:
    isLocaleIdRegExp = /^(?:aa|af|ak|am|ar|as|asa|az|be|bem|bez|bg|bm|bn|bo|br|brx|bs|byn|ca|cch|cgg|chr|cs|cy|da|dav|de|dv|dz|ebu|ee|el|en|eo|es|et|eu|fa|ff|fi|fil|fo|fr|fur|ga|gaa|gez|gl|gsw|gu|guz|gv|ha|haw|he|hi|hr|hu|hy|ia|id|ig|ii|in|is|it|iu|iw|ja|jmc|ka|kab|kaj|kam|kcg|kde|kea|kfo|khq|ki|kk|kl|kln|km|kn|ko|kok|kpe|ksb|ksh|ku|kw|ky|lag|lg|ln|lo|lt|luo|luy|lv|mas|mer|mfe|mg|mi|mk|ml|mn|mo|mr|ms|mt|my|naq|nb|nd|nds|ne|nl|nn|no|nr|nso|ny|nyn|oc|om|or|pa|pl|ps|pt|rm|ro|rof|root|ru|rw|rwk|sa|saq|se|seh|ses|sg|sh|shi|si|sid|sk|sl|sn|so|sq|sr|ss|ssy|st|sv|sw|syr|ta|te|teo|tg|th|ti|tig|tl|tn|to|tr|trv|ts|tt|tzm|ug|uk|ur|uz|ve|vi|vun|wal|wo|xh|xog|yo|zh|zu)(?:_|$)/,
    aliasesByLocaleId = {
        no: ['nb'],
        nb: ['no']
    };

function localeIdsEqual(localeId1, localeId2) {
    return (
        localeId1 === localeId2 ||
        (aliasesByLocaleId[localeId1] && aliasesByLocaleId[localeId1].indexOf(localeId2) !== -1) ||
        (aliasesByLocaleId[localeId2] && aliasesByLocaleId[localeId2].indexOf(localeId1) !== -1)
    );
}

// Note: These obscure extensions are listed in require('mime').types AND are considered valid locale ids: nb, so, ps, kfo, rm, st, sh, sid, in, tr, ms, gv, ts
// When resolving the variants we interpret them as locale ids.

// From Express 3.0:
function parseQualityToken(str) {
    var parts = str.split(/ *; */),
        val = parts[0],
        q = parts[1] ? parseFloat(parts[1].split(/ *= */)[1]) : 1;

    return {value: val, quality: q};
}

function parseQuality(str) {
    return str
        .split(/ *, */)
        .map(parseQualityToken)
        .filter(function (obj) {
            return obj.quality;
        })
        .sort(function (a, b) {
            return b.quality - a.quality;
        });
}

/*
 * Replace - with _ and convert to lower case: en-GB => en_gb
 */
function normalizeLocaleId(localeId) {
    return localeId.replace(/-/g, '_').toLowerCase();
}

/*
 * Helper for getting a prioritized list of relevant locale ids from a
 * specific locale id. For instance, `en_US` produces `["en_US", "en"]`.
 */
function expandLocaleIdToPrioritizedList(localeId) {
    localeId = normalizeLocaleId(localeId);
    var localeIds = [localeId];
    while (/_[^_]+$/.test(localeId)) {
        localeId = localeId.replace(/_[^_]+$/, '');
        localeIds.push(localeId);
    }
    return localeIds;
}

var userAgentTypes = ['touch', 'ie', 'chrome', 'phantom', 'safari', 'ios', 'iphone', 'ipad', 'touchpad', 'android', 'opera', 'firefox', 'seamonkey'],
    isValidByUserAgentType = {};

// Add nonmobile, nonie...:
Array.prototype.push.apply(userAgentTypes, userAgentTypes.map(function (userAgentType) {return 'non' + userAgentType;}));

userAgentTypes.forEach(function (userAgentType) {
    isValidByUserAgentType[userAgentType] = true;
});

// .html.en-US => {contentType: 'text/html', contentTypeFragments: ['text', 'html'], localeId: 'en_us'}
// .html.mobile.en-US => {contentType: 'text/html', contentTypeFragments: ['text', 'html'], userAgent: {mobile: true}, localeId: 'en_us'}
function getVariantInfoFromExtensionString(extensionString, supportUserAgent) {
    var variantInfo = {
        allExtensionsMatched: true
    };
    if (supportUserAgent) {
        variantInfo.userAgent = {};
    }
    if (extensionString) {
        extensionString.split(/(?=\.)/).forEach(function (extension) {
            var extensionWithoutLeadingDot = extension.substr(1),
                localeId = normalizeLocaleId(extensionWithoutLeadingDot);
            if (isLocaleIdRegExp.test(localeId)) {
                variantInfo.localeId = localeId;
            } else {
                var contentType = mime.types[extensionWithoutLeadingDot];
                if (contentType) {
                    variantInfo.contentType = contentType;
                    variantInfo.contentTypeFragments = contentType.split('/');
                } else if (supportUserAgent && isValidByUserAgentType[extensionWithoutLeadingDot]) {
                    variantInfo.userAgent[extensionWithoutLeadingDot] = true;
                } else {
                    variantInfo.allExtensionsMatched = false;
                }
            }
        });
    }
    return variantInfo;
}

module.exports = function (options) {
    options = options || {};
    if (!('root' in options)) {
        throw new Error('negotiator: options.root is required');
    }

    var roots = Array.isArray(options.root) ? options.root : [options.root],
        fsWatcherByDirName = {},
        getVariantInfosByBaseName = memoizeAsync(function (rootRelativeDirName, cb) {
            var variantInfosByBaseName = {};
            async.eachLimit(roots.map(function (root) {
                return Path.resolve(root, rootRelativeDirName.substr(1));
            }), 1, function (dirName, cb) {
                fs.readdir(dirName, function (err, fileNames) {
                    if (err) {
                        if (err.code === 'ENOENT') {
                            // Pretend that non-existent directories are empty
                            return cb();
                        } else {
                            return cb(err);
                        }
                    }
                    if (options.watch && !(dirName in fsWatcherByDirName)) {
                        try {
                            fsWatcherByDirName[dirName] = fs.watch(dirName, {}, function (eventName, fileName) {
                                getVariantInfosByBaseName.purge(rootRelativeDirName);
                            });
                        } catch (e) {
                            // Might fail with a ENOSPC error on certain systems. Just ignore the error.
                        }
                    }
                    var statByFileName = {};
                    async.eachLimit(fileNames, 20, function (fileName, cb) {
                        var absolutePath = Path.resolve(dirName, fileName);
                        fs.lstat(absolutePath, function (err, stats) {
                            if (err) {
                                if (err.code === 'ENOENT') {
                                    // Don't break if the file has been removed between readdir and lstat
                                    return cb();
                                } else {
                                    return cb(err);
                                }
                            }
                            if (!stats.isDirectory()) {
                                var matchFileName = fileName.match(/^([\w\-~%!$&'\(\)*+,;=:@]*)((?:\.[\w\-~%!$&'\(\)*+,;=:@]*)*)$/);
                                if (matchFileName) {
                                    var baseName = matchFileName[1] || 'index',
                                        extensionString = matchFileName[2],
                                        variantInfo = {
                                            absolutePath: absolutePath,
                                            fileName: fileName
                                        };

                                    if (extensionString) {
                                        _.extend(variantInfo, getVariantInfoFromExtensionString(extensionString, options.userAgent));
                                    }
                                    (variantInfosByBaseName[baseName] = variantInfosByBaseName[baseName] || []).push(variantInfo);
                                }
                            }
                            cb();
                        });
                    }, cb);
                });
            }, passError(cb, function () {
                // Make sure that the variantInfo objects with the most specific locale ids come first:
                Object.keys(variantInfosByBaseName).forEach(function (baseName) {
                    variantInfosByBaseName[baseName].sort(function (a, b) {
                        return (b.localeId ? b.localeId.length : 0) - (a.localeId ? a.localeId.length : 0);
                    });
                });
                cb(null, variantInfosByBaseName);
            }));
        });

    var getPrioritizedLocaleIds = memoizeSync(function (extensionLocaleId, localeParameterValue, localeCookieValue, acceptLanguageHeaderValue) {
        if (extensionLocaleId) {
            return [extensionLocaleId]; // /foo.en_US.html requires exact match
        }
        var prioritizedLocaleIds = [];
        if (localeParameterValue) {
            prioritizedLocaleIds.push(normalizeLocaleId(localeParameterValue));
        }
        if (localeCookieValue) {
            localeCookieValue.split(',').map(normalizeLocaleId).forEach(function (localeId) {
                Array.prototype.push.apply(prioritizedLocaleIds, expandLocaleIdToPrioritizedList(localeId));
            });
        }
        if (acceptLanguageHeaderValue) {
            acceptLanguageHeaderValue.replace(/;[^,]*/g, "").split(",").map(normalizeLocaleId).forEach(function (localeId) {
                Array.prototype.push.apply(prioritizedLocaleIds, expandLocaleIdToPrioritizedList(localeId));
            });
        }
        prioritizedLocaleIds.push('en_us', 'en');
        return prioritizedLocaleIds;
    });

    var getUserAgentInfo = memoizeSync(function (userAgentString) {
        var userAgentInfo = mario(userAgentString) || {};
        userAgentTypes.forEach(function (userAgentType) {
            if (!userAgentInfo[userAgentType]) {
                userAgentInfo['non' + userAgentType] = true;
            }
        });
        return userAgentInfo;
    });

    return function expressNegotiator(req, res, next) {
        var matchDirAndFileName = req.url.match(/^(\/(?:[\w\.\-~%!$&'\(\)*+,;=:@]+\/)*)([\w\-~%!$&'\(\)*+,;=:@]*)((?:\.[\w\-~%!$&'\(\)*+,;=:@]*)*)((?:\?.*)?)$/);
        if (matchDirAndFileName) {
            var dirName = matchDirAndFileName[1],
                baseName = matchDirAndFileName[2] ? decodeURIComponent(matchDirAndFileName[2]) : 'index',
                extensionString = matchDirAndFileName[3] ? decodeURIComponent(matchDirAndFileName[3]) : '',
                fileName = baseName + extensionString,
                queryString = matchDirAndFileName[4],
                localeCookieValue = options.cookieName && req.cookies && req.cookies[options.cookieName],
                matchLocaleParameterValue = queryString && queryString.match(/[&?]locale=([^&]+)(?:$|&)/),
                fileNameVariantInfo = getVariantInfoFromExtensionString(extensionString),
                prioritizedLocaleIds = getPrioritizedLocaleIds(fileNameVariantInfo.localeId,
                                                               matchLocaleParameterValue && matchLocaleParameterValue[1],
                                                               localeCookieValue,
                                                               req.headers['accept-language']),
                acceptHeader = req.headers.accept,
                acceptHeaderTokens = acceptHeader && parseQuality(acceptHeader);

            return getVariantInfosByBaseName(dirName, passError(next, function (variantInfosByBaseName) {
                var variantInfos = variantInfosByBaseName[baseName],
                    bestVariantInfo,
                    bestVariantQuality;
                if (variantInfos) {
                    for (var i = 0 ; i < prioritizedLocaleIds.length ; i += 1) {
                        var localeId = prioritizedLocaleIds[i];
                        for (var j = 0 ; j < variantInfos.length ; j += 1) {
                            var variantInfo = variantInfos[j];
                            if (variantInfo.fileName === fileName) {
                                // Exact file name match takes precedence over content negotiation
                                return next();
                            } else if (variantInfo.allExtensionsMatched) {
                                if (!variantInfo.localeId || localeIdsEqual(variantInfo.localeId, localeId)) {
                                    var contentTypeQuality = 0;
                                    if (variantInfo.contentType) {
                                        if (fileNameVariantInfo.contentType && fileNameVariantInfo.contentType === variantInfo.contentType) {
                                            contentTypeQuality = 2;
                                        }
                                        if (!contentTypeQuality) {
                                            if (acceptHeaderTokens) {
                                                acceptHeaderTokens.some(function (acceptHeaderToken) {
                                                    if (acceptHeaderToken.value === variantInfo.contentType ||
                                                        acceptHeaderToken.value === '*/*' ||
                                                        acceptHeaderToken.value === '*' ||
                                                        acceptHeaderToken.value === '*/' + variantInfo.contentTypeFragments[1] ||
                                                        acceptHeaderToken.value === variantInfo.contentTypeFragments[0] + '/*') {

                                                        contentTypeQuality = acceptHeaderToken.quality;
                                                        return true; // Short circuit out of the .some
                                                    }
                                                });
                                            } else {
                                                contentTypeQuality = 1;
                                            }
                                        }
                                    } else {
                                        contentTypeQuality = 1;
                                    }
                                    if (options.userAgent && req.headers['user-agent']) {
                                        var userAgentInfo = getUserAgentInfo(req.headers['user-agent']);
                                        userAgentTypes.forEach(function (key) {
                                            if (userAgentInfo[key] && variantInfo.userAgent[key]) {
                                                contentTypeQuality += .001;
                                            }
                                            // Penalize the variant for each user agent type that's only in either the variant info or the User-Agent request header.
                                            // This makes sure that /index.html is preferred over /index.mobile.html on non-mobile user agents.
                                            if (userAgentInfo[key] ^ variantInfo.userAgent[key]) {
                                                contentTypeQuality -= .00001;
                                            }
                                        });
                                    }

                                    // In case two acceptable entries have the same quality, prefer the text/html one.
                                    if (contentTypeQuality > 0 &&
                                        (!bestVariantInfo || contentTypeQuality > bestVariantQuality) ||
                                        (contentTypeQuality === bestVariantQuality && bestVariantInfo.contentType !== 'text/html' && variantInfo.contentType === 'text/html') ||
                                        // Make sure that a strict locale id match takes precedence over an alias (in case eg. both nb and no versions are available):
                                        bestVariantInfo && bestVariantInfo.localeId !== localeId && variantInfo.localeId === localeId) {

                                        bestVariantInfo = variantInfo;
                                        bestVariantQuality = contentTypeQuality;
                                    }
                                }
                            }
                        }
                        // Don't consider the next locale id in the priority list if we've already found a matching variant:
                        if (bestVariantInfo) {
                            break;
                        }
                    }
                    if (bestVariantInfo) {
                        var targetUrl = dirName + bestVariantInfo.fileName + queryString;
                        req.url = targetUrl;
                        res.setHeader('Content-Location', targetUrl.substr(1));
                        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
                        res.setHeader('Vary', 'Cookie, Accept-Language, Accept' + (options.userAgent ? ', User-Agent': ''));

                        if (bestVariantInfo.localeId) {
                            res.setHeader('Content-Language', bestVariantInfo.localeId);
                        }

                        var etag = '';
                        if (bestVariantInfo.contentType && !fileNameVariantInfo.contentType) {
                            etag += bestVariantInfo.contentType + '-';
                        }
                        if (bestVariantInfo.localeId && !fileNameVariantInfo.localeId) {
                            etag += bestVariantInfo.localeId + '-';
                        }

                        // Older Express versions don't have res.locals:
                        (res.locals || req).variantInfo = bestVariantInfo;

                        if (etag.length > 0) {
                            return fs.stat(bestVariantInfo.absolutePath, passError(next, function (stat) {
                                res.setHeader('ETag', '"' + etag + stat.size + '-' + Number(stat.mtime) + '"');
                                // Disable conditional GET via If-Modified-Since for these requests, otherwise the static middleware
                                // might reply with a 304 after a locale switch.
                                delete req.headers['if-modified-since'];
                                next();
                            }));
                        } else {
                            next();
                        }
                    } else {
                        next();
                    }
                } else {
                    next();
                }
            }));
        } else {
            next();
        }
    };
};
