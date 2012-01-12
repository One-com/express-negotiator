var path = require('path'),
    vows = require('vows'),
    assert = require('assert'),
    http = require('http'),
    express = require('express'), // So that http.IncomingMessage.prototype gets patched
    _ = require('underscore'),
    rewriteToLocalizedHtml = require('../lib/middleware/rewriteToLocalizedHtml');

function createVow(options, req, expectedRewrittenUrl) {
    options.root = path.resolve(__dirname, 'rewriteToLocalizedHtml', options.root);
    options.cookieName = options.cookieName || 'locale';
    req.headers = req.headers || {};
    req.headers.accept = req.headers.accept || 'text/html';
    req.cookies = req.cookies || {};
    req.__proto__ = http.IncomingMessage.prototype;
    var context = {
        topic: function () {
            var callback = this.callback;
            rewriteToLocalizedHtml(options)(req, null, function (err) {
                callback(err, req);
            });
        }
    };
    context['should rewrite the request url to ' + expectedRewrittenUrl] = function (rewrittenReq) {
        assert.deepEqual(rewrittenReq.url, expectedRewrittenUrl);
    };
    return context;
}

vows.describe('rewriteToLocalizedHtml').addBatch({
    '/': createVow({}, {url: '/'}, '/index.en_US.html'),
    '/ with cookie': createVow({}, {url: '/', cookies: {locale: 'da'}}, '/index.da.html'),
    '/other': createVow({}, {url: '/other'}, '/other.en_US.html'),
    '/other with cookie': createVow({}, {url: '/other', cookies: {locale: 'da'}}, '/other.da.html'),
    '/subdir/': createVow({}, {url: '/subdir/'}, '/subdir/index.en_US.html'),
    '/subdir/ with cookie': createVow({}, {url: '/subdir/', cookies: {locale: 'da'}}, '/subdir/index.da.html'),
    '/subdir/other': createVow({}, {url: '/subdir/other'}, '/subdir/other.en_US.html'),
    '/subdir/other with cookie': createVow({}, {url: '/subdir/other', cookies: {locale: 'da'}}, '/subdir/other.da.html')
})['export'](module);
