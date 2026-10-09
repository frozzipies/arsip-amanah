const http = require('http');

const PORT = Number(process.env.PORT || 8080);
const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:5000';
const TTL_MS = Number(process.env.TTL_MS || 300000);

const STATIC_EXT = /\.(css|js|woff2?|png|jpe?g|svg|map)$/i;

// Dokumentasi internal memakai id numerik 9 digit. Dokumentasi publik
// pakai id kata. Gateway blokir id numerik supaya tidak bocor lewat
// request biasa.
const INTERNAL_ROUTE = /^\/dokumen\/\d{6,}$/;

const cache = new Map();
const index = new Map();

const PUBLIC_DOCS = ['nota-pengajuan', 'nota-rapat', 'nota-legal'];

function keyFor(method, pathname) {
  return `${method} ${pathname}`;
}

async function fetchOrigin(pathname, headers) {
  return fetch(`${ORIGIN}${pathname}`, { headers, redirect: 'manual' });
}

// Sama seperti fetchOrigin, tapi ruta fallback perlu meneruskan query
// string juga supaya /nonce?n=... nggak selalu berakhir di n=0.
async function fetchOriginUrl(fullPath, headers) {
  return fetch(`${ORIGIN}${fullPath}`, { headers, redirect: 'manual' });
}

// Digest masuk index begitu response 200 punya digest, cacheable
// atau nggak. Yang cacheable cuma body-nya yang disimpan. Ini yang
// bikin dokumen private tetap bisa di-index tanpa sempat di-cache.
function registerIndex(pathname, upstream) {
  const repr = upstream.headers.get('repr-digest');
  const content = upstream.headers.get('content-digest');
  const sifat = upstream.headers.get('x-sifat');
  if (repr) index.set(repr, { pathname, sifat });
  if (content) index.set(content, { pathname, sifat });
}

function indexable(upstream) {
  const cc = upstream.headers.get('cache-control') || '';
  return /public/.test(cc) && !/no-store|private/.test(cc);
}

async function fetchAndMaybeCache(req, pathname, respond) {
  const key = keyFor(req.method, pathname);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.storedAt < TTL_MS) {
    respond(hit.status, { ...hit.headers, 'X-Cache': 'HIT', 'X-Kunci': key }, hit.body);
    return;
  }

  let upstream;
  try {
    const search = new URL(req.url, 'http://x').search;
    upstream = await fetchOriginUrl(pathname + search, req.headers);
  } catch (e) {
    respond(502, { 'Content-Type': 'text/plain' }, `origin error: ${e.message}`);
    return;
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  const cc = upstream.headers.get('cache-control') || '';

  const outHeaders = {
    'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    'Repr-Digest': upstream.headers.get('repr-digest') ?? '',
    'Content-Digest': upstream.headers.get('content-digest') ?? '',
    'X-Algoritma-Digest': upstream.headers.get('x-algoritma-digest') ?? '',
    'X-Sifat': upstream.headers.get('x-sifat') ?? '',
    'Cache-Control': cc,
    'X-Cache': 'MISS',
    'X-Kunci': key,
  };

  if (upstream.status === 200) {
    registerIndex(pathname, upstream);
    if (indexable(upstream)) {
      cache.set(key, { status: upstream.status, headers: outHeaders, body, storedAt: Date.now() });
    }
  }

  respond(upstream.status, { ...outHeaders, 'Content-Length': body.length }, body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  const respond = (status, headers, body) => {
    res.writeHead(status, headers);
    res.end(body);
  };

  if (pathname === '/health') {
    return respond(200, { 'Content-Type': 'application/json' },
      JSON.stringify({ ok: true, cached: cache.size, indexed: index.size }));
  }

  if (pathname === '/arsip') {
    const presented = req.headers['x-index'];
    const entry = typeof presented === 'string' ? index.get(presented) : null;
    // Gerbang cuma kebuka buat digest dokumen internal.
    const unlocked = Boolean(entry && entry.sifat === 'internal');

    const passthrough = unlocked ? { 'X-Index': 'terdaftar' } : {};
    let upstream;
    try {
      upstream = await fetchOrigin('/arsip', passthrough);
    } catch (e) {
      return respond(502, { 'Content-Type': 'text/plain' }, `origin error: ${e.message}`);
    }
    const text = await upstream.text();

    return respond(upstream.status, {
      'Content-Type': 'application/json; charset=utf-8',
      ...(unlocked ? {} : { 'X-Dial': 'ditolak' }),
    }, text);
  }

  if (pathname.startsWith('/dokumen/')) {
    // Id numerik (dokumen internal) hanya boleh lewat kalau request
    // berbentuk aset statis. Ini celah konfigurasi yang disengaja.
    if (INTERNAL_ROUTE.test(pathname) && !STATIC_EXT.test(pathname)) {
      return respond(403, { 'Content-Type': 'application/json; charset=utf-8' },
        JSON.stringify({ galat: 'dokumen internal nggak dibuka lewat gateway' }));
    }
    return fetchAndMaybeCache(req, pathname, respond);
  }

  const upstream = await fetchOriginUrl(pathname + url.search, req.headers);
  const body = Buffer.from(await upstream.arrayBuffer());
  return respond(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') ?? 'text/html; charset=utf-8',
  }, body);
});

server.listen(PORT, '0.0.0.0', async () => {
  for (const id of PUBLIC_DOCS) {
    try {
      const key = keyFor('GET', `/dokumen/${id}`);
      const upstream = await fetchOrigin(`/dokumen/${id}`, {});
      const body = Buffer.from(await upstream.arrayBuffer());
      const repr = upstream.headers.get('repr-digest');
      const content = upstream.headers.get('content-digest');
      const sifat = upstream.headers.get('x-sifat');
      if (repr) index.set(repr, { pathname: `/dokumen/${id}`, sifat });
      if (content) index.set(content, { pathname: `/dokumen/${id}`, sifat });
      cache.set(key, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json',
          'Repr-Digest': repr ?? '',
          'Content-Digest': content ?? '',
          'X-Sifat': sifat ?? '',
          'Cache-Control': upstream.headers.get('cache-control') ?? '',
        },
        body,
        storedAt: Date.now(),
      });
    } catch (e) {
      console.error(`seed gagal ${id}: ${e.message}`);
    }
  }
  console.log(`gateway di http://0.0.0.0:${PORT}, index ${index.size} entri`);
});