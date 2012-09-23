/*
 * Middleware that rewrites `req.url` to `/<fileName>.<localeId>.<extension>`
 * (as output by `buildProduction`) based on the value of a cookie
 * (optional, set by `options.cookieName`), the `Accept-Language`
 * request header, the `Accept` header, and the directory contents.
 *
 * rewriteStaticUrlToLocalized is intended to run right before `static`
 * pointed at the same directory as `options.root`.
 *
 * If `options.cookieName` is specified, the `cookieParser` middleware
 * must also be in the middleware chain.
 */

var fs = require('fs'),
    Path = require('path'),
    _ = require('underscore'),
    passError = require('passerror'),
    memoizeAsync = require('../memoizeAsync'),
    memoizer = require('memoizer'),
    mime = require('mime'),
    // List taken from an older version of CLDR, so it's probably incomplete:
    isLocaleIdRegExp = /^(?:aa|af|ak|am|ar|as|asa|az|be|bem|bez|bg|bm|bn|bo|br|brx|bs|byn|ca|cch|cgg|chr|cs|cy|da|dav|de|dv|dz|ebu|ee|el|en|eo|es|et|eu|fa|ff|fi|fil|fo|fr|fur|ga|gaa|gez|gl|gsw|gu|guz|gv|ha|haw|he|hi|hr|hu|hy|ia|id|ig|ii|in|is|it|iu|iw|ja|jmc|ka|kab|kaj|kam|kcg|kde|kea|kfo|khq|ki|kk|kl|kln|km|kn|ko|kok|kpe|ksb|ksh|ku|kw|ky|lag|lg|ln|lo|lt|luo|luy|lv|mas|mer|mfe|mg|mi|mk|ml|mn|mo|mr|ms|mt|my|naq|nb|nd|nds|ne|nl|nn|no|nr|nso|ny|nyn|oc|om|or|pa|pl|ps|pt|rm|ro|rof|root|ru|rw|rwk|sa|saq|se|seh|ses|sg|sh|shi|si|sid|sk|sl|sn|so|sq|sr|ss|ssy|st|sv|sw|syr|ta|te|teo|tg|th|ti|tig|tl|tn|to|tr|trv|ts|tt|tzm|ug|uk|ur|uz|ve|vi|vun|wal|wo|xh|xog|yo|zh|zu)(?:_|$)/;

// Note: These obscure extensions are listed in require('mime').types AND are considered valid locale ids: nb, so, ps, kfo, rm, st, sh, sid, in, tr, ms, gv, ts
// When resolving the variants we interpret them as locale ids take precendence.

// From Express 3.0:
function parseQualityToken(str) {
  var parts = str.split(/ *; */),
      val = parts[0],
      q = parts[1] ? parseFloat(parts[1].split(/ *= */)[1]) : 1;

  return { value: val, quality: q };
}

