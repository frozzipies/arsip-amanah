const http = require('http');

const PORT = Number(process.env.PORT || 5000);
const FLAG = process.env.FLAG;
if (!FLAG) {
  console.error('FLAG env var wajib diisi');
  process.exit(1);
}

const UPPER = 0x80000000;
const LOWER = 0x7fffffff;
const MATRIX = 0x9908b0df;
const N = 624;
const M = 397;

class MT19937 {
  constructor(seed) {
    this.mt = new Uint32Array(N);
    this.idx = N;
    this.mt[0] = seed >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = this.mt[i - 1];
      this.mt[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
  }

  twist() {
    for (let i = 0; i < N; i++) {
      const y = (this.mt[i] & UPPER) | (this.mt[(i + 1) % N] & LOWER);
      let v = this.mt[(i + M) % N] ^ (y >>> 1);
      if (y & 1) v ^= MATRIX;
      this.mt[i] = v >>> 0;
    }
    this.idx = 0;
  }

  next() {
    if (this.idx >= N) this.twist();
    let y = this.mt[this.idx++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }
}

const mt = new MT19937((Date.now() ^ (process.pid << 16)) >>> 0);

const LEAK = [];
for (let i = 0; i < N; i++) LEAK.push(mt.next());

const SECRET_ID = 100000000 + (mt.next() % 900000000);

const DOKUMEN = {
  'nota-pengajuan': {
    judul: 'Pengajuan Dana Operasional Q3',
    isi: 'Total yang diminta 48.750.000 untuk penggantian alat lab.',
    sifat: 'publik',
  },
  'nota-rapat': {
    judul: 'Notulen Rapat Koordinasi',
    isi: 'Pembagian tugas sudah final. Tidak ada perubahan.',
    sifat: 'publik',
  },
  'nota-legal': {
    judul: 'Dokumen Legal Vendor',
    isi: 'Kontrak framework sudah ditandatangani kedua pihak.',
    sifat: 'publik',
  },
  [SECRET_ID]: {
    judul: 'Memo Direksi — Rahasia',
    isi: 'Catatan internal yang nggak boleh keluar dari arsip.',
    sifat: 'internal',
  },
};

const ALGO = {
  'sha-256': 'sha256',
  'sha-512': 'sha512',
  md5: 'md5',
};
const DEFAULT = 'sha-256';

function parsePref(header) {
  if (!header) return {};
  const out = {};
  for (const part of header.split(',')) {
    const seg = part.trim();
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    const name = seg.slice(0, eq).trim().toLowerCase();
    const val = seg.slice(eq + 1).trim();
    if (!(name in ALGO)) continue;
    const n = parseInt(val, 10);
    if (!Number.isInteger(n) || n < 0 || n > 10) continue;
    out[name] = n;
  }
  return out;
}

function pilihAlgo(header) {
  const pref = parsePref(header);
  const names = Object.keys(pref);
  if (!names.length) return DEFAULT;
  const ok = names.filter((k) => pref[k] > 0);
  if (!ok.length) return DEFAULT;
  return ok.sort((a, b) => pref[b] - pref[a] || rank(b) - rank(a))[0];
}

function rank(a) {
  if (a === 'sha-512') return 2;
  if (a === 'sha-256') return 1;
  return 0;
}

function digest(body, algo) {
  const crypto = require('crypto');
  return `${algo}=:${crypto.createHash(ALGO[algo]).update(body).digest('base64')}:`;
}

function send(res, status, headers, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function json(res, status, obj, headers = {}) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    JSON.stringify(obj, null, 2));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rawPath = decodeURIComponent(url.pathname);

  if (rawPath === '/health') return json(res, 200, { ok: true });

  if (rawPath === '/nonce') {
    const n = parseInt(url.searchParams.get('n') || '0', 10);
    if (!Number.isInteger(n) || n < 0 || n >= LEAK.length) {
      return json(res, 400, { galat: 'n di luar rentang' });
    }
    return json(res, 200, { n, v: LEAK[n] }, { 'Cache-Control': 'no-store' });
  }

  if (rawPath === '/dokumen') {
    const ids = Object.keys(DOKUMEN).filter((k) => DOKUMEN[k].sifat === 'publik');
    return json(res, 200, {
      jumlah: ids.length,
      dokumen: ids.map((id) => ({
        id,
        judul: DOKUMEN[id].judul,
        sifat: DOKUMEN[id].sifat,
        tautan: `/dokumen/${id}`,
      })),
    });
  }

  if (rawPath === '/arsip') {
    if (req.headers['x-index'] !== 'terdaftar') {
      return json(res, 403, {
        galat: 'arsip terkunci',
        butuh: 'header X-Index nilainya terdaftar',
      });
    }
    return json(res, 200, { lokasi: 'arsip', isi: FLAG });
  }

  if (rawPath.startsWith('/dokumen/')) {
    let id = rawPath.slice('/dokumen/'.length);
    const semi = id.indexOf(';');
    if (semi >= 0) id = id.slice(0, semi);

    const doc = DOKUMEN[id];
    if (!doc) {
      return json(res, 404, {
        type: 'https://arsip.amanah/kendala/tidak-ada',
        title: 'Dokumen tidak ada',
        status: 404,
      });
    }

    const body = Buffer.from(
      JSON.stringify({ id, judul: doc.judul, isi: doc.isi, sifat: doc.sifat }, null, 2) + '\n',
      'utf8'
    );
    const algo = pilihAlgo(req.headers['want-repr-digest']);

    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Repr-Digest': digest(body, algo),
      'Content-Digest': digest(body, 'sha-256'),
      'X-Algoritma-Digest': algo,
      'X-Sifat': doc.sifat,
      'ETag': `W/"${id}"`,
    };
    headers['Cache-Control'] = doc.sifat === 'internal'
      ? 'private, no-store'
      : 'public, max-age=300';

    res.writeHead(200, { ...headers, 'Content-Length': body.length });
    return res.end(body);
  }

