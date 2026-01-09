# pwa-maxim

## Cara pakai (MVP)

### Heatmap
1. Buka `/heatmap` untuk melihat peta Bandung.
2. Pilih wilayah (Timur/Tengah/Utara/Selatan/Barat) lalu klik **Fit to area** bila perlu.
3. Aktifkan layer heatmap internal, POI, dan rain risk sesuai kebutuhan.
4. Klik **Refresh Sinyal** untuk mengambil data POI + cuaca (hasil disimpan offline selama 6 jam).
5. Input trip manual di bagian **Input Trip Manual** untuk mengisi heatmap internal.

### Dompet
1. Buka `/wallet`.
2. Isi form transaksi (jenis, jumlah, kategori, tanggal, catatan).
3. Lihat ringkasan harian dan 7 hari terakhir, plus daftar transaksi terbaru.

Semua data disimpan local-first di IndexedDB sehingga tetap tersedia saat offline.

## Catatan teknis
- Karena environment npm diblok proxy, Leaflet dimuat via CDN (`unpkg.com`) tanpa dependency npm.
- Jika registry npm kembali normal, implementasi dapat dimigrasikan ke MapLibre/H3/Dexie sesuai rencana awal.
