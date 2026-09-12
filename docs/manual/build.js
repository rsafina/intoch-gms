const fs = require('fs');
const d = require('docx');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TableOfContents,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, PageBreak,
  LevelFormat, Footer, PageNumber, convertInchesToTwip,
} = d;

const INK = '1F3864';
const ACC = '9F6404';
const GREY = '595959';

let stepInstance = 0;

const spacer = (after = 200) => new Paragraph({ spacing: { after }, children: [] });

// ── helpers ────────────────────────────────────────────────────────────
const P = (text, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 120, line: 276 },
  alignment: opts.align,
  children: [new TextRun({ text, size: opts.size ?? 21, color: opts.color, bold: opts.bold, italics: opts.italics })],
});

const rich = (runs, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 120, line: 276 },
  children: runs.map(r => typeof r === 'string'
    ? new TextRun({ text: r, size: 21 })
    : new TextRun({ size: 21, ...r })),
});

const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, pageBreakBefore: true,
  spacing: { before: 0, after: 200 },
  children: [new TextRun({ text, size: 32, bold: true, color: INK })],
});

const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 280, after: 140 },
  children: [new TextRun({ text, size: 25, bold: true, color: INK })],
});

const H3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 220, after: 100 },
  children: [new TextRun({ text, size: 22, bold: true, color: ACC })],
});

const steps = (items, instance) => items.map((t, i) => new Paragraph({
  numbering: { reference: 'steps', level: 0, instance },
  spacing: { after: 90, line: 276 },
  children: [new TextRun({ text: t, size: 21 })],
}));

const proc = (items) => { stepInstance += 1; return steps(items, stepInstance); };

const bullets = (items) => items.map(t => new Paragraph({
  numbering: { reference: 'dots', level: 0 },
  spacing: { after: 80, line: 276 },
  children: [new TextRun({ text: t, size: 21 })],
}));

// Shaded single-cell callout box
const box = (title, lines, fill = 'F4F1EA', bar = ACC) => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [9360],
  borders: {
    top: { style: BorderStyle.SINGLE, size: 2, color: fill },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: fill },
    right: { style: BorderStyle.SINGLE, size: 2, color: fill },
    left: { style: BorderStyle.SINGLE, size: 18, color: bar },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  },
  rows: [new TableRow({
    cantSplit: true,
    children: [new TableCell({
      width: { size: 9360, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
      margins: { top: 140, bottom: 140, left: 200, right: 200 },
      children: [
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: title, size: 19, bold: true, color: bar, allCaps: true })],
        }),
        ...lines.map((l, i) => new Paragraph({
          spacing: { after: i === lines.length - 1 ? 0 : 80, line: 276 },
          children: [new TextRun({ text: l, size: 20 })],
        })),
      ],
    })],
  })],
});

// Each callout is followed by its own spacer so two in a row do not fuse
// into one block, which read as a single box with two headings.
const why = (lines) => [box('Kenapa begitu', lines), spacer(160)];
const warn = (lines) => [box('Hati-hati', lines, 'FBEEE9', 'C0392B'), spacer(160)];
const esc = (lines) => [box('Kapan harus naik ke manager', lines, 'EAF1F6', '1F6FA8'), spacer(160)];

const table = (header, rows, widths) => {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (text, { bold, fill, align } = {}) => (w) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    children: [new Paragraph({
      alignment: align,
      spacing: { after: 0, line: 264 },
      children: [new TextRun({ text, size: 19, bold, color: bold ? INK : undefined })],
    })],
  });
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'D8D2C8' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D8D2C8' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'D8D2C8' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'D8D2C8' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E6E1D8' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E6E1D8' },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: header.map((h, i) => cell(h, { bold: true, fill: 'F4F1EA' })(widths[i])),
      }),
      // A row broken across a page boundary leaves a fragment with empty
      // cells under a repeated header, which reads as a data error.
      ...rows.map(r => new TableRow({
        cantSplit: true,
        children: r.map((c, i) => cell(c)(widths[i])),
      })),
    ],
  });
};


// Static, so the list is readable in a printed copy too. A Word TOC field
// shows an empty page until somebody right-clicks and updates it.
const tocEntries = [
  ['0. Sebelum Mulai', '3'],
  ['1. Login dan Peran Pengguna', '4'],
  ['2. Walk-In dengan "Quick Walk-In"', '6'],
  ['3. Walk-In dengan Tombol "Walk-In"', '8'],
  ['4. Menyelesaikan Walk-In: Tombol "Complete"', '10'],
  ['5. Reservasi dari Dashboard / oleh Staf', '11'],
  ['6. Reservasi Online yang Membutuhkan Deposit', '14'],
  ['7. Reservasi Online Tanpa Deposit', '15'],
  ['8. Reservasi Online Party Besar yang Perlu Dibicarakan', '16'],
  ['9. Follow Up Reservasi dengan DP: Party Kecil', '18'],
  ['10. Follow Up Reservasi dengan DP: Party Besar', '21'],
  ['Lampiran A. Pesan yang Sering Muncul dan Artinya', '23'],
  ['Lampiran B. Daftar Periksa Harian', '24'],
];

// ── content ────────────────────────────────────────────────────────────
const body = [];

