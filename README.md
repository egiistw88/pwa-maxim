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

## PWA Install & Offline Test

### Cara install PWA
1. Jalankan aplikasi lalu buka di browser Chrome/Edge.
2. Klik tombol **Install** pada address bar atau menu browser.
3. Pilih **Install** untuk menambahkan ke homescreen/desktop.

### Cara uji offline
1. Buka `/heatmap` dan `/wallet` saat online (agar shell + cache terisi).
2. Matikan koneksi internet.
3. Reload halaman — app tetap menampilkan shell offline dan data Dexie tetap terbaca.
4. Jika update tersedia, akan muncul banner **Update tersedia** untuk reload.
