# Formosa — Aplikasi Pembelajaran Bahasa Mandarin

Formosa adalah aplikasi web pembelajaran bahasa Mandarin dengan tiga peran: admin, guru, dan murid. Aplikasi menyediakan flashcard, latihan menulis, menyimak, berbicara, dan membaca, assessment, progres belajar, bintang, serta aksesori maskot.

## Teknologi

Angular 20, TypeScript, SCSS, Firebase Authentication, Cloud Firestore, Node.js, Firebase Admin SDK, Cloudinary, dan Hanzi Writer.

## Hak akses

| Peran | Fungsi utama |
| --- | --- |
| Admin | Mengelola akun, pendaftaran, materi, aksesori, dan laporan. |
| Guru | Mengelola materi sesuai akses, memantau murid, dan melihat laporan serta poin. |
| Murid | Mempelajari materi, mengerjakan latihan dan assessment, melihat progres, dan menggunakan aksesori. |

Admin dapat menghapus akun permanen melalui backend, tetapi tidak dapat mengganti atau mereset kata sandi pengguna lain. Pemilik akun dapat meminta tautan pemulihan kata sandi melalui email dari halaman login.

## Persyaratan

- Node.js 22.12 atau lebih baru pada seri 22, atau Node.js seri 24.
- npm; pengembangan proyek menggunakan npm 11.
- Proyek Firebase dengan Authentication metode Email/Password dan Cloud Firestore aktif.
- Kredensial Firebase Admin untuk backend, diberikan terpisah dari repositori.
- Koneksi internet untuk layanan Firebase dan media eksternal.

## Instalasi

```bash
git clone https://github.com/Callista1409/ta-aplikasi-pembelajaran-formosa.git
cd ta-aplikasi-pembelajaran-formosa
npm ci
npm ci --prefix admin-backend
```

Terdapat dua lockfile dependency: satu untuk frontend dan skrip pengembangan, satu untuk backend mandiri. Jalankan kedua instalasi di atas.

## Konfigurasi frontend

Sesuaikan bagian `firebase` dan `cloudinary` pada:

- `src/environments/environment.ts`: pengembangan lokal.
- `src/environments/environment.production.ts`: build produksi.

Konfigurasi web Firebase adalah pengenal aplikasi klien. Perlindungan data bergantung pada Authentication, Firestore Rules, dan otorisasi backend. Jangan memasukkan private key atau service account ke frontend. Gunakan proyek Firebase dan akun Cloudinary sendiri jika menjalankan instalasi terpisah.

Backend lokal menggunakan `http://127.0.0.1:5055`; build produksi menggunakan `/api`. Sesuaikan Cloudinary `cloudName`, `uploadPreset`, dan `folder` dengan konfigurasi akun tujuan.

## Konfigurasi backend

`.env.example` menjelaskan variabel yang didukung. Backend tidak memuat berkas `.env` otomatis; atur variabel pada terminal atau lingkungan hosting.

Contoh PowerShell, menggunakan path absolut service account dari proyek Firebase yang sama dengan frontend:

```powershell
$env:FIREBASE_SERVICE_ACCOUNT = 'D:\kredensial\firebase-service-account.json'
$env:ALLOWED_ORIGINS = 'http://localhost:4200,http://127.0.0.1:4200'
npm run admin:api
```

Alternatifnya, isi `FIREBASE_SERVICE_ACCOUNT_JSON` dengan JSON service account lengkap. Variabel ini wajib tersedia pada hosting Vercel. Kredensial tidak disertakan dalam repositori.

Instalasi dependency tidak membuat akun dan materi secara otomatis. Untuk meninjau aplikasi yang sudah terisi, gunakan akun uji yang diberikan pengelola secara terpisah. Proyek Firebase baru memerlukan penyiapan data dan peran akun. Skrip seed, impor, dan migrasi tersedia di `scripts/`; tinjau isi dan target proyek sebelum menjalankannya karena dapat mengubah data.

## Menjalankan aplikasi

Buka dua terminal pada direktori proyek. Terminal pertama, setelah mengatur kredensial backend:

```bash
npm run admin:api
```

Terminal kedua:

```bash
npm start
```

Buka `http://localhost:4200`. Halaman awal adalah login; pengguna kemudian diarahkan sesuai peran ke `/admin`, `/teacher`, atau `/student`. Backend berjalan pada port 5055 dan menyediakan operasi akun, ringkasan laporan, serta transaksi belajar murid.

Fitur mikrofon memerlukan izin browser. Ketersediaan suara Mandarin dan pengenalan suara bergantung pada browser, perangkat, dan layanan suara.

## Build dan pengujian

```bash
npm run build
npm run test:unit
npm test -- --watch=false --browsers=ChromeHeadless
```

Build produksi tersimpan di `dist/frontend-angular/browser/`. Tahap `prebuild` menghasilkan modul `admin-backend/student-curriculum/` dari sumber TypeScript. Edit kurikulum di `src/app/core/content/`, kemudian jalankan build untuk memperbarui modul hasilnya.

`test:unit` menjalankan pengujian Node tanpa emulator dan tanpa kredensial produksi. Pengujian Angular memerlukan Chrome/Chromium; atur `CHROME_BIN` bila browser tidak ditemukan otomatis.

Pengujian aturan Firestore terpisah dan memerlukan Firebase CLI serta Java yang kompatibel dengan emulator:

```bash
npm run test:rules:emulator
```

Pengujian integrasi backend tersedia pada `admin-backend/*-emulator.test.mjs`. Jalankan dengan emulator Firestore aktif pada `127.0.0.1:8182` dan variabel `FIRESTORE_EMULATOR_HOST` yang sesuai. Jangan gunakan kredensial atau data produksi untuk pengujian emulator.

## Struktur kode

```text
src/app/core/       Autentikasi, guards, model, layanan data, dan kurikulum
src/app/features/   Halaman per peran, autentikasi, dan pengelolaan konten
src/app/layout/     Layout dan navigasi bersama
src/app/shared/     Komponen lintas halaman
src/environments/  Konfigurasi layanan lokal dan produksi
public/            Gambar, audio, dan aset statis
admin-backend/     HTTP API, otorisasi, operasi data, dan pengujian backend
api/               Handler API untuk hosting
server/            Server lokal dan proxy API
scripts/           Build, pengujian, seed, impor, dan migrasi
scripts/data/      Data kurikulum dan CSV kosakata untuk skrip
```

## Aturan data dan hosting

Aturan akses tersedia di `firestore.rules`; indeks laporan berada di `firestore.dashboard.indexes.json`. Frontend, backend, dan rules harus menggunakan versi yang kompatibel.

```bash
node scripts/deploy-dashboard-indexes.mjs
```

Perintah tersebut menampilkan rencana indeks. Tambahkan `--apply` untuk membuat indeks yang belum tersedia, kemudian tunggu hingga READY. `npm run deploy:rules` menerapkan rules dengan kredensial yang memiliki izin sesuai.

`vercel.json` mendefinisikan layanan Angular di root proyek dan layanan Node di `admin-backend/`. Permintaan `/api/*` diarahkan ke backend; navigasi frontend menggunakan fallback `index.html`. Atur `FIREBASE_SERVICE_ACCOUNT_JSON` dan `ALLOWED_ORIGINS` pada hosting, lalu tambahkan domain aplikasi ke Authorized Domains Firebase Authentication. Deployment rules dan indeks terpisah dari deployment web. Uji konfigurasi pada hosting tujuan sebelum digunakan pengguna.
