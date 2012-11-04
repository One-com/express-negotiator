express-negotiator
==================

Express/connect middleware for doing content negotiation with static
files on disc. Heavily inspired by Apache's <a
href="http://httpd.apache.org/docs/2.2/mod/mod_negotiation.html">mod_negotiation</a>.

Negotiator rewrites `req.url` to the negotiated file name based on
these factors (in descending order of importance):

* Whether `req.url` matches a file name on disc exactly
* The `locale` GET parameter
* The value of a locale cookie (optional, specified by `options.cookieName`)
* The `Accept-Language` and `Accept` headers

... and of course the availability of suitable files on disc. If no
acceptable match is found, `req.url` is left untouched.

Like `mod_negotiation`, `express-negotiator` interprets the extensions
of the files on disc as an unordered set. A file called `foo.html.fr`
would be treated the same as one called `foo.fr.html` except when the
request url specifies an exact match.

The negotiator middleware is intended to run right before `static`
pointed at the same directory as `options.root`.

If `options.cookieName` is specified, the `cookieParser` middleware
must also be in the middleware chain.


Conditional requests
====================

When the url is rewritten, negotiator sets the ETag header to the same
value as the `static` middleware would
(`"<size>-<modificationTime>"`), but with the negotiated Content-Type
and locale id bits prefixed. This prevents false positive 304
responses with `If-None-Match` when the same client (or reverse proxy)
requests the same url later with different headers (eg. after a locale
cookie change). That would happen if the files happened to have the
same size and modification times.

Also, the `If-Modified-Since` header is removed since that would cause
the `static` middleware to reply `304 Not Modified` in similar
situations. ETags are a superior concept anyway.

Installation
============

Make sure you have <a href="http://nodejs.org/">node.js</a> and <a
href="http://npmjs.org/">npm</a> installed, then run:

```
$ npm install express-negotiator
```

Example usage
=============

```javascript
var express = require('express'),
    negotiator = require('express-negotiator'),
    root = '/path/to/static/files',
    app = express.createServer();

app
    .use(express.cookieParser())
    .use(negotiator({root: root, cookieName: 'mycookie'}))
    .use(express.static(root))
    .listen(1337);
```

If the root dir contains the files `index.en.html`, `index.da.html`,
and `foo.png` these example requests would be rewritten as follows:

```
GET / HTTP/1.1
Accept: text/html
Accept-Language: en

=>

GET /index.en.html
ETag: "<size>-<modificationTime>-text/html-en"
```

```
GET /?locale=da HTTP/1.1
Accept: text/html
Accept-Language: en

=>

GET /index.da.html
ETag: "<size>-<modificationTime>-text/html-da"
```

```
GET /index HTTP/1.1
Cookie: mycookie=da
Accept: text/html
Accept-Language: en

=>

GET /index.da.html
ETag: "<size>-<modificationTime>-text/html-da"
```

```
GET /foo HTTP/1.1
Accept: image/*

=>

GET /foo.png
ETag: "<size>-<modificationTime>-image/png"
```

See the test suite for more examples.

License
=======

express-negotiator is licensed under a standard 3-clause BSD license
-- see the `LICENSE` file for details.
