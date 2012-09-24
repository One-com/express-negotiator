var path = require('path'),
    vows = require('vows'),
    assert = require('assert'),
    http = require('http'),
    express = require('express'), // So that http.IncomingMessage.prototype gets patched
    _ = require('underscore'),
    rewriteStaticUrlToLocalized = require('../lib/middleware/rewriteStaticUrlToLocalized')({
        root: path.resolve(__dirname, 'rewriteStaticUrlToLocalized'),
        cookieName: 'locale'
    });

function createVow(requestProperties, expectedRewrittenUrl) {
    var req = new http.IncomingMessage();
    _.extend(req, requestProperties);
    req.headers = req.headers || {};
    req.headers.accept = req.headers.accept || 'text/html';
    req.cookies = req.cookies || {};
    var context = {
        topic: function () {
            var callback = this.callback;
            rewriteStaticUrlToLocalized(req, new http.OutgoingMessage(), function (err) {
                callback(err, req);
            });
        }
    };
    context['should be rewritten to ' + expectedRewrittenUrl] = function (rewrittenReq) {
        assert.deepEqual(rewrittenReq.url, expectedRewrittenUrl);
    };
    return context;
}

vows.describe('rewriteStaticUrlToLocalized').addBatch({
    '/': createVow({url: '/'}, '/index.en_US.html'),
    '/?foo=bar': createVow({url: '/?foo=bar'}, '/index.en_US.html?foo=bar'),
    '/ with cookie': createVow({url: '/', cookies: {locale: 'da'}}, '/index.da.html'),
    '/ with oddly cased cookie': createVow({url: '/', cookies: {locale: 'dA'}}, '/index.da.html'),
    '/ with oddly cased cookie': createVow({url: '/', cookies: {locale: 'da-Dk'}}, '/index.da_DK.html'),
    '/?locale=da': createVow({url: '/?locale=da'}, '/index.da.html?locale=da'),
    '/ with bogus cookie': createVow({url: '/', cookies: {locale: 'sarbarbab'}}, '/index.en_US.html'),
    '/ with cookie and conflicting Accept-Language': createVow({url: '/', cookies: {locale: 'da'}, headers: {'accept-language': 'da-DK'}}, '/index.da.html'),
    '/?locale=da with conflicting cookie and conflicting Accept-Language': createVow({url: '/?locale=da', cookies: {locale: 'en_US'}, headers: {'accept-language': 'nl'}}, '/index.da.html?locale=da'),
    '/ with simple Accept-Language': createVow({url: '/', headers: {'accept-language': 'da'}}, '/index.da.html'),
    '/ with oddly cased Accept-Language': createVow({url: '/', headers: {'accept-language': 'dA'}}, '/index.da.html'),
    '/ with complex Accept-Language': createVow({url: '/', headers: {'accept-language': 'en-GB;q=1,da-DK;q=0.8,da'}}, '/index.da_DK.html'),
    '/ot%68er': createVow({url: '/ot%68er'}, '/other.en_US.html'),
    '/other': createVow({url: '/other'}, '/other.en_US.html'),
    '/other?foo=bar': createVow({url: '/other?foo=bar'}, '/other.en_US.html?foo=bar'),
    '/other with cookie': createVow({url: '/other', cookies: {locale: 'da'}}, '/other.da.html'),
    '/other with simple Accept-Language': createVow({url: '/other', headers: {'accept-language': 'da'}}, '/other.da.html'),
    '/other with complex Accept-Language': createVow({url: '/other', headers: {'accept-language': 'en-GB;q=1,da-DK;q=0.8,da'}}, '/other.da_DK.html'),
    '/subdir/': createVow({url: '/subdir/'}, '/subdir/index.en_US.html'),
    '/subdir/?foo=bar': createVow({url: '/subdir/?foo=bar'}, '/subdir/index.en_US.html?foo=bar'),
    '/subdir/ with cookie': createVow({url: '/subdir/', cookies: {locale: 'da'}}, '/subdir/index.da.html'),
    '/subdir/ with simple Accept-Language': createVow({url: '/subdir/', headers: {'accept-language': 'da'}}, '/subdir/index.da.html'),
    '/subdir/other': createVow({url: '/subdir/other'}, '/subdir/other.en_US.html'),
    '/subdir/other?locale=da': createVow({url: '/subdir/other?locale=da'}, '/subdir/other.da.html?locale=da'),
    '/subdir/other?locale=dA': createVow({url: '/subdir/other?locale=dA'}, '/subdir/other.da.html?locale=dA'),
    '/subdir/other?foo=bar': createVow({url: '/subdir/other?foo=bar'}, '/subdir/other.en_US.html?foo=bar'),
    '/subdir/other with cookie': createVow({url: '/subdir/other', cookies: {locale: 'da'}}, '/subdir/other.da.html'),
    '/subdir/other with simple Accept-Language': createVow({url: '/subdir/other', headers: {'accept-language': 'da'}}, '/subdir/other.da.html'),
    '/subdirwithnonlocalized/': createVow({url: '/subdirwithnonlocalized/'}, '/subdirwithnonlocalized/index.html'),
    '/subdirwithnonlocalized/other': createVow({url: '/subdirwithnonlocalized/other'}, '/subdirwithnonlocalized/other.html'),
    '/nonexistentdir/': createVow({url: '/nonexistentdir/'}, '/nonexistentdir/'),
    '/$': createVow({url: '/$'}, '/$'),
    '/foo': createVow({url: '/foo', headers: {accept: 'text/cache-manifest'}}, '/foo.en_US.appcache'),
    '/foo.appcache': createVow({url: '/foo.appcache', headers: {accept: 'text/cache-manifest'}}, '/foo.en_US.appcache'),
    '/foo.appcache.en_GB': createVow({url: '/foo.appcache.en_GB'}, '/foo.en_GB.appcache'),
    '/foo.appcache.en_GB.blah': createVow({url: '/foo.appcache.en_GB.blah'}, '/foo.appcache.en_GB.blah'), // Prefer exact match
    '/foo.de.appcache': createVow({url: '/foo.de.appcache'}, '/foo.appcache.de'),
    '/ with Accept: text/cache-manifest': createVow({url: '/', headers: {accept: 'text/cache-manifest'}}, '/index.en_US.appcache'),
    '/ with Accept: text/cache-manifest and Accept-Language: da': createVow({url: '/', headers: {accept: 'text/cache-manifest', 'accept-language': 'da'}}, '/index.da.appcache'),
    '/index with Accept that prefers text/cache-manifest': createVow({url: '/index', headers: {accept: 'text/cache-manifest;q=1,text/html;q=0.8'}}, '/index.en_US.appcache'),
    '/index with Accept that prefers text/html': createVow({url: '/index', headers: {accept: 'text/html;q=1,text/cache-manifest;q=0.8'}}, '/index.en_US.html'),
    '/onlyIndexHtml/ with Accept: */*': createVow({url: '/onlyIndexHtml/', headers: {accept: '*/*'}}, '/onlyIndexHtml/index.html'),
    '/thething with Accept: text/html': createVow({url: '/thething', headers: {accept: 'text/html'}}, '/thething.html'),
    '/thething with Accept: */*': createVow({url: '/thething', headers: {accept: '*/*'}}, '/thething.html'),
    '/thething with Accept: text/*': createVow({url: '/thething', headers: {accept: 'text/*'}}, '/thething.html'),
    '/thething with Accept: */html': createVow({url: '/thething', headers: {accept: '*/html'}}, '/thething.html')
})['export'](module);
