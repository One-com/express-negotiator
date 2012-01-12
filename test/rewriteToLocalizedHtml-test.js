var path = require('path'),
    vows = require('vows'),
    assert = require('assert'),
    http = require('http'),
    express = require('express'), // So that http.IncomingMessage.prototype gets patched
    _ = require('underscore'),
    rewriteToLocalizedHtml = require('../lib/middleware/rewriteToLocalizedHtml')({
        root: path.resolve(__dirname, 'rewriteToLocalizedHtml'),
        cookieName: 'locale'
    });

function createVow(req, expectedRewrittenUrl) {
    req.headers = req.headers || {};
    req.headers.accept = req.headers.accept || 'text/html';
    req.cookies = req.cookies || {};
    req.__proto__ = http.IncomingMessage.prototype;
    var context = {
        topic: function () {
            var callback = this.callback;
            rewriteToLocalizedHtml(req, null, function (err) {
                callback(err, req);
            });
        }
    };
    context['should be rewritten to ' + expectedRewrittenUrl] = function (rewrittenReq) {
        assert.deepEqual(rewrittenReq.url, expectedRewrittenUrl);
    };
    return context;
}

vows.describe('rewriteToLocalizedHtml').addBatch({
    '/': createVow({url: '/'}, '/index.en_US.html'),
    '/?foo=bar': createVow({url: '/?foo=bar'}, '/index.en_US.html?foo=bar'),
    '/ with cookie': createVow({url: '/', cookies: {locale: 'da'}}, '/index.da.html'),
    '/ with bogus cookie': createVow({url: '/', cookies: {locale: 'sarbarbab'}}, '/index.en_US.html'),
    '/ with cookie and conflicting Accept-Language': createVow({url: '/', cookies: {locale: 'da'}, headers: {'accept-language': 'da-DK'}}, '/index.da.html'),
    '/ with simple Accept-Language': createVow({url: '/', headers: {'accept-language': 'da'}}, '/index.da.html'),
    '/ with complex Accept-Language': createVow({url: '/', headers: {'accept-language': 'en-GB;q=1,da-DK;q=0.8,da'}}, '/index.da_DK.html'),
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
    '/subdir/other?foo=bar': createVow({url: '/subdir/other?foo=bar'}, '/subdir/other.en_US.html?foo=bar'),
    '/subdir/other with cookie': createVow({url: '/subdir/other', cookies: {locale: 'da'}}, '/subdir/other.da.html'),
    '/subdir/other with simple Accept-Language': createVow({url: '/subdir/other', headers: {'accept-language': 'da'}}, '/subdir/other.da.html'),
    '/subdirwithnonlocalized/': createVow({url: '/subdirwithnonlocalized/'}, '/subdirwithnonlocalized/index.html'),
    '/subdirwithnonlocalized/other': createVow({url: '/subdirwithnonlocalized/other'}, '/subdirwithnonlocalized/other.html'),
    '/nonexistentdir/': createVow({url: '/nonexistentdir/'}, '/nonexistentdir/'),
    '/$': createVow({url: '/$'}, '/$')
})['export'](module);