// Cover
body.push(
  new Paragraph({ spacing: { before: 2600, after: 0 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'INTOCH', size: 56, bold: true, color: INK, characterSpacing: 60 })] }),
  new Paragraph({ spacing: { before: 120, after: 600 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Guest Management System', size: 24, color: ACC, allCaps: true, characterSpacing: 40 })] }),
  new Paragraph({ spacing: { after: 160 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Manual Pelatihan Staf', size: 40, bold: true, color: INK })] }),
  new Paragraph({ spacing: { after: 1000 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Login, walk-in, reservasi, dan penanganan deposit', size: 24, color: GREY })] }),
  new Paragraph({ spacing: { after: 60 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Versi 1.0  ·  12 September 2026', size: 20, color: GREY })] }),
  new Paragraph({ spacing: { after: 0 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Dokumen internal. Mohon tidak dibagikan ke luar restoran.', size: 19, color: GREY, italics: true })] }),
);

// TOC
body.push(
  new Paragraph({ pageBreakBefore: true, spacing: { after: 240 },
    children: [new TextRun({ text: 'Daftar Isi', size: 32, bold: true, color: INK })] }),
  ...tocEntries.map(([label, page]) => new Paragraph({
    spacing: { after: 110, line: 276 },
    tabStops: [{ type: 'right', position: 9000, leader: 'dot' }],
    children: [
      new TextRun({ text: label, size: 21 }),
      new TextRun({ text: '\t' + page, size: 21 }),
    ],
  })),
  new Paragraph({ spacing: { before: 420, after: 0 },
    children: [new TextRun({ text: 'Nomor halaman mengacu pada dokumen ini saat dicetak apa adanya.', size: 18, italics: true, color: GREY })] }),
);

// ═══ BAB 0 ═══
body.push(H1('0. Sebelum Mulai'));
body.push(P('Manual ini dipakai untuk pelatihan staf front office, finance, dan manager. Setiap bagian berisi langkah yang harus dilakukan, alasan di balik aturannya, kasus sulit yang sering terjadi, dan kapan sebuah masalah harus dinaikkan ke manager.'));
body.push(P('Tombol dan label di aplikasi sebagian masih berbahasa Inggris. Di manual ini label tersebut ditulis apa adanya, di dalam tanda kutip, supaya mudah dicari di layar. Contoh: tombol "Record payment".'));

body.push(H2('0.1 Dua hal yang perlu dipahami lebih dulu'));
body.push(H3('Yang mencatat kunjungan adalah baris visit, bukan status reservasi'));
body.push(P('Setiap kali tamu benar-benar datang, sistem menulis satu baris kunjungan (visit). Baris itulah yang menjadi dasar semua laporan: total pax, omzet, riwayat tamu, tier spending, dan sticker membership.'));
body.push(...why([
  'Status "Completed" pada reservasi hanya berarti ada orang yang menandai baris itu selesai. Di restoran sebelumnya, 15 reservasi ditandai Completed padahal tamunya tidak pernah datang, 91 pax, semuanya ditekan antara jam 16:00 dan 21:30 saat staf merapikan board di akhir shift.',
  'Karena itu aplikasi sekarang BERTANYA "apakah tamu ini datang?" jika tidak ada baris kunjungan. Jangan pernah menebak. Lihat bagian 4 dan 5.',
]));

body.push(H3('Status reservasi dan artinya'));
body.push(spacer(100));
body.push(table(
  ['Status', 'Arti', 'Meja ditahan?'],
  [
    ['Incoming', 'Menunggu deposit. Dibuat otomatis ketika reservasi butuh DP.', 'Ya'],
    ['Waitlist', 'Permintaan yang belum diputuskan staf. Party terlalu besar, terlalu kecil, atau area penuh.', 'TIDAK'],
    ['Reserved', 'Sudah pasti. Meja aman.', 'Ya'],
    ['Arrived', 'Tamu sudah datang. Baris kunjungan dibuat pada saat ini.', 'Ya'],
    ['Completed', 'Kunjungan selesai dan spend sudah dicatat.', 'Tidak lagi'],
    ['Cancelled', 'Tamu membatalkan.', 'Tidak'],
    ['Cancelled (No Show)', 'Tamu tidak datang tanpa membatalkan.', 'Tidak'],
  ],
  [1700, 6060, 1600],
));
body.push(spacer(160));
body.push(...warn([
  'Waitlist TIDAK menahan meja. Selama sebuah permintaan masih Waitlist, meja yang sama masih bisa diambil reservasi lain. Inilah sebabnya permintaan party besar harus ditindaklanjuti cepat, bukan ditunda sampai besok.',
]));

// ═══ BAB 1 ═══
body.push(H1('1. Login dan Peran Pengguna'));

body.push(H2('1.1 Cara login'));
body.push(...proc([
  'Buka aplikasi Intoch di browser front desk.',
  'Masukkan Username (huruf kecil, tanpa spasi) pada kolom pertama.',
  'Masukkan PIN 4 angka pada kolom kedua.',
  'Tekan Enter atau klik tombol login.',
]));
body.push(P('Jika username atau PIN salah, muncul pesan error di bawah kolom. Tidak ada keterangan mana yang salah, itu memang disengaja.'));
body.push(...why([
  'Sejak 11 September 2026, login tidak lagi hanya pengecekan di aplikasi. Username dan PIN sekarang ditukar menjadi identitas resmi di database, sehingga database tahu siapa yang sedang bekerja dan menolak sendiri tindakan yang tidak boleh dilakukan peran tersebut.',
  'Akibatnya: menyembunyikan menu bukan lagi satu-satunya pengaman. Walaupun seseorang memaksa membuka halaman yang bukan haknya, database tetap menolak penyimpanan datanya.',
]));
body.push(...warn([
  'PIN hanya 4 angka. Jangan pakai 0000, 1111, 1234, atau tanggal lahir. Jangan berbagi PIN antar staf: semua perubahan data dicatat atas nama pemilik PIN yang login, termasuk pembebasan deposit dan void kunjungan.',
  'Setelah aplikasi diperbarui (deploy), semua orang wajib login ulang. Sesi lama sengaja ditolak.',
]));

body.push(H2('1.2 Empat peran dan apa yang bisa dilakukan'));
body.push(spacer(100));
body.push(table(
  ['Peran', 'Halaman yang terlihat', 'Yang bisa dilakukan', 'Yang tidak bisa'],
  [
    ['Owner', 'Dashboard dan Reports saja', 'Melihat ringkasan dan laporan', 'Semua penyimpanan data. Owner sepenuhnya hanya membaca.'],
    ['Admin', 'Semua halaman, termasuk Settings > Staff', 'Semua pekerjaan operasional, membuat dan menonaktifkan akun staf, reset PIN, mengubah rekening bank dan QRIS, semua pengaturan', 'Tidak ada batasan di dalam aplikasi'],
    ['Manager', 'Semua halaman operasional dan Settings kecuali Staff', 'Operasional harian, membebaskan deposit, void kunjungan, hapus reservasi, invoice umum dan settlement, Prizes, Thresholds, Branding', 'Membuat atau mengubah akun staf, mengubah rekening bank atau QRIS'],
    ['Staff (FO / Finance)', 'Dashboard, Reservations, Walk-Ins, Membership, Guests. Areas dan Reservation Form bisa dilihat saja', 'Operasional harian, invoice deposit, mencatat pembayaran masuk, menerbitkan tiket', 'Void kunjungan, hapus reservasi, penyesuaian pembayaran negatif, invoice umum dan settlement, mengubah instruksi pembayaran. Membebaskan deposit hanya jika diizinkan khusus'],
  ],
  [1500, 2100, 3500, 2260],
));
body.push(spacer(160));

body.push(H3('Izin khusus: "Can waive deposits"'));
body.push(P('Secara bawaan, seorang Staff tidak boleh membebaskan deposit. Admin dapat mengizinkannya per orang melalui Settings > Staff > Edit Staff, dengan mencentang "Can waive deposits". Pilihan ini hanya muncul jika peran yang dipilih adalah Staff.'));
body.push(...bullets([
  'Staf baru selalu dibuat dengan izin ini mati.',
  'Manager dan Admin selalu boleh membebaskan deposit, tanpa perlu dicentang.',
  'Owner tetap tidak boleh, apa pun yang dicentang.',
  'Izin dibaca ulang dari database setiap kali tombol pembebasan dibuka. Mencabut izin langsung berlaku, tanpa perlu menunggu staf logout.',
]));

body.push(H3('Aturan yang tidak bisa dilanggar siapa pun'));
body.push(...bullets([
  'Tidak boleh ada nol Admin aktif. Sistem menolak menonaktifkan atau menurunkan Admin terakhir.',
  'Seseorang tidak bisa mengubah perannya sendiri.',
  'PIN tidak bisa dibaca oleh siapa pun, termasuk Admin. PIN hanya bisa diganti, tidak bisa dilihat.',
  'Semua perubahan pada akun, pengaturan, pembayaran, reservasi, dan kunjungan dicatat dalam log yang tidak bisa diedit dari aplikasi.',
]));
body.push(...esc([
  'Staf tidak bisa login padahal username dan PIN sudah benar: kemungkinan akunnya dinonaktifkan, atau aplikasi baru diperbarui. Hubungi Admin.',
  'Muncul pesan "This account cannot perform this action": itu penolakan dari database, bukan kesalahan klik. Jangan dicoba berulang, mintalah manager yang mengerjakan.',
]));

// ═══ BAB 2 ═══
body.push(H1('2. Walk-In dengan "Quick Walk-In"'));
body.push(P('Quick Walk-In adalah kartu di bagian atas Dashboard, bergaris kuning di sisi kiri. Gunakan ini saat restoran sedang ramai: tujuannya secepat mengetik di spreadsheet. Detail meja, area, dan spend bisa dilengkapi belakangan.'));

body.push(H2('2.1 Langkah'));
body.push(...proc([
  'Pada kolom "Guest name", ketik nama tamu. Setelah 2 huruf, sistem menampilkan daftar tamu lama yang cocok berdasarkan nama atau nomor HP.',
  'Jika tamu sudah pernah datang, klik namanya di daftar. Nama dan nomor HP terisi otomatis dan kursor pindah ke kolom pax.',
  'Jika tamu baru, lanjutkan mengetik. Isi "Phone (optional)" bila ada nomornya.',
  'Isi jumlah pax pada kolom kecil di sebelah kanan. Nilai bawaannya 1.',
  'Tekan Enter atau klik "Add".',
]));
body.push(P('Di bawah kartu muncul baris konfirmasi, misalnya: "✓ Ibu Sinta (existing guest) — 4 pax, 19:05". Kolom otomatis kosong kembali dan kursor balik ke kolom nama, siap untuk tamu berikutnya.'));

body.push(H2('2.2 Bagaimana sistem memutuskan tamu baru atau tamu lama'));
body.push(P('Urutannya selalu sama, dari atas ke bawah:'));
body.push(...proc([
  'Jika Anda memilih nama dari daftar, tamu itu yang dipakai. Keterangannya "(existing guest)".',
  'Jika tidak memilih tapi nomor HP yang diisi sudah ada di database, tamu dengan nomor itu yang dipakai. Jika namanya berbeda dari yang Anda ketik, keterangannya menyebutkan nama aslinya, misalnya "(existing guest: Sinta Wijaya)".',
  'Jika keduanya tidak cocok, tamu baru dibuat. Keterangannya "(new guest)".',
]));
body.push(...why([
  'Nomor HP adalah penanda tamu yang paling dapat dipercaya. Nama diketik berbeda-beda setiap shift, dan banyak tamu bernama sama.',
  'Nama tamu yang Anda ketik TIDAK menimpa nama yang sudah tersimpan. Ketikan itu dipakai untuk mencari, bukan untuk mengoreksi data tamu.',
]));
body.push(...warn([
  'Kalau keterangan menyebut nama lain dari yang Anda maksud, berarti nomor HP itu milik tamu lain. Hapus nomornya, simpan tanpa nomor, lalu perbaiki dari halaman Guests setelah ramai reda.',
  'Pax boleh dilewati dan diperbaiki nanti, tapi jangan dibiarkan salah sampai akhir shift: laporan pax harian diambil dari angka ini.',
]));

body.push(H2('2.3 Yang dicatat dan yang belum'));
body.push(spacer(100));
body.push(table(
  ['Sudah tercatat otomatis', 'Harus dilengkapi belakangan'],
  [
    ['Nama tamu, nomor HP bila diisi', 'Meja dan area'],
    ['Tanggal hari ini dan jam saat tombol ditekan', 'Jumlah spend'],
    ['Jumlah pax', 'Catatan khusus, pesanan'],
    ['Status kunjungan: Active', 'Status akhir: Done (lihat bab 4)'],
  ],
  [4680, 4680],
));
body.push(spacer(160));
body.push(P('Lengkapi sisanya dari halaman Walk-Ins dengan tombol "Edit" pada baris tamu tersebut.'));

// ═══ BAB 3 ═══
body.push(H1('3. Walk-In dengan Tombol "Walk-In"'));
body.push(P('Gunakan cara ini ketika restoran tidak sedang terburu-buru, atau ketika meja harus langsung ditetapkan. Tombolnya ada di dua tempat: di Dashboard bagian atas, dan di halaman Walk-Ins. Judul formulirnya "Register Walk-In".'));

body.push(H2('3.1 Langkah'));
body.push(...proc([
  'Klik tombol "Walk-In". Formulir terbuka dengan kursor di kolom pencarian tamu.',
  'Cari tamu dengan nama atau nomor HP. Klik hasil yang benar. Kartu identitas tamu muncul di bawah kolom pencarian, lengkap dengan lencana membership bila dia anggota.',
  'Jika tamu belum ada, isi bagian "Name" dan "Phone (optional)" pada blok tamu baru. Untuk kembali mencari tamu lama, klik "Search existing guest".',
  'Isi "Pax". Nilai bawaannya 2.',
  'Pilih meja pada pemilih meja. Meja yang sedang terpakai hari ini ditampilkan tidak bisa dipilih.',
  'Area terisi otomatis mengikuti meja yang dipilih. Isi "Area" secara manual hanya bila tamu belum diberi meja.',
  'Isi "Notes" bila ada permintaan khusus, alergi, atau keterangan untuk kitchen.',
  'Klik "Confirm Walk-In".',
]));
body.push(P('Untuk memperbaiki walk-in yang sudah tersimpan, buka halaman Walk-Ins dan klik "Edit" pada barisnya. Judul formulir berubah menjadi "Edit Walk-In" dan tombolnya menjadi "Save Changes".'));

body.push(H2('3.2 Kasus sulit'));
body.push(H3('Nomor HP sudah dipakai tamu lain'));
body.push(P('Muncul pesan: "Nomor telepon sudah terdaftar atas guest lain. Periksa kembali nomornya." Artinya nomor itu sudah melekat pada tamu lain. Periksa ulang angkanya. Jika memang benar nomor tersebut dan tamu lamanya salah, jangan dipaksa: catat walk-in tanpa nomor dan laporkan ke manager untuk digabungkan.'));

body.push(H3('Walk-in yang sudah menghasilkan sticker membership tidak bisa dipindah ke tamu lain'));
body.push(P('Jika saat mengedit Anda memilih tamu yang berbeda, dan kunjungan ini sudah pernah menghasilkan transaksi membership, penyimpanan akan ditolak dengan pesan panjang berwarna merah di dalam formulir.'));
body.push(...why([
  'Spend akan pindah ke tamu baru, tetapi sticker-nya tetap tertinggal di kartu membership tamu lama. Data keduanya jadi tidak cocok dan tidak bisa dirapikan dari aplikasi.',
  'Jika pemeriksaan membership sendiri gagal karena koneksi, aplikasi juga menolak. Lebih baik menolak daripada berisiko merusak data membership.',
]));
body.push(...esc([
  'Screenshot pesan merah tersebut dan kirim ke ops manager. Jangan membuat walk-in baru sebagai jalan pintas: spend akan terhitung dua kali.',
]));

body.push(H3('Salah input seluruhnya'));
body.push(P('Walk-in yang salah total tidak dihapus, tetapi di-void. Tombol "Void" hanya terlihat oleh Manager dan Admin, di baris walk-in pada halaman Walk-Ins.'));
body.push(...why([
  'Kunjungan yang di-void tetap tersimpan sebagai riwayat, tapi dikeluarkan dari semua laporan dan dari Broadcast. Kalau baris itu benar-benar dihapus, angka laporan bulan lalu bisa berubah tanpa jejak.',
]));

// ═══ BAB 4 ═══
body.push(H1('4. Menyelesaikan Walk-In: Tombol "Complete"'));
body.push(P('Selama tamu masih makan, walk-in berstatus Active. Saat tamu selesai dan membayar, catat spend-nya lewat tombol "Complete" pada baris walk-in, baik dari Dashboard maupun dari halaman Walk-Ins.'));

body.push(H2('4.1 Langkah'));
body.push(...proc([
  'Klik "Complete" pada baris walk-in tamu tersebut.',
  'Isi "Spend Amount (Rp)". Kolom ini WAJIB. Ketik angkanya saja, pemisah ribuan boleh diabaikan.',
  'Isi "What did they order?" bila Anda tahu pesanannya. Kolom ini opsional dan selalu mulai kosong.',
  'Centang kotak di bawahnya bila pesanan tadi ingin dijadikan menu favorit tamu. Di sebelahnya tertulis favorit yang tersimpan sekarang, supaya Anda tahu apa yang akan tergantikan.',
  'Isi "Notes" bila perlu.',
  'Klik tombol simpan di bawah. Status kunjungan berubah menjadi Done.',
]));
body.push(...why([
  'Kolom pesanan sengaja selalu kosong, tidak diisi otomatis dengan pesanan terakhir. Kalau diisi otomatis, staf yang hanya menekan simpan akan menyimpan ulang pesanan minggu lalu sebagai pesanan malam ini, dan kolom itu kehilangan arti.',
  'Spend wajib karena dari angka inilah tier spending tamu, sticker membership, dan omzet harian dihitung.',
]));

body.push(H2('4.2 Apa yang terjadi setelah disimpan'));
body.push(...bullets([
  'Spend tersimpan pada baris kunjungan dan masuk ke riwayat tamu.',
  'Tier spending tamu dihitung ulang otomatis.',
  'Jika tamu adalah anggota membership dan spend-nya memenuhi batas minimum, sticker ditambahkan. Setelah jumlah sticker cukup, voucher diterbitkan otomatis.',
  'Status berubah menjadi Done dan baris berpindah ke bagian bawah daftar.',
]));
body.push(...warn([
  'Spend di bawah batas minimum tidak menghasilkan sticker. Ini bukan error. Batas minimum diatur di Settings > Thresholds oleh Manager.',
  'Jika angka spend salah, perbaiki dengan membuka "Complete" lagi pada baris yang sama: kolom akan terisi angka sebelumnya. Jangan membuat walk-in baru.',
]));

body.push(H2('4.3 Jika walk-in ini berasal dari reservasi dengan DP'));
body.push(P('Pada kasus reservasi yang sudah membayar DP, di dalam kotak spend muncul satu baris ringkasan: dasar tagihan, jumlah yang sudah dibayar, dan total belanja. Di situ juga tertulis "Leave blank if there is no additional spending."'));
body.push(...bullets([
  'Isi kolom spend hanya dengan TAMBAHAN belanja di luar yang sudah ditagih.',
  'Jika tidak ada tambahan, kosongkan saja. Sistem menghitungnya nol.',
  'Total belanja akhir dihitung sistem: dasar tagihan ditambah yang Anda isi.',
]));
body.push(...warn([
  'Jangan menuliskan ulang seluruh total di kolom ini. Nilainya akan terhitung dua kali.',
]));

// ═══ BAB 5 ═══
body.push(H1('5. Reservasi dari Dashboard / oleh Staf'));
body.push(P('Dipakai untuk reservasi yang masuk lewat telepon, WhatsApp, Instagram, concierge hotel, atau tamu yang datang langsung untuk booking. Tombolnya ada di Dashboard dan di halaman Reservations.'));

body.push(H2('5.1 Langkah'));
body.push(...proc([
  'Klik tombol reservasi baru. Formulir "New Reservation" terbuka.',
  'Cari tamu dengan nama atau nomor HP, lalu klik hasilnya. Jika tamu baru, isi "Name" dan nomor HP. Seluruh bagian di bawah baru aktif setelah tamu dipilih, dan sebelum itu ada keterangan "Pick a guest above, or create a new one, to fill in the rest."',
  'Isi "Pax", tanggal, dan jam.',
  'Pilih "Area". Jika meja sudah ditentukan, pilih mejanya pada pemilih meja dan area akan terisi sendiri.',
  'Periksa panel deposit. Bacalah bagian 5.2 sebelum mengubah apa pun di sini.',
  'Isi jam mulai dan jam selesai bila acaranya terjadwal. "Buffer before event (minutes)" dipakai bila butuh waktu persiapan sebelum tamu datang.',
  'Isi "Expected duration if no end time (minutes)" bila tidak ada jam selesai. Bawaannya 180 menit.',
  'Centang "Reserve entire area" hanya untuk acara yang memakai seluruh area secara eksklusif. Jam selesai wajib diisi bila ini dicentang.',
  'Pilih "Occasion" bila relevan, misalnya Birthday atau Business Dinner.',
  'Pilih "Reservation Source". Ini wajib diperhatikan: dari sinilah laporan kanal dibuat. Jika sumbernya tidak ada di daftar, pilih "Other (type below)" dan tuliskan.',
  'Isi "Notes" untuk permintaan khusus.',
  'Simpan.',
]));
body.push(...why([
  'Meja yang dipilih ditahan sepanjang kunjungan ditambah buffer persiapan. Pemilih meja memakai perhitungan yang sama dengan pemeriksaan saat menyimpan, sehingga meja yang tampak tersedia benar-benar tersedia.',
  'Durasi disimpan sebagai potret saat reservasi dibuat. Kalau nanti Manager mengubah durasi bawaan di Settings, reservasi yang sudah ada tidak ikut bergeser.',
  'Pilihan "Reservation Source" disimpan dalam bahasa Inggris walaupun labelnya diterjemahkan, supaya laporan kanal tidak terpecah menjadi dua bahasa.',
]));

body.push(H2('5.2 Panel deposit pada formulir staf'));
body.push(P('Di dalam formulir ada panel "Request deposit" beserta kolom jumlah rupiah dan tombol "Use defaults". Panel ini hanya muncul saat membuat reservasi baru, tidak saat mengedit.'));
body.push(P('Sistem mengisi panel ini sendiri berdasarkan area dan jumlah pax:'));
body.push(spacer(100));
body.push(table(
  ['Kondisi', 'Yang terjadi otomatis', 'Status yang dipaksa'],
  [
    ['Area punya nilai deposit dan pax normal', 'Centang aktif, jumlah terisi sesuai nilai area. Boleh diubah.', 'Incoming'],
    ['Pax melebihi batas maksimum rumah', 'Centang aktif, jumlah DIKOSONGKAN. Anda harus mengisi angka yang sudah disepakati dengan tamu.', 'Waitlist'],
    ['Area tanpa deposit dan pax normal', 'Centang mati. Staf tetap boleh menyalakannya untuk area mana pun.', 'Bebas dipilih'],
  ],
  [2900, 4500, 1960],
));
body.push(spacer(160));
body.push(P('Selama centang "Request deposit" aktif, pilihan Status terkunci. Keterangan di bawah panel menjelaskan konsekuensinya, dan bunyinya berbeda untuk party kecil dan party besar.'));
body.push(...why([
  'Status dikunci karena reservasi yang meminta DP tidak boleh langsung berstatus Reserved. Reserved berarti meja sudah pasti, dan itu hanya benar setelah uangnya masuk atau setelah DP dibebaskan dengan alasan tertulis.',
  'Untuk party besar jumlahnya dikosongkan, bukan diisi nilai area, karena harga acara besar selalu hasil pembicaraan, bukan tarif baku.',
]));
body.push(...bullets([
  'Party kecil: jatuh tempo DP adalah jam reservasi itu sendiri, dan yang dipakai adalah invoice sederhana.',
  'Party besar: reservasi tetap Waitlist sampai DP lunas, tidak ada jatuh tempo otomatis, dan yang dipakai adalah invoice lengkap yang mendukung beberapa kali pembayaran.',
  'Tombol "Use defaults" mengembalikan panel ke nilai bawaan bila Anda sudah mengubah-ubah isinya.',
]));

body.push(H2('5.3 Menandai tamu sudah datang dan menyelesaikan reservasi'));
body.push(...proc([
  'Saat tamu datang, buka reservasinya dan tekan "Arrived". Pada detik inilah baris kunjungan dibuat.',
  'Saat tamu selesai, tekan "Completed". Formulir penyelesaian terbuka, isinya sama seperti bab 4.',
]));
body.push(...warn([
  'Jika "Arrived" tidak pernah ditekan, saat Anda menekan "Completed" aplikasi akan menampilkan pertanyaan "apakah tamu ini datang?" dengan dua pilihan. Pilihannya wajib. Tanpa memilih, penyimpanan ditolak.',
  'Pilih "ya": baris kunjungan dibuat, lalu spend, sticker, dan tier diproses normal.',
  'Pilih "tidak": reservasi menjadi Cancelled (No Show) dan tidak ada spend yang diminta. Jangan pernah mengisi angka karangan hanya supaya bisa menekan simpan.',
]));
body.push(...why([
  'Dulu aplikasi diam saja: reservasi berubah menjadi Completed, spend-nya dibuang, dan notifikasi tetap berbunyi "Visit completed". Tidak ada yang tahu selama berminggu-minggu.',
  'Menandai semua baris Completed di akhir shift adalah kebiasaan merapikan board, bukan catatan bahwa tamu datang. Karena itu aplikasi bertanya, bukan menebak.',
]));

body.push(H2('5.4 Membatalkan dan menghapus'));
body.push(...bullets([
  '"Cancel Reservation" dipakai ketika tamu membatalkan. Ini informasi penting untuk laporan, jadi jangan diganti dengan menghapus.',
  '"Delete Reservation (Manager)" hanya untuk baris yang salah masuk, misalnya duplikat atau uji coba. Hanya Manager dan Admin yang melihat tombol ini, dan alasan harus dituliskan.',
  'Jika reservasi yang dibatalkan sudah ada uang masuk, muncul kotak "This booking has been paid" yang menanyakan apakah uangnya sudah dikembalikan. Kotak ini tidak bisa ditutup dengan mengklik area gelap di luarnya.',
]));

// ═══ BAB 6 ═══
body.push(H1('6. Reservasi Online yang Membutuhkan Deposit'));
body.push(P('Ini terjadi ketika tamu memesan sendiri lewat form reservasi online, dan area yang dipilihnya memiliki nilai deposit.'));

body.push(H2('6.1 Yang dilihat tamu'));
body.push(...proc([
  'Tamu mengisi form online dan menekan tombol pesan.',
  'Halaman berikutnya menampilkan ringkasan pesanan: nama, hari dan tanggal lengkap, jam, jumlah pax, dan area.',
  'Di bawahnya muncul kotak berisi "Deposit (DP) Rp ..." dengan keterangan bahwa detail pembayaran akan dikirim lewat WhatsApp, dan bahwa reservasi ditahan sampai deposit masuk.',
  'Tersedia tombol untuk langsung chat WhatsApp ke restoran.',
]));
body.push(...warn([
  'Halaman itu TIDAK memberi cara untuk mengunggah bukti transfer, dan itu memang disengaja. Bukti pembayaran selalu lewat WhatsApp ke staf.',
]));

body.push(H2('6.2 Yang terjadi di sistem'));
body.push(...bullets([
  'Reservasi tersimpan dengan status Incoming.',
  'Meja tetap ditahan walaupun belum dibayar.',
  'Jatuh tempo DP ditetapkan pada jam reservasi itu sendiri.',
  'Bel notifikasi reservasi online di aplikasi menyala dengan angka merah.',
  'Sumber reservasi tercatat sebagai "Online Form".',
]));
body.push(...why([
  'Meja ditahan supaya tamu yang sudah berniat membayar tidak kehilangan tempat sementara ia mengurus transfer. Risikonya ditutup oleh jatuh tempo: jika sampai jam reservasi uangnya tidak masuk, reservasi kedaluwarsa otomatis dan meja kembali bebas.',
  'Pembersihan kedaluwarsa berjalan dua kali, oleh database setiap sepuluh menit dan oleh aplikasi setiap kali dibuka. Jadi meja tetap bebas sendiri walaupun penjadwal otomatis di satu restoran sedang tidak aktif.',
]));

body.push(H2('6.3 Yang harus dilakukan staf'));
body.push(P('Langkah rincinya ada di bab 9. Ringkasnya: kirim invoice dan detail pembayaran lewat WhatsApp, lalu catat pembayarannya begitu bukti diterima. Begitu jumlahnya lunas, status berubah sendiri menjadi Reserved.'));
body.push(...warn([
  'Tombol "Reserved" pada reservasi Incoming dikunci. Bila ditekan akan muncul pesan: "Record the deposit payment or waive it — Incoming cannot be set to Reserved by hand."',
  'Yang tetap bisa ditekan adalah "Arrived" dan "Cancelled", karena tamu yang tiba-tiba datang tanpa membayar dan tamu yang mundur adalah dua kejadian nyata yang harus bisa dicatat.',
]));

// ═══ BAB 7 ═══
body.push(H1('7. Reservasi Online Tanpa Deposit'));
body.push(P('Terjadi ketika area yang dipilih tamu tidak memiliki nilai deposit, jumlah pax masih dalam batas normal area itu, dan jam yang dipilih tersedia.'));

body.push(H2('7.1 Yang dilihat tamu'));
body.push(...bullets([
  'Halaman konfirmasi biasa dengan judul "Reservation Created" dan ringkasan pesanan.',
  'Tidak ada kotak deposit, tidak ada permintaan pembayaran.',
  'Tersedia tombol chat WhatsApp bila tamu ingin menambahkan sesuatu.',
]));

body.push(H2('7.2 Yang terjadi di sistem'));
body.push(...bullets([
  'Reservasi langsung berstatus Reserved. Meja ditahan.',
  'Bel notifikasi reservasi online tetap menyala.',
  'Sumber tercatat "Online Form".',
]));
body.push(...why([
  'Bel tetap menyala walaupun reservasi sudah pasti, karena bel ini bukan penanda "butuh pembayaran" melainkan "belum ada staf yang menyapa tamu ini".',
]));

body.push(H2('7.3 Yang harus dilakukan staf'));
body.push(...proc([
  'Buka bel notifikasi dan lihat daftar reservasi online yang belum ditindaklanjuti.',
  'Sapa tamu lewat WhatsApp untuk memastikan pesanannya, menanyakan kebutuhan khusus, dan mengingatkan jamnya.',
  'Bila perlu, kirim tiket konfirmasi: buka reservasinya, tekan "Terbitkan tiket". Sistem membuat satu tautan yang bisa dibuka tamu, berisi nama, tanggal, jam, pax, area, nomor referensi, dan alamat restoran.',
  'Setelah benar-benar dihubungi, centang tanda follow-up pada daftar bel.',
]));
body.push(...why([
  'Bel akan terus berbunyi sampai seseorang mencentangnya. Sebelumnya bel berhenti sendiri begitu tamu ditandai Arrived, dan akibatnya satu reservasi online tidak tersentuh selama 17 hari tanpa ada yang tahu.',
  'Membuka jendela WhatsApp TIDAK otomatis mencentang tanda follow-up. Jendela terbuka bukan berarti pesan terkirim, dan staf front desk sangat sering terputus di tengah mengetik.',
  'Tiket hanya bisa diterbitkan untuk reservasi berstatus Reserved, dan menerbitkannya dua kali akan memakai tautan yang sama. WhatsApp menyimpan pratinjau sebuah tautan selama berminggu-minggu, jadi satu reservasi harus selalu satu tautan.',
]));
body.push(...warn([
  'Tiket tidak memuat nomor HP tamu, tidak memuat catatan staf, dan tidak memuat informasi pembayaran. Jangan memakai tiket sebagai bukti pembayaran.',
]));

// ═══ BAB 8 ═══
body.push(H1('8. Reservasi Online Party Besar yang Perlu Dibicarakan'));
body.push(P('Terjadi ketika jumlah pax yang diisi tamu melebihi batas maksimum yang ditetapkan restoran. Nilainya diatur pada Settings > Reservation Form, pada kolom batas pax, dan disimpan bersama jam operasional.'));

body.push(H2('8.1 Dua kemungkinan, tergantung pengaturan'));
body.push(H3('A. Mode party besar aktif'));
body.push(P('Syaratnya dua-duanya terpenuhi: kotak mode party besar dicentang DAN nomor WhatsApp perwakilan sudah diisi. Jika demikian, form berubah saat tamu mengisi pax di atas batas:'));
body.push(...bullets([
  'Muncul keterangan bahwa permintaan dikirim dulu, dan tamu bisa menghubungi perwakilan restoran lewat WhatsApp dari halaman konfirmasi.',
  'Label jam berubah menjadi "Preferred time (we will confirm)".',
  'Kolom catatan, kolom perusahaan, dan kolom permintaan pax disembunyikan.',
  'Tombol kirim berubah menjadi "Submit request".',
  'Permintaan tetap DISIMPAN sebagai Waitlist, lalu tamu diarahkan ke WhatsApp dengan pesan yang sudah berisi detail permintaannya.',
]));

body.push(H3('B. Mode party besar tidak aktif atau setengah diisi'));
body.push(P('Form tetap seperti biasa. Permintaan tersimpan sebagai Waitlist dengan alasan pax melebihi batas, dan tamu melihat keterangan bahwa party di atas N orang ditinjau lebih dulu.'));
body.push(...why([
  'Mode ini hanya menyala kalau kotak dicentang DAN nomornya ada. Pengaturan yang setengah jadi tidak boleh membuat pesanan besar menjadi mustahil tanpa jalan bagi tamu untuk menghubungi siapa pun.',
]));

body.push(H2('8.2 Yang dilihat tamu di halaman konfirmasi'));
body.push(...bullets([
  'Judulnya "Request Sent", bukan "Reservation Created".',
  'Tertulis tebal: "This is not a confirmed reservation yet."',
  'Alasannya disebutkan, lalu keterangan bahwa staf akan meninjau dan mengabari lewat WhatsApp, dengan permintaan agar tamu tidak datang sebelum dikonfirmasi.',
  'Status: menunggu staf mengonfirmasi.',
]));

body.push(H2('8.3 Yang harus dilakukan staf'));
body.push(...proc([
  'Buka permintaan tersebut dari daftar reservasi. Di bagian atas muncul panel kuning bertuliskan "waiting for a decision".',
  'Hubungi tamu LEBIH DULU. Bicarakan jumlah pax yang sebenarnya, jam, kebutuhan area, menu, dan jumlah DP yang disepakati.',
  'Setelah ada kesepakatan, isi kolom "Agreed amount" pada panel kuning itu dengan angka yang disepakati.',
  'Klik "Save amount".',
  'Atur meja dan jam pada bagian bawah jendela yang sama, lalu klik "Save tables and availability".',
  'Lanjutkan ke bab 10 untuk proses invoice dan pembayarannya.',
]));
body.push(...warn([
  'Menyimpan jumlah yang disepakati TIDAK mengubah status. Reservasi tetap Waitlist, dan yang mempromosikannya menjadi Reserved adalah uang yang masuk. Ini sama dengan reservasi DP biasa.',
  'Selama masih Waitlist, meja belum ditahan. Kalau acaranya besar dan penting, tetapkan meja dan jamnya segera setelah kesepakatan, jangan menunggu DP masuk.',
  'Tidak ada kedaluwarsa otomatis untuk permintaan party besar. Kalau tamu menghilang, seseorang harus membatalkannya secara manual. Periksa daftar Waitlist minimal sekali sehari.',
]));
body.push(...why([
  'Tombol invoice dan pencatatan pembayaran baru muncul setelah ada angka. Tanpa angka, yang bisa dikirim hanyalah invoice kosong, dan itu membuang satu-satunya pesan yang pasti dibuka tamu.',
]));
body.push(...esc([
  'Permintaan party besar yang menyangkut penutupan area, harga khusus, atau diskon harus diputuskan Manager sebelum angka diisi.',
]));

// ═══ BAB 9 ═══
body.push(H1('9. Follow Up Reservasi dengan DP: Party Kecil'));
body.push(P('Yang dimaksud party kecil adalah reservasi dengan jumlah pax di dalam batas normal, yang DP-nya dihitung otomatis dari nilai area. Statusnya Incoming.'));

body.push(H2('9.1 Sebelum mulai: dua syarat'));
body.push(...bullets([
  'Rekening bank atau gambar QRIS sudah diisi di Settings. Kalau keduanya kosong, tombol invoice menolak dengan pesan "Add bank details or a QRIS image in Settings first". Hanya Admin yang boleh mengisinya.',
  'Tamu punya nomor HP di sistem. Kalau kosong, muncul "This guest has no phone number — add one first".',
]));

body.push(H2('9.2 Membaca panel deposit'));
body.push(P('Buka reservasinya. Di jendela "Update Reservation" ada panel deposit. Warnanya biru muda kalau masih ada kekurangan, dan hijau kalau sudah lunas. Isinya:'));
body.push(spacer(100));
body.push(table(
  ['Yang tertulis', 'Artinya'],
  [
    ['Rp ... outstanding', 'Sisa yang belum dibayar. Inilah angka yang harus ditagih.'],
    ['Paid in full', 'Sudah lunas. Tombol invoice, pencatatan pembayaran, dan pembebasan hilang.'],
    ['Expected Rp ... · received Rp ...', 'Jumlah yang diminta dan jumlah yang sudah masuk.'],
    ['due in ...', 'Sisa waktu sampai jatuh tempo, yaitu jam reservasi itu sendiri.'],
    ['overdue', 'Sudah melewati jatuh tempo. Reservasi ini bisa kedaluwarsa kapan saja.'],
    ['Asked on ...', 'Tanggal invoice pertama dikirim. Kalau kosong, belum ada yang menagih.'],
  ],
  [3200, 6160],
));
body.push(spacer(160));

body.push(H2('9.3 Mengirim permintaan DP'));
body.push(...proc([
  'Klik "Invoice & WhatsApp" pada panel deposit.',
  'Periksa ringkasan di kotak yang terbuka: nama pemesan dan jumlah DP.',
  'Isi "Note on the invoice (optional)" bila perlu, misalnya "DP dapat dipotong dari total bill".',
  'Klik "Create invoice & open WhatsApp". Sistem menyimpan invoice, memberinya nomor, lalu membuka WhatsApp dengan pesan berisi tautan invoice.',
  'Kirim pesan itu di WhatsApp. Jangan hanya menutup tab.',
]));
body.push(...warn([
  'Tombol itu melakukan DUA hal: membuat invoice dan membuka WhatsApp. Staf yang menyangka hanya mendapat tautan adalah yang paling sering menutup tab WhatsApp tanpa mengirim apa pun, sehingga tamu tidak pernah ditagih padahal sistem mencatat invoice sudah dibuat.',
]));

body.push(H2('9.4 Mencatat pembayaran'));
body.push(...proc([
  'Setelah bukti transfer diterima, buka reservasinya dan klik "Record payment".',
  'Isi "Amount" dengan jumlah yang benar-benar masuk, bukan jumlah yang ditagih.',
  'Isi "Paid on" dengan tanggal uang masuk.',
  'Isi "Method", bebas diketik, misalnya Transfer, QRIS, atau Cash.',
  'Isi "Reference" bila ada nomor transaksi. Opsional.',
  'Isi "Note" bila perlu.',
  'Klik "Save payment".',
]));
body.push(P('Jika jumlah yang masuk menutup seluruh kekurangan, status berubah menjadi Reserved pada saat itu juga, dalam satu tindakan yang sama.'));
body.push(...why([
  'Promosi status terjadi di dalam transaksi yang sama dengan pencatatan pembayaran, supaya tidak ada celah berupa "pembayaran sudah dicatat tapi statusnya lupa diubah".',
  'Kolom Method sengaja berupa teks bebas, bukan pilihan, karena setiap restoran punya cara pembayaran yang berbeda.',
]));
body.push(...warn([
  'Pembayaran SEBAGIAN tetap membuat reservasi berstatus Incoming, dan jatuh temponya TIDAK bergeser. Ini disengaja: kalau jatuh tempo ikut mundur setiap kali ada pembayaran, tamu bisa menahan meja selamanya dengan mengirim Rp 1.000 setiap hari.',
  'Jumlah nol atau angka tidak wajar ditolak sistem.',
]));

body.push(H2('9.5 Membebaskan DP'));
body.push(P('Hanya untuk Admin, Manager, atau Staff yang diberi izin khusus. Tombolnya "Waive" pada panel deposit.'));
body.push(...proc([
  'Klik "Waive".',
  'Tuliskan alasan pada kolom yang tersedia. Alasan WAJIB, dan ditolak jika kosong.',
  'Klik "Waive deposit". Reservasi menjadi Reserved tanpa pembayaran.',
]));
body.push(P('Pembayaran yang sudah tercatat sebelumnya tetap menempel pada reservasi itu.'));
body.push(...why([
  'Tanpa alasan tertulis, seminggu kemudian tidak ada yang bisa membedakan DP yang dibebaskan atas izin chef dari DP yang sekadar terlupa. Alasan diwajibkan di aplikasi DAN di database.',
  'Aplikasi memeriksa ulang izin pembebasan langsung ke database setiap kali tombol ini dibuka, dan menolak bila pemeriksaan tidak bisa dilakukan. Jadi izin yang baru dicabut langsung berlaku.',
]));
body.push(...esc([
  'Muncul "This account cannot waive deposits": akun Anda belum diberi izin. Mintalah Manager yang mengerjakan, atau minta Admin memberikan izin lewat Settings > Staff.',
]));

body.push(H2('9.6 Setelah lunas'));
body.push(...bullets([
  'Status menjadi Reserved dan panel deposit berubah hijau dengan tulisan "Paid in full".',
  'Terbitkan tiket konfirmasi untuk tamu bila diperlukan, lewat "Terbitkan tiket".',
  'Saat tamu datang, tekan "Arrived". Saat selesai, tekan "Completed" dan isi hanya TAMBAHAN belanjanya, seperti di bagian 4.3.',
]));

body.push(H2('9.7 Kalau reservasi berbayar ini dibatalkan'));
body.push(P('Muncul kotak "This booking has been paid" yang menyebutkan jumlah uang yang sudah diterima, dengan pertanyaan apakah sudah dikembalikan. Kotak ini satu-satunya di aplikasi yang tidak bisa ditutup dengan mengklik area gelap di luarnya.'));
body.push(...why([
  'Membatalkan reservasi tidak memindahkan uang sesen pun. Kalau pertanyaan ini bisa dilewati dengan satu klik sembarangan, uang tamu akan hilang dari percakapan dan tidak ada yang mengurus pengembaliannya.',
]));

// ═══ BAB 10 ═══
body.push(H1('10. Follow Up Reservasi dengan DP: Party Besar'));
body.push(P('Party besar adalah reservasi dengan pax melebihi batas maksimum rumah, atau yang masuk sebagai permintaan party besar dari form online. Statusnya Waitlist, dan jumlah DP-nya hasil kesepakatan.'));

body.push(H2('10.1 Urutan lengkapnya'));
body.push(...proc([
  'Bicarakan dengan tamu dan capai kesepakatan. Jangan mengirim apa pun sebelum ada angka.',
  'Isi "Agreed amount" pada panel kuning, lalu "Save amount". Lihat bagian 8.3.',
  'Tetapkan meja, jam mulai, jam selesai, dan buffer. Centang "Reserve entire area" bila areanya dipakai eksklusif. Klik "Save tables and availability".',
  'Klik "Invoice & WhatsApp". Untuk party besar, yang terbuka BUKAN kotak invoice sederhana melainkan editor invoice lengkap.',
  'Susun invoice di editor: rincian, DP yang diminta, dan bila perlu bagian pelunasan. Simpan, lalu kirim tautannya lewat WhatsApp.',
  'Catat pembayaran dengan "Record payment", sama seperti bagian 9.4, setiap kali ada uang masuk.',
  'Begitu total pembayaran menutup jumlah yang disepakati, status berubah sendiri dari Waitlist menjadi Reserved.',
  'Untuk sisa tagihan setelah DP, gunakan "Record another payment" pada panel deposit. Tombol ini hanya untuk Manager dan Admin.',
]));
body.push(...why([
  'Waitlist dipromosikan dengan cara yang sama seperti Incoming: yang membedakan keduanya hanya bagaimana angkanya didapat. Incoming angkanya dihitung otomatis saat pesan, Waitlist angkanya hasil negosiasi. Uang yang masuk adalah kejadian yang sama, jadi akhirnya sama.',
  'Invoice lengkap dipakai karena acara besar hampir selalu dibayar lebih dari sekali: DP dulu, pelunasan belakangan. Invoice sederhana tidak dirancang untuk itu.',
  'Yang dipakai sistem sebagai permintaan pembayaran aktif adalah invoice deposit terbaru yang sudah diterbitkan. Invoice lama tetap tersimpan sebagai riwayat, bukan sebagai tagihan.',
]));

body.push(H2('10.2 Perbedaan penting dibanding party kecil'));
body.push(spacer(100));
body.push(table(
  ['Hal', 'Party kecil (Incoming)', 'Party besar (Waitlist)'],
  [
    ['Jumlah DP', 'Otomatis dari nilai area', 'Hasil kesepakatan, diisi staf'],
    ['Meja ditahan sejak awal', 'Ya', 'TIDAK, sampai Anda menetapkannya'],
    ['Jatuh tempo', 'Jam reservasi itu sendiri', 'Tidak ada'],
    ['Kedaluwarsa otomatis', 'Ya, disapu tiap sepuluh menit', 'TIDAK. Harus dibatalkan manual'],
    ['Jenis invoice', 'Invoice sederhana', 'Editor invoice lengkap'],
    ['Pelunasan sisa tagihan', 'Biasanya tidak ada', 'Lewat "Record another payment", Manager'],
  ],
  [2400, 3480, 3480],
));
body.push(spacer(160));
body.push(...warn([
  'Karena tidak ada kedaluwarsa otomatis, daftar Waitlist adalah pekerjaan yang harus diperiksa manusia. Biasakan memeriksanya setiap pagi: permintaan yang tamunya sudah tidak bisa dihubungi harus dibatalkan supaya mejanya bebas.',
]));

body.push(H2('10.3 Kalau muncul konflik meja saat pembayaran dicatat'));
body.push(P('Bisa terjadi bahwa pada saat pembayaran menutup DP dan sistem hendak mengubah status menjadi Reserved, meja atau jam yang dipilih ternyata sudah bentrok dengan reservasi lain. Dalam keadaan itu sistem membatalkan DUA-DUANYA: pencatatan pembayaran dan perubahan status.'));
body.push(...proc([
  'Selesaikan dulu bentrokannya: ganti meja, ganti jam, atau bebaskan area.',
  'Klik "Save tables and availability".',
  'Catat ulang pembayarannya lewat "Record payment".',
]));
body.push(...why([
  'Kalau hanya salah satu yang dibatalkan, hasilnya adalah dua keadaan yang lebih buruk: reservasi Reserved tanpa meja, atau uang masuk yang tidak tercatat. Lebih baik staf mengerjakan satu langkah dua kali.',
]));
body.push(...esc([
  'Bentrokan meja untuk acara besar, permintaan diskon atau perubahan harga, dan pembatalan acara yang sudah menerima pembayaran: semuanya keputusan Manager.',
]));

// ═══ LAMPIRAN ═══
body.push(H1('Lampiran A. Pesan yang Sering Muncul dan Artinya'));
body.push(spacer(100));
body.push(table(
  ['Pesan', 'Arti dan yang harus dilakukan'],
  [
    ['Record the deposit payment or waive it — Incoming cannot be set to Reserved by hand', 'Reservasi menunggu DP. Catat pembayarannya atau bebaskan DP-nya. Status tidak bisa diubah manual.'],
    ['This account cannot perform this action', 'Database menolak karena peran Anda. Bukan salah klik. Minta manager mengerjakan.'],
    ['This account cannot waive deposits', 'Akun Anda belum diberi izin membebaskan deposit.'],
    ['Add bank details or a QRIS image in Settings first', 'Tujuan pembayaran belum diisi. Hanya Admin yang bisa mengisinya.'],
    ['This guest has no phone number — add one first', 'Tambahkan nomor HP tamu sebelum mengirim invoice.'],
    ['One or more selected tables no longer exist', 'Meja yang dipilih sudah tidak aktif atau terhapus. Pilih meja lain dan simpan ulang.'],
    ['Nomor telepon sudah terdaftar atas guest lain', 'Nomor itu milik tamu lain. Periksa angkanya, atau simpan tanpa nomor dan laporkan.'],
    ['Spend amount is required before completing', 'Isi jumlah belanja. Untuk tamu yang tidak datang, pilih jawaban "tidak datang", jangan mengisi angka karangan.'],
    ['Enter a positive deposit amount before saving the invoice', 'Invoice deposit tidak boleh bernilai nol. Isi jumlahnya.'],
    ['Maksimal 10 campaign aktif', 'Broadcast sudah punya 10 campaign berjalan. Selesaikan salah satu dulu.'],
  ],
  [3400, 5960],
));

body.push(H1('Lampiran B. Daftar Periksa Harian'));
body.push(H2('Awal shift'));
body.push(...bullets([
  'Login dengan akun sendiri, jangan memakai akun orang lain.',
  'Buka bel notifikasi, tindaklanjuti reservasi online yang belum disapa.',
  'Periksa daftar Waitlist: ada permintaan party besar yang menunggu keputusan?',
  'Periksa reservasi Incoming yang jatuh temponya hari ini.',
]));
body.push(H2('Selama shift'));
body.push(...bullets([
  'Tamu datang tanpa reservasi: Quick Walk-In, lengkapi mejanya kemudian.',
  'Tamu reservasi datang: tekan "Arrived" saat itu juga, bukan nanti.',
  'Bukti transfer masuk: catat lewat "Record payment" segera.',
]));
body.push(H2('Akhir shift'));
body.push(...bullets([
  'Selesaikan semua walk-in yang masih Active dengan "Complete" dan isi spend-nya.',
  'Untuk reservasi yang tamunya tidak datang, jawab pertanyaan kedatangan dengan jujur. Jangan menandai Completed untuk tamu yang tidak datang.',
  'Pastikan pax pada walk-in cepat sudah diperbaiki bila tadi dilewati.',
  'Laporkan ke manager: pesan penolakan yang muncul, walk-in yang tidak bisa diperbaiki, dan tamu yang datanya ganda.',
]));

body.push(new Paragraph({ spacing: { before: 500, after: 0 },
  children: [new TextRun({ text: 'Selesai. Pertanyaan atau koreksi atas manual ini disampaikan ke product manager.', size: 20, italics: true, color: GREY })] }));

// ── document ───────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'Intoch',
  title: 'Manual Pelatihan Staf Intoch GMS',
  description: 'Login, walk-in, reservasi, dan penanganan deposit',
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 21 } },
    },
  },
  numbering: {
    config: [
      {
        reference: 'steps',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } },
        }],
      },
      {
        reference: 'dots',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1200, bottom: 1200, left: 1080, right: 1080 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Intoch GMS · Manual Pelatihan Staf · ', size: 17, color: GREY }),
            new TextRun({ children: [PageNumber.CURRENT], size: 17, color: GREY })],
        })],
      }),
    },
    children: body,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('/home/claude/manual/Manual_Pelatihan_Staf_Intoch.docx', buf);
  console.log('written', buf.length, 'bytes');
});