  if (rawPath === '/') {
    return send(res, 200, {}, LANDING);
  }

  return json(res, 404, {
    type: 'https://arsip.amanah/kendala/tidak-ada',
    title: 'Tidak ada',
    status: 404,
  });
});

const LANDING = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arsip Amanah</title>
<style>
:root {
  --ink: #1a1a1d;
  --sub: #55555b;
  --muted: #77777e;
  --rule: #e2e2df;
  --rule-soft: #eeedea;
  --accent: #7a1f28;
  --paper: #ffffff;
  --bg: #f7f7f5;
  --code-bg: #f4f4f2;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.65 var(--sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.wrap { max-width: 700px; margin: 0 auto; padding: 0 22px; }

.masthead {
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
}
.masthead .wrap {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding-top: 14px;
  padding-bottom: 14px;
}
.brand {
  font: 600 13px/1 var(--mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.brand span { color: var(--accent); }
.stamp {
  font: 11px/1 var(--mono);
  letter-spacing: 0.06em;
  color: var(--muted);
  text-transform: uppercase;
}

main { padding: 44px 0 88px; }
h1 {
  font-size: 30px;
  line-height: 1.18;
  letter-spacing: -0.021em;
  font-weight: 650;
  margin: 0 0 14px;
}
.dek {
  font-size: 18px;
  line-height: 1.55;
  color: var(--sub);
  margin: 0 0 34px;
  max-width: 60ch;
}
h2 {
  font: 600 11px/1.5 var(--mono);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 52px 0 16px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--rule-soft);
}
p { margin: 0 0 16px; }
a { color: var(--ink); text-underline-offset: 3px; }
a:hover { color: var(--accent); }

table { width: 100%; border-collapse: collapse; }
th {
  font: 600 10.5px/1.5 var(--mono);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
  text-align: left;
  padding: 0 14px 8px 0;
}
td {
  padding: 11px 14px 11px 0;
  border-top: 1px solid var(--rule-soft);
  vertical-align: top;
}
td.idl {
  font: 12.5px/1.5 var(--mono);
  color: var(--sub);
  white-space: nowrap;
}
code, kbd {
  font-family: var(--mono);
  font-size: 0.9em;
  background: var(--code-bg);
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: 1px 5px;
}
pre {
  font: 13.5px/1.6 var(--mono);
  background: var(--code-bg);
  border: 1px solid var(--rule);
  padding: 14px 16px;
  overflow-x: auto;
  margin: 0 0 16px;
}
pre code { background: none; border: 0; padding: 0; }

.note {
  border-left: 3px solid var(--accent);
  padding: 2px 0 2px 16px;
  margin: 0 0 20px;
  color: var(--sub);
}
.colophon {
  margin-top: 64px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
  font: 11px/1.7 var(--mono);
  letter-spacing: 0.03em;
  color: var(--muted);
}

@media (max-width: 560px) {
  .wrap { padding: 0 16px; }
  main { padding: 32px 0 64px; }
  h1 { font-size: 25px; }
  .dek { font-size: 17px; }
  .masthead .stamp { display: none; }
  th.sifat, td.sifat { display: none; }
}
</style>
</head>
<body>

<header class="masthead">
  <div class="wrap">
    <div class="brand">Arsip <span>Amanah</span></div>
    <div class="stamp">Unit Arsip &middot; Triwulan III</div>
  </div>
</header>

<main class="wrap">
  <h1>Dokumen yang diawasi</h1>
  <p class="dek">Tiap dokumen di sini ada sidik jarinya. Gateway pakai itu buat nyari
  cepet, dan buat tahu dokumen mana yang udah pernah masuk. Aturan arsip berdiri
  sendiri, bukan bagian halaman ini.</p>

  <h2>Dokumen tersedia</h2>
  <table>
    <thead>
      <tr><th>ID</th><th>Judul</th><th class="sifat">Sifat</th></tr>
    </thead>
    <tbody>
      <tr><td class="idl">nota-pengajuan</td><td>Pengajuan Dana Operasional</td><td class="sifat">publik</td></tr>
      <tr><td class="idl">nota-rapat</td><td>Notulen Rapat Koordinasi</td><td class="sifat">publik</td></tr>
      <tr><td class="idl">nota-legal</td><td>Dokumen Legal Vendor</td><td class="sifat">publik</td></tr>
    </tbody>
  </table>

  <div class="note">
    <p>Ada satu dokumen yang nggak masuk daftar di atas. Cara nemuinnya ada di catatan
    gateway.</p>
  </div>

  <h2>Catatan teknis</h2>
  <p>Gateway nentuin cache dari kunci <code>method</code> + <code>pathname</code>. Query
  string nggak ikut, header lain juga nggak.</p>

  <p>Sidik jarinya dihitung sesuai <code>RFC 9530</code>. Kalau mau algoritma tertentu,
  kirim <code>Want-Repr-Digest</code>. Nilainya cuma saran, tapi gateway tetap nurut.</p>

  <h2>Aturan arsip</h2>
  <p>Gateway cuma meneruskan <code>X-Index: terdaftar</code> ke <code>/arsip</code>.
  Yang nulis nilai itu gateway, bukan pemakainya.</p>

  <div class="colophon">
    REDLIMIT CTF &middot; kategori Web<br>
    sidik jari: RFC 9530 &middot; caching: RFC 9111
  </div>
</main>

</body>
</html>`;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`arsip backend di http://0.0.0.0:${PORT}`);
});