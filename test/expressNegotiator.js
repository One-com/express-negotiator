var Path = require('path'),
    expect = require('unexpected'),
    http = require('http'),
    express = require('express'), // So that http.IncomingMessage.prototype gets patched
    expressNegotiator = require('../lib/expressNegotiator'),
    _ = require('underscore');

function createTest(description, requestProperties, expectedRewrittenUrl, expressNegotiatorOptions) {
    var req = new http.IncomingMessage();
    _.extend(req, requestProperties);
    req.headers = req.headers || {};
    req.headers.accept = req.headers.accept || 'text/html';
    req.cookies = req.cookies || {};
    describe(description, function () {
        it('should be rewritten to ' + expectedRewrittenUrl, function (done) {
            expressNegotiator(_.extend({
                root: Path.resolve(__dirname, 'root'),
                cookieName: 'locale'
            }, expressNegotiatorOptions))(req, new http.OutgoingMessage(), function (err) {
                expect(req.url, 'to equal', expectedRewrittenUrl);
                done();
            });
        });
    });
}

describe('express-negotiator', function () {
    createTest('/', {url: '/'}, '/index.en_US.html');
    createTest('/?foo=bar', {url: '/?foo=bar'}, '/index.en_US.html?foo=bar');
    createTest('/ with cookie', {url: '/', cookies: {locale: 'da'}}, '/index.da.html');
    createTest('/ with oddly cased cookie', {url: '/', cookies: {locale: 'dA'}}, '/index.da.html');
    createTest('/ with oddly cased cookie', {url: '/', cookies: {locale: 'da-Dk'}}, '/index.da_DK.html');
    createTest('/?locale=da', {url: '/?locale=da'}, '/index.da.html?locale=da');
    createTest('/ with bogus cookie', {url: '/', cookies: {locale: 'sarbarbab'}}, '/index.en_US.html');
    createTest('/ with cookie and conflicting Accept-Language', {url: '/', cookies: {locale: 'da'}, headers: {'accept-language': 'da-DK'}}, '/index.da.html');
    createTest('/?locale=da with conflicting cookie and conflicting Accept-Language', {url: '/?locale=da', cookies: {locale: 'en_US'}, headers: {'accept-language': 'nl'}}, '/index.da.html?locale=da');
    createTest('/ with simple Accept-Language', {url: '/', headers: {'accept-language': 'da'}}, '/index.da.html');
    createTest('/ with oddly cased Accept-Language', {url: '/', headers: {'accept-language': 'dA'}}, '/index.da.html');
    createTest('/ with complex Accept-Language', {url: '/', headers: {'accept-language': 'en-GB;q=1,da-DK;q=0.8,da'}}, '/index.da_DK.html');
    createTest('/ot%68er', {url: '/ot%68er'}, '/other.en_US.html');
    createTest('/other', {url: '/other'}, '/other.en_US.html');
    createTest('/other?foo=bar', {url: '/other?foo=bar'}, '/other.en_US.html?foo=bar');
    createTest('/other with cookie', {url: '/other', cookies: {locale: 'da'}}, '/other.da.html');
    createTest('/other with simple Accept-Language', {url: '/other', headers: {'accept-language': 'da'}}, '/other.da.html');
    createTest('/other with complex Accept-Language', {url: '/other', headers: {'accept-language': 'en-GB;q=1,da-DK;q=0.8,da'}}, '/other.da_DK.html');
    createTest('/subdir/', {url: '/subdir/'}, '/subdir/index.en_US.html');
    createTest('/subdir/?foo=bar', {url: '/subdir/?foo=bar'}, '/subdir/index.en_US.html?foo=bar');
    createTest('/subdir/ with cookie', {url: '/subdir/', cookies: {locale: 'da'}}, '/subdir/index.da.html');
    createTest('/subdir/ with simple Accept-Language', {url: '/subdir/', headers: {'accept-language': 'da'}}, '/subdir/index.da.html');
    createTest('/subdir/other', {url: '/subdir/other'}, '/subdir/other.en_US.html');
    createTest('/subdir/other?locale=da', {url: '/subdir/other?locale=da'}, '/subdir/other.da.html?locale=da');
    createTest('/subdir/other?locale=dA', {url: '/subdir/other?locale=dA'}, '/subdir/other.da.html?locale=dA');
    createTest('/subdir/other?foo=bar', {url: '/subdir/other?foo=bar'}, '/subdir/other.en_US.html?foo=bar');
    createTest('/subdir/other with cookie', {url: '/subdir/other', cookies: {locale: 'da'}}, '/subdir/other.da.html');
    createTest('/subdir/other with simple Accept-Language', {url: '/subdir/other', headers: {'accept-language': 'da'}}, '/subdir/other.da.html');
    createTest('/subdirwithnonlocalized/', {url: '/subdirwithnonlocalized/'}, '/subdirwithnonlocalized/index.html');
    createTest('/subdirwithnonlocalized/other', {url: '/subdirwithnonlocalized/other'}, '/subdirwithnonlocalized/other.html');
    createTest('/nonexistentdir/', {url: '/nonexistentdir/'}, '/nonexistentdir/');
    createTest('/$', {url: '/$'}, '/$');
    createTest('/foo', {url: '/foo', headers: {accept: 'text/cache-manifest'}}, '/foo.en_US.appcache');
    createTest('/foo.appcache', {url: '/foo.appcache', headers: {accept: 'text/cache-manifest'}}, '/foo.en_US.appcache');
    createTest('/foo.appcache.en_GB', {url: '/foo.appcache.en_GB'}, '/foo.en_GB.appcache');
    createTest('/foo.appcache.en_GB.blah', {url: '/foo.appcache.en_GB.blah'}, '/foo.appcache.en_GB.blah'), // Prefer exact match
    createTest('/foo.de.appcache', {url: '/foo.de.appcache'}, '/foo.appcache.de');
    createTest('/ with Accept: text/cache-manifest', {url: '/', headers: {accept: 'text/cache-manifest'}}, '/index.en_US.appcache');
    createTest('/ with Accept: text/cache-manifest and Accept-Language: da', {url: '/', headers: {accept: 'text/cache-manifest', 'accept-language': 'da'}}, '/index.da.appcache');
    createTest('/index with Accept that prefers text/cache-manifest', {url: '/index', headers: {accept: 'text/cache-manifest;q=1,text/html;q=0.8'}}, '/index.en_US.appcache');
    createTest('/index with Accept that prefers text/html', {url: '/index', headers: {accept: 'text/html;q=1,text/cache-manifest;q=0.8'}}, '/index.en_US.html');
    createTest('/onlyIndexHtml/ with Accept: */*', {url: '/onlyIndexHtml/', headers: {accept: '*/*'}}, '/onlyIndexHtml/index.html');
    createTest('/thething with Accept: text/html', {url: '/thething', headers: {accept: 'text/html'}}, '/thething.html');
    createTest('/thething with Accept: */*', {url: '/thething', headers: {accept: '*/*'}}, '/thething.html');
    createTest('/thething with Accept: text/*', {url: '/thething', headers: {accept: 'text/*'}}, '/thething.html');
    createTest('/thething with Accept: */html', {url: '/thething', headers: {accept: '*/html'}}, '/thething.html');
    createTest('/ Accept: */html, a touch user agent and userAgent:true', {url: '/', headers: {accept: '*/html', 'user-agent': 'Mozilla/5.0 (iPad; U; CPU OS 4_3_2 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8H7 Safari/6533.18.5"'}}, '/index.touch.en_US.html', {userAgent: true});
    createTest('/ Accept: */html, a touch user agent and userAgent:false', {url: '/', headers: {accept: '*/html', 'user-agent': 'Mozilla/5.0 (iPad; U; CPU OS 4_3_2 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8H7 Safari/6533.18.5"'}}, '/index.en_US.html', {userAgent: false});
    createTest('/ Accept: */html, a non-touch user agent and userAgent:true', {url: '/', headers: {accept: '*/html', 'user-agent': 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1; Trident/5.0; SLCC2; .NET CLR 2.0.50727; .NET CLR 3.5.30729; .NET CLR 3.0.30729; Media Center PC 6.0; .NET4.0C)'}}, '/index.en_US.html', {userAgent: true});
    createTest('/bar Accept: */html userAgent:false', {url: '/bar', headers: {accept: '*/html', 'user-agent': 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1; Trident/5.0; SLCC2; .NET CLR 2.0.50727; .NET CLR 3.5.30729; .NET CLR 3.0.30729; Media Center PC 6.0; .NET4.0C)'}}, '/bar.html', {userAgent: false});
    createTest('/bar Accept: */html, a non-touch user agent and userAgent:true', {url: '/bar', headers: {accept: '*/html', 'user-agent': 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1; Trident/5.0; SLCC2; .NET CLR 2.0.50727; .NET CLR 3.5.30729; .NET CLR 3.0.30729; Media Center PC 6.0; .NET4.0C)'}}, '/bar.nontouch.html', {userAgent: true});
    createTest('/bar Accept: */html, a touch user agent and userAgent:true', {url: '/bar', headers: {accept: '*/html', 'user-agent': 'Mozilla/5.0 (iPad; U; CPU OS 4_3_2 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8H7 Safari/6533.18.5"'}}, '/bar.touch.html', {userAgent: true});
    createTest('/baz Accept: */html, a non-touch user agent and userAgent:true', {url: '/baz', headers: {accept: '*/html', 'user-agent': 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1; Trident/5.0; SLCC2; .NET CLR 2.0.50727; .NET CLR 3.5.30729; .NET CLR 3.0.30729; Media Center PC 6.0; .NET4.0C)'}}, '/baz.nontouch.html', {userAgent: true});
    createTest('/baz Accept: */html, a touch user agent and userAgent:true', {url: '/baz', headers: {accept: '*/html', 'user-agent': 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; ARM; Trident/6.0; Touch)'}}, '/baz.touch.html', {userAgent: true});

    createTest('a non-locale id and non-mario extension in the request url should be honored, and if a variant has it, it should be preferred', {url: '/index.nocdn', headers: {accept: '*/html'}}, '/index.nocdn.en_US.html');

    // no and nb should be considered aliases:

    createTest('Accept-Language: no with only nb and en versions available', {url: '/onlyNbAndEnAvailable', headers: {accept: '*/html', 'accept-language': 'no'}}, '/onlyNbAndEnAvailable.nb.html');
    createTest('Accept-Language: nb with only no and en versions available', {url: '/onlyNoAndEnAvailable', headers: {accept: '*/html', 'accept-language': 'nb'}}, '/onlyNoAndEnAvailable.no.html');

    createTest('Accept-Language: nb with only no, nb, and en versions available', {url: '/onlyNoAndNbAndEnAvailable', headers: {accept: '*/html', 'accept-language': 'nb'}}, '/onlyNoAndNbAndEnAvailable.nb.html');
    createTest('Accept-Language: no with only no, nb, and en versions available', {url: '/onlyNoAndNbAndEnAvailable', headers: {accept: '*/html', 'accept-language': 'no'}}, '/onlyNoAndNbAndEnAvailable.no.html');

    createTest('should not substitute an html resource with .appcache is in the url', {url: '/blah/index.appcache', headers: {Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'}}, '/blah/index.appcache');

    describe('with multiple roots', function () {
        createTest(
            '/ with simple Accept-Language matching a file in root1',
            {url: '/', headers: {'accept-language': 'en_US'}},
            '/index.en_US.html',
            {
                root: [
                    Path.resolve(__dirname, 'multipleRoots', 'root1'),
                    Path.resolve(__dirname, 'multipleRoots', 'root2')
                ]
            }
        );

        createTest(
            '/ with simple Accept-Language matching a file in root2',
            {url: '/', headers: {'accept-language': 'da'}},
            '/index.da.html',
            {
                root: [
                    Path.resolve(__dirname, 'multipleRoots', 'root1'),
                    Path.resolve(__dirname, 'multipleRoots', 'root2')
                ]
            }
        );
    });
});
