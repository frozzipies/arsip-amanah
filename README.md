# Arsip Amanah

Kategori: Web
Kesulitan: Hard/Insane
Flag: `REDLIMIT{...}`

## Deskripsi

Unit arsip nyimpen sidik jari tiap dokumen, biar gateway bisa nyari cepat dan
tahu dokumen mana yang udah pernah masuk. Format sidik jarinya ikut RFC 9530.

Ada satu dokumen yang nggak masuk daftar publik. Gerbang arsip cuma mau kebuka
kalo kamu punya sidik jari dokumen itu. Yang punya akses ke dokumen internal
yang baru bisa buka.

## Menjalankan

```bash
docker compose up --build
```

Buka `http://localhost:8080`.

Flag default ada di `docker-compose.yml`. Ganti lewat environment kalau mau:

```bash
FLAG='REDLIMIT{yang_kamu_mau}' docker compose up --build
```

## Petunjuk

- Header `X-Kunci` di response ngasih tau gimana gateway nyusun cache key.
- `/nonce` itu bukan hiasan, dan bukan leak biasa.
- Gateway nurut sama `Want-Repr-Digest`. Kamu yang pilih algoritmanya.

Kalau mentok, ping admin buat hint. Jangan buru-buru publish jawaban.