function parseQuality(str){
    return str
        .split(/ *, */)
        .map(parseQualityToken)
        .filter(function(obj) {
            return obj.quality;
        })
        .sort(function(a, b) {
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

// .html.en-US => {contentType: 'text/html', contentTypeFragments: ['text', 'html'], localeId: 'en_us'}
function getVariantInfoFromExtensionString(extensionString) {
    var variantInfo = {
        allExtensionsMatched: true
    };
    if (extensionString) {
        extensionString.split(/(?=\.)/).forEach(function (extension) {
            var localeId = normalizeLocaleId(extension.substr(1));
            if (isLocaleIdRegExp.test(localeId)) {
                variantInfo.localeId = localeId;
            } else {
                var contentType = mime.types[extension.substr(1)];
                if (contentType) {
                    variantInfo.contentType = contentType;
                    variantInfo.contentTypeFragments = contentType.split('/');
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
        throw new Error('rewriteStaticUrlToLocalized: options.root is required');
    }
    var memoizerByDir = {};
    function getVariantInfosByBaseName(dir, cb) {
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
                    var variantInfosByBaseName = {};
                    if (!err) {
                        fileNames.forEach(function (fileName) {
                            var matchFileName = fileName.match(/^([\w\-~%!$&'\(\)*+,;=:@]*)((?:\.[\w\-~%!$&'\(\)*+,;=:@]*)*)$/);
                            if (matchFileName) {
                                var baseName = matchFileName[1] || 'index',
                                    extensionString = matchFileName[2],
                                    variantInfo = {
                                        fileName: fileName
                                    };

                                if (extensionString) {
                                    _.extend(variantInfo, getVariantInfoFromExtensionString(extensionString));
                                }
                                (variantInfosByBaseName[baseName] = variantInfosByBaseName[baseName] || []).push(variantInfo);
                            }
                        });
                    }
                    // Make sure that the variantInfo objects with the most specific locale ids come first:
                    Object.keys(variantInfosByBaseName).forEach(function (baseName) {
                        variantInfosByBaseName[baseName].sort(function (a, b) {
                            return (b.localeId ? b.localeId.length : 0) - (a.localeId ? a.localeId.length : 0);
                        });
                    });
                    cb_(null, variantInfosByBaseName);
                });
            });
        }
        memoizerByDir[dir](cb);
    }

    var getPrioritizedLocaleIds = memoizer(function (extensionLocaleId, localeParameterValue, localeCookieValue, acceptLanguageHeaderValue) {
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

    var cookieNameLowerCased = options.cookieName && options.cookieName.toLowerCase();

    return function rewriteStaticUrlToLocalized(req, res, next) {
        var matchDirAndFileName = req.url.match(/^(\/(?:[\w\.\-~%!$&'\(\)*+,;=:@]+\/)*)([\w\-~%!$&'\(\)*+,;=:@]*)((?:\.[\w\-~%!$&'\(\)*+,;=:@]*)*)((?:\?.*)?)$/);
        if (matchDirAndFileName) {
            var dir = matchDirAndFileName[1],
                baseName = matchDirAndFileName[2] ? decodeURIComponent(matchDirAndFileName[2]) : 'index',
                extensionString = matchDirAndFileName[3] ? decodeURIComponent(matchDirAndFileName[3]) : '',
                fileName = baseName + extensionString,
                queryString = matchDirAndFileName[4],
                localeCookieValue = cookieNameLowerCased && req.cookies && req.cookies[cookieNameLowerCased],
                matchLocaleParameterValue = queryString && queryString.match(/[&?]locale=([^&]+)(?:$|&)/),
                fileNameVariantInfo = getVariantInfoFromExtensionString(extensionString),
                prioritizedLocaleIds = getPrioritizedLocaleIds(fileNameVariantInfo.localeId,
                                                               matchLocaleParameterValue && matchLocaleParameterValue[1],
                                                               localeCookieValue,
                                                               req.headers['accept-language']),
                acceptHeader = req.headers.accept,
                acceptHeaderTokens = acceptHeader && parseQuality(acceptHeader);

            return getVariantInfosByBaseName(Path.resolve(options.root, dir.substr(1)), passError(next, function (variantInfosByBaseName) {
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
                                if (!variantInfo.localeId || variantInfo.localeId === localeId) {
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

                                    // In case two acceptable entries have the same quality, prefer the text/html one.
                                    if (contentTypeQuality > 0 &&
                                        (!bestVariantInfo || contentTypeQuality > bestVariantQuality) ||
                                        (contentTypeQuality === bestVariantQuality && bestVariantInfo.contentType !== 'text/html' && variantInfo.contentType === 'text/html')) {

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
                        var targetUrl = dir + bestVariantInfo.fileName + queryString;
                        req.url = targetUrl;
                        res.setHeader('Content-Location', targetUrl.substr(1));
                        res.setHeader('Vary', 'Cookie, Accept-Language, Accept');

                        var etag = '';
                        if (bestVariantInfo.contentType && !fileNameVariantInfo.contentType) {
                            etag += bestVariantInfo.contentType + '-';
                        }
                        if (bestVariantInfo.localeId && !fileNameVariantInfo.localeId) {
                            etag += bestVariantInfo.localeId + '-';
                        }

                        if (etag.length > 0) {
                            return fs.stat(Path.resolve(options.root, targetUrl.substr(1).replace(/\?.*$/, '')), passError(next, function (stat) {
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
