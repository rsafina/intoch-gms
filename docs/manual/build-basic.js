const fs = require('fs');
const path = require('path');
const d = require('docx');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, Footer, PageNumber, ImageRun, convertInchesToTwip,
} = d;

// ── Screenshots ─────────────────────────────────────────────────────────
// Produced by capture-manual-screens.mjs into this folder under fixed
// names. When a file is absent the figure is simply skipped, so the
// document stays clean until the pictures exist. SHOW_PLACEHOLDERS=1 draws
// a marked frame instead, for reviewing where each picture will land.
const SCREENS = process.env.SCREENS || path.join(__dirname, 'screens');
const SHOW_PLACEHOLDERS = process.env.SHOW_PLACEHOLDERS === '1';
const CAPTURED_AT = (() => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(SCREENS, 'manifest.json'), 'utf8'));
    return m.captured_at ? new Date(m.captured_at).toLocaleDateString('id-ID',
      { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  } catch { return null; }
})();

// PNG dimensions straight out of the IHDR chunk. No image library needed.
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let chapterNo = 0;
let figNo = 0;

// One picture per procedure. Scaled to the text column and capped in height
// so a tall modal cannot push its own caption onto the next page.
function figure(file, caption) {
  figNo += 1;
  const label = 'Gambar ' + chapterNo + '.' + figNo;
  const full = path.join(SCREENS, file + '.png');
  const captionPara = (extra) => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240, before: 80 },
    children: [
      new TextRun({ text: label + '. ', size: 18, bold: true, color: GREY }),
      new TextRun({ text: caption, size: 18, color: GREY }),
      ...(extra ? [new TextRun({ text: extra, size: 18, color: GREY, italics: true })] : []),
    ],
  });

  if (fs.existsSync(full)) {
    const data = fs.readFileSync(full);
    const { width, height } = pngSize(data);
    const maxW = 600, maxH = 620;
    const scale = Math.min(maxW / width, maxH / height, 1);
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 140, after: 0 },
        children: [new ImageRun({
          data, type: 'png',
          transformation: { width: Math.round(width * scale), height: Math.round(height * scale) },
        })],
      }),
      captionPara(CAPTURED_AT ? '  ·  diambil ' + CAPTURED_AT : ''),
    ];
  }

  if (!SHOW_PLACEHOLDERS) return [];
  return [
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      borders: {
        top: { style: BorderStyle.DASHED, size: 6, color: 'BDB6AA' },
        bottom: { style: BorderStyle.DASHED, size: 6, color: 'BDB6AA' },
        left: { style: BorderStyle.DASHED, size: 6, color: 'BDB6AA' },
        right: { style: BorderStyle.DASHED, size: 6, color: 'BDB6AA' },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      },
      rows: [new TableRow({ cantSplit: true, children: [new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        margins: { top: 420, bottom: 420, left: 200, right: 200 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 },
          children: [new TextRun({ text: 'screenshot menyusul: ' + file + '.png', size: 19, color: GREY, italics: true })] })],
      })] })],
    }),
    captionPara(''),
  ];
}

const INK = '1F3864';
const ACC = '9F6404';
const GREY = '595959';
const BLUE = '1F6FA8';
const GREEN = '3D7A4E';
const RED = 'C0392B';

let stepInstance = 0;

const spacer = (after = 200) => new Paragraph({ spacing: { after }, children: [] });

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 130, line: 288 },
  alignment: opts.align,
  children: [new TextRun({ text, size: opts.size ?? 21, color: opts.color, bold: opts.bold, italics: opts.italics })],
});

const H1 = (text) => {
  // The figure number follows the chapter, so a picture is "Gambar 3.2"
  // rather than a running count nobody can locate.
  const m = /^(\d+)\./.exec(text);
  if (m) { chapterNo = Number(m[1]); figNo = 0; }
  return H1para(text);
};

const H1para = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, pageBreakBefore: true,
  spacing: { before: 0, after: 220 },
  children: [new TextRun({ text, size: 32, bold: true, color: INK })],
});

const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 300, after: 150 },
  children: [new TextRun({ text, size: 25, bold: true, color: INK })],
});

const H3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 230, after: 110 },
  children: [new TextRun({ text, size: 22, bold: true, color: ACC })],
});

const steps = (items, instance) => items.map(t => new Paragraph({
  numbering: { reference: 'steps', level: 0, instance },
  spacing: { after: 100, line: 288 },
  children: [new TextRun({ text: t, size: 21 })],
}));

const proc = (items) => { stepInstance += 1; return steps(items, stepInstance); };

const bullets = (items) => items.map(t => new Paragraph({
  numbering: { reference: 'dots', level: 0 },
  spacing: { after: 90, line: 288 },
  children: [new TextRun({ text: t, size: 21 })],
}));

// A field list: what to type into each box on screen.
const fields = (rows) => [
  spacer(60),
  table(['Kolom di layar', 'Isi dengan apa', 'Wajib?'], rows, [2300, 5400, 1660]),
  spacer(170),
];

const box = (title, lines, fill, bar) => new Table({
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
      margins: { top: 150, bottom: 150, left: 200, right: 200 },
      children: [
        new Paragraph({
          spacing: { after: 90 },
          children: [new TextRun({ text: title, size: 19, bold: true, color: bar, allCaps: true })],
        }),
        ...lines.map((l, i) => new Paragraph({
          spacing: { after: i === lines.length - 1 ? 0 : 90, line: 288 },
          children: [new TextRun({ text: l, size: 20 })],
        })),
      ],
    })],
  })],
});

const istilah = (lines) => [box('Istilah', lines, 'EAF1F6', BLUE), spacer(170)];
const ingat = (lines) => [box('Ingat ini', lines, 'F4F1EA', ACC), spacer(170)];
const jangan = (lines) => [box('Jangan sampai begini', lines, 'FBEEE9', RED), spacer(170)];
const salah = (lines) => [box('Kalau tadi salah isi', lines, 'EDF3EC', GREEN), spacer(170)];

function table(header, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (text, { bold, fill } = {}) => (w) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    margins: { top: 95, bottom: 95, left: 135, right: 135 },
    children: [new Paragraph({
      spacing: { after: 0, line: 270 },
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
      new TableRow({ tableHeader: true, cantSplit: true,
        children: header.map((h, i) => cell(h, { bold: true, fill: 'F4F1EA' })(widths[i])) }),
      ...rows.map(r => new TableRow({ cantSplit: true,
        children: r.map((c, i) => cell(c)(widths[i])) })),
    ],
  });
}

// One-line flow strip: A → B → C
const flow = (stages) => [
  spacer(60),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: Array(stages.length).fill(Math.floor(9360 / stages.length)),
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
    rows: [new TableRow({
      cantSplit: true,
      children: stages.map((s, i) => new TableCell({
        width: { size: Math.floor(9360 / stages.length), type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: i % 2 ? 'F4F1EA' : 'EAF1F6', color: 'auto' },
        margins: { top: 130, bottom: 130, left: 110, right: 110 },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
            children: [new TextRun({ text: 'Langkah ' + (i + 1), size: 16, bold: true, color: GREY, allCaps: true })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0, line: 260 },
            children: [new TextRun({ text: s, size: 19, bold: true, color: INK })] }),
        ],
      })),
    })],
  }),
  spacer(210),
];

const tocEntries = [
  ['1. Mengenal Intoch dalam Lima Menit', '3'],
  ['2. Login dan Mengenal Layar', '5'],
  ['3. Cara 1: Walk-In dari Dashboard', '7'],
  ['4. Cara 2: Reservasi dari Dashboard', '10'],
  ['5. Cara 3: Reservasi dari Form Online', '14'],
  ['6. Kartu Contekan', '17'],
];

const body = [];

// ── Cover ──
body.push(
  new Paragraph({ spacing: { before: 2500, after: 0 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'INTOCH', size: 56, bold: true, color: INK, characterSpacing: 60 })] }),
  new Paragraph({ spacing: { before: 120, after: 620 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Guest Management System', size: 24, color: ACC, allCaps: true, characterSpacing: 40 })] }),
  new Paragraph({ spacing: { after: 150 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Panduan Dasar untuk Staf Baru', size: 40, bold: true, color: INK })] }),
  new Paragraph({ spacing: { after: 120 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Tiga cara mencatat kunjungan tamu, dari nama tamu sampai kunjungan selesai', size: 23, color: GREY })] }),
  new Paragraph({ spacing: { after: 900 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Belum pernah memakai aplikasi ini? Mulai dari halaman pertama.', size: 20, color: ACC, italics: true })] }),
  new Paragraph({ spacing: { after: 60 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Versi 1.0  ·  12 September 2026', size: 20, color: GREY })] }),
  new Paragraph({ spacing: { after: 0 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Dokumen internal. Mohon tidak dibagikan ke luar restoran.', size: 19, color: GREY, italics: true })] }),
);

// ── TOC ──
body.push(
  new Paragraph({ pageBreakBefore: true, spacing: { after: 240 },
    children: [new TextRun({ text: 'Daftar Isi', size: 32, bold: true, color: INK })] }),
  ...tocEntries.map(([label, page]) => new Paragraph({
    spacing: { after: 120, line: 288 },
    tabStops: [{ type: 'right', position: 9000, leader: 'dot' }],
    children: [new TextRun({ text: label, size: 21 }), new TextRun({ text: '\t' + page, size: 21 })],
  })),
  spacer(300),
  P('Panduan ini hanya membahas tiga hal: mencatat tamu yang datang langsung, mencatat reservasi yang kamu terima sendiri, dan menangani reservasi yang masuk sendiri dari form online. Membership, voucher, broadcast, dan laporan tidak dibahas di sini.', { size: 19, italics: true, color: GREY }),
  P('Untuk aturan yang lebih dalam, termasuk penanganan deposit secara lengkap, lihat "Manual Pelatihan Staf Intoch".', { size: 19, italics: true, color: GREY }),
);

// ═══════════════════ BAB 1 ═══════════════════
body.push(H1('1. Mengenal Intoch dalam Lima Menit'));
body.push(P('Intoch adalah aplikasi untuk mencatat siapa yang makan di restoran ini, kapan, berapa orang, dan berapa belanjanya. Itu saja inti pekerjaannya. Semua fitur lain dibangun di atas catatan itu.'));

body.push(H2('1.1 Tiga kata yang akan kamu dengar terus'));
body.push(...istilah([
  'TAMU (guest): orangnya. Satu tamu punya satu data permanen: nama, nomor HP, riwayat kunjungan. Ibu Sinta yang makan di sini bulan lalu dan malam ini adalah SATU tamu, bukan dua.',
  'KUNJUNGAN (visit): satu kali tamu itu makan di sini. Ibu Sinta yang datang tiga kali punya satu data tamu dan tiga kunjungan.',
  'RESERVASI (reservation): janji bahwa tamu akan datang. Reservasi belum tentu jadi kunjungan, karena tamu bisa tidak muncul.',
]));
body.push(P('Jadi urutannya selalu: ada tamu, tamu itu punya kunjungan, dan kunjungan bisa berawal dari reservasi atau tidak.'));

body.push(H2('1.2 Tiga cara kunjungan masuk ke sistem'));
body.push(P('Hanya ada tiga. Seluruh panduan ini membahas ketiganya, satu bab masing-masing.'));
body.push(spacer(80));
body.push(table(
  ['Cara', 'Situasinya', 'Kamu kerjakan di', 'Bab'],
  [
    ['Walk-in', 'Tamu datang tanpa pesan lebih dulu', 'Dashboard', '3'],
    ['Reservasi oleh staf', 'Tamu telepon, WhatsApp, atau datang untuk pesan tempat, dan KAMU yang mencatatnya', 'Dashboard', '4'],
    ['Reservasi online', 'Tamu memesan sendiri lewat form di internet. Data masuk tanpa kamu mengetik apa pun', 'Halaman Reservations', '5'],
  ],
  [1700, 4400, 2100, 1160],
));
body.push(spacer(190));

body.push(H2('1.3 Satu aturan yang membuat semuanya masuk akal'));
body.push(P('Di akhir setiap cara, ada satu hal yang sama: kunjungan harus DISELESAIKAN dan jumlah belanjanya diisi. Sebelum itu terjadi, kunjungan tersebut belum lengkap di mata sistem.'));
body.push(...ingat([
  'Reservasi yang tamunya sudah datang TIDAK otomatis menjadi kunjungan. Kamu harus menekan tombol "Arrived" saat tamu itu tiba. Itulah detik ketika sistem mencatat "orang ini benar-benar datang".',
  'Kalau "Arrived" tidak pernah ditekan, semua laporan menganggap tamu itu tidak pernah muncul, walaupun mejanya penuh semalam.',
  'Dan di akhir, isi jumlah belanjanya. Dari angka itulah laporan omzet, riwayat tamu, dan sticker membership dihitung.',
]));

body.push(H2('1.4 Kalau kamu hanya mengingat satu halaman'));
body.push(...flow(['Catat tamunya', 'Tamu datang', 'Tamu selesai makan', 'Isi belanja, selesai']));
body.push(P('Itu bentuk dasar dari ketiga cara. Yang berbeda hanya bagaimana langkah pertama terjadi: kamu mengetiknya saat tamu berdiri di depanmu, kamu mengetiknya saat tamu menelepon, atau tamu mengetiknya sendiri dari rumah.'));

// ═══════════════════ BAB 2 ═══════════════════
body.push(H1('2. Login dan Mengenal Layar'));

body.push(H2('2.1 Masuk ke aplikasi'));
body.push(...proc([
  'Buka aplikasi Intoch di browser komputer front desk.',
  'Isi kolom Username dengan username yang diberikan manager. Huruf kecil semua, tanpa spasi.',
  'Isi kolom PIN dengan 4 angka milikmu.',
  'Tekan Enter.',
]));
body.push(...figure('02-login', 'Layar login: username lalu PIN 4 angka'));
body.push(P('Kalau muncul tulisan merah di bawah kolom, berarti username atau PIN salah. Coba lagi dengan pelan. Kalau tetap gagal, panggil manager: bisa jadi akunmu belum aktif.'));
body.push(...jangan([
  'Jangan memakai akun orang lain, dan jangan memberikan PIN-mu ke siapa pun. Semua yang kamu simpan tercatat atas namamu, termasuk kalau ada yang salah.',
]));

body.push(H2('2.2 Menu di sisi kiri'));
body.push(P('Untuk pekerjaan sehari-hari kamu hanya butuh tiga menu teratas. Sisanya ada supaya kamu tahu itu bukan tempatmu tersesat.'));
body.push(spacer(80));
body.push(table(
  ['Menu', 'Isinya'],
  [
    ['Dashboard', 'Layar utama. Di sinilah kamu mencatat walk-in dan reservasi baru. Buka ini setiap kali mulai shift.'],
    ['Reservations', 'Daftar lengkap semua reservasi, bisa dicari dan difilter. Dipakai untuk menangani reservasi online.'],
    ['Walk-Ins', 'Daftar semua tamu walk-in hari ini, lengkap dengan meja dan belanjanya.'],
    ['Guests', 'Database tamu. Untuk mencari atau memperbaiki data seorang tamu.'],
    ['Membership', 'Kartu anggota, sticker, dan voucher. Tidak dibahas di panduan ini.'],
    ['Broadcast, Reports, Vouchers, Invoice, Settings', 'Untuk manager dan admin. Beberapa mungkin tidak terlihat di akunmu, dan itu normal.'],
  ],
  [2300, 7060],
));
body.push(spacer(190));
body.push(...figure('02-menu-sidebar', 'Menu di sisi kiri. 1 Dashboard, 2 Reservations, 3 Walk-Ins'));
body.push(P('Kalau ada menu yang tidak kamu lihat sama sekali, itu bukan kerusakan. Menu disesuaikan dengan peran akunmu.'));

body.push(H2('2.3 Isi halaman Dashboard, dari atas ke bawah'));
body.push(spacer(80));
body.push(table(
  ['Bagian', 'Gunanya'],
  [
    ['Quick Walk-In', 'Kotak bergaris kuning di atas. Untuk mencatat tamu yang baru saja masuk, secepat mungkin.'],
    ['Upcoming Reservations', 'Reservasi yang akan datang. Ada tab Today, Tomorrow, hari ketiga, dan satu tab khusus "Online form" untuk 14 hari ke depan.'],
    ["Today's Walk-Ins", 'Semua walk-in hari ini, dengan tombol Complete pada setiap baris.'],
    ['Prize Redemptions', 'Penukaran hadiah. Tidak dibahas di panduan ini.'],
    ['Birthday Guests', 'Tamu yang berulang tahun bulan ini. Tidak dibahas di panduan ini.'],
  ],
  [2500, 6860],
));
body.push(spacer(190));
body.push(...ingat([
  'Tombol untuk membuat walk-in lengkap dan reservasi baru ada di bagian atas Dashboard. Dua tombol itu yang akan paling sering kamu pakai.',
]));

// ═══════════════════ BAB 3 ═══════════════════
body.push(H1('3. Cara 1: Walk-In dari Dashboard'));
body.push(P('Dipakai ketika tamu datang tanpa memesan tempat lebih dulu. Ini pekerjaan paling sering di front desk.'));
body.push(...flow(['Tamu masuk, catat namanya', 'Beri meja', 'Tamu selesai makan', 'Complete, isi belanja']));

body.push(H2('3.1 Pilih dulu: cepat atau lengkap'));
body.push(P('Ada dua jalan, dan keduanya sah. Bedanya hanya seberapa banyak yang kamu isi sekarang.'));
body.push(spacer(80));
body.push(table(
  ['Jalan', 'Pakai kalau', 'Yang kamu isi'],
  [
    ['Quick Walk-In', 'Sedang ramai, tamu menumpuk di depan, kamu perlu mencatat dalam lima detik', 'Nama, nomor HP kalau ada, jumlah orang'],
    ['Tombol Walk-In', 'Tidak sedang ramai, atau meja harus langsung ditetapkan', 'Semuanya sekalian: tamu, jumlah orang, meja, area, catatan'],
  ],
  [1900, 4260, 3200],
));
body.push(spacer(190));
body.push(P('Kalau ragu, pakai Quick Walk-In. Data yang kurang bisa dilengkapi setelah ramai reda, dan itu jauh lebih baik daripada tamu yang tidak tercatat sama sekali.'));

body.push(H2('3.2 Jalan cepat: Quick Walk-In'));
body.push(P('Kotak ini ada di bagian atas Dashboard, dengan garis kuning di sisi kiri dan tulisan "Quick Walk-In".'));
body.push(...proc([
  'Klik kolom "Guest name" dan mulai ketik nama tamu.',
  'Perhatikan daftar kecil yang muncul setelah kamu mengetik dua huruf. Itu daftar tamu yang pernah datang. Kalau tamu ini ada di daftar, KLIK namanya. Nama dan nomor HP-nya akan terisi sendiri.',
  'Kalau tamu belum pernah datang, abaikan daftar itu dan lanjutkan mengetik nama lengkapnya.',
  'Klik kolom "Phone (optional)" dan isi nomor HP kalau tamu mau memberikannya. Boleh dilewati.',
  'Ubah angka di kolom kecil sebelah kanan menjadi jumlah orang. Angka bawaannya 1.',
  'Tekan Enter, atau klik tombol "Add".',
]));
body.push(...figure('03-quick-walkin', 'Kartu Quick Walk-In. 1 nama, 2 nomor HP, 3 jumlah orang, 4 tombol Add'));
body.push(P('Setelah tersimpan, muncul satu baris konfirmasi di bawah kotak, misalnya: "✓ Ibu Sinta (existing guest) — 4 pax, 19:05". Kolom akan kosong lagi dengan sendirinya, siap untuk tamu berikutnya.'));
body.push(...istilah([
  '"(existing guest)" berarti sistem memakai data tamu yang sudah ada. Bagus, riwayatnya nyambung.',
  '"(new guest)" berarti sistem membuat data tamu baru. Juga bagus, kalau memang tamunya baru.',
  '"(existing guest: nama lain)" berarti nomor HP yang kamu isi ternyata milik tamu lain. Baca poin berikutnya.',
]));
body.push(...jangan([
  'Kalau keterangannya menyebut nama tamu yang bukan orang di depanmu, berarti nomor HP itu salah atau dipakai orang lain. Hapus nomornya, simpan tanpa nomor, lalu beri tahu manager.',
  'Jangan mengubah nama tamu lama hanya karena ejaannya beda. Ketikan di kolom nama dipakai untuk MENCARI, bukan untuk mengoreksi data tamu.',
]));
body.push(P('Jam kunjungan dan tanggal terisi otomatis: jam saat kamu menekan tombol, dan tanggal hari ini. Tidak ada kolom untuk itu, dan itu memang tidak perlu.'));

body.push(H2('3.3 Jalan lengkap: tombol Walk-In'));
body.push(P('Klik tombol Walk-In di bagian atas Dashboard. Akan terbuka jendela berjudul "Register Walk-In".'));
body.push(...fields([
  ['Guest (kolom pencarian)', 'Ketik nama atau nomor HP tamu, lalu klik hasil yang benar. Kartu identitas tamu akan muncul di bawahnya sebagai tanda tamu sudah terpilih.', 'Ya'],
  ['Name (blok tamu baru)', 'Kalau tamu belum ada di sistem, isi nama lengkapnya di sini. Untuk balik ke pencarian, klik "Search existing guest".', 'Ya, kalau tamu baru'],
  ['Phone', 'Nomor HP tamu. Boleh dikosongkan.', 'Tidak'],
  ['Pax', 'Jumlah orang. Angka bawaannya 2, jangan lupa diubah.', 'Ya'],
  ['Pemilih meja', 'Klik meja yang akan dipakai. Meja yang sedang terpakai tampil tidak bisa diklik. Boleh pilih lebih dari satu untuk meja gabung.', 'Sebaiknya'],
  ['Area', 'Terisi sendiri mengikuti meja yang kamu pilih. Isi manual hanya kalau tamu belum diberi meja.', 'Tidak'],
  ['Notes', 'Permintaan khusus, alergi, atau pesan untuk kitchen.', 'Tidak'],
]));
body.push(...figure('03-register-walkin', 'Jendela Register Walk-In, nomor mengikuti tabel di atas'));
body.push(P('Setelah semua terisi, klik "Confirm Walk-In". Jendela tertutup dan tamu langsung muncul di daftar walk-in hari ini.'));

body.push(H2('3.4 Melengkapi data setelah ramai reda'));
body.push(P('Kalau tadi kamu pakai Quick Walk-In, meja dan area belum terisi. Lengkapi dari daftar walk-in.'));
body.push(...proc([
  'Buka menu "Walk-Ins" di sisi kiri, atau lihat bagian "Today\'s Walk-Ins" di Dashboard.',
  'Cari baris tamunya. Kolom yang ada: Time, Guest, Pax, Table, Area, Spend, dan Visits.',
  'Klik "Edit" pada baris itu.',
  'Isi meja, area, jumlah orang yang benar, atau catatan.',
  'Klik "Save Changes".',
]));
body.push(...figure('03-daftar-walkins', 'Daftar walk-in hari ini, dengan tombol Edit dan Complete di setiap baris'));
body.push(...ingat([
  'Kolom "Visits" menunjukkan sudah berapa kali tamu itu makan di sini. Angka besar berarti tamu langganan, layak disapa lebih hangat.',
  'Kolom "Spend" masih kosong sampai kunjungan diselesaikan di langkah berikutnya.',
]));

body.push(H2('3.5 Menyelesaikan kunjungan'));
body.push(P('Dilakukan setelah tamu selesai makan dan membayar. Ini langkah yang paling sering terlupa, dan yang paling penting.'));
body.push(...proc([
  'Cari baris tamunya di daftar walk-in, lalu klik "Complete".',
  'Isi "Spend Amount (Rp)" dengan total belanja tamu. Ketik angkanya saja, misalnya 450000. Kolom ini WAJIB.',
  'Isi "What did they order?" kalau kamu tahu pesanannya, misalnya "Nasi Goreng, Es Teh Manis". Boleh dikosongkan.',
  'Centang kotak di bawahnya kalau pesanan itu ingin disimpan sebagai menu favorit tamu. Di sebelahnya tertulis favorit yang tersimpan sekarang, jadi kamu tahu apa yang akan tergantikan.',
  'Isi "Notes" kalau ada hal yang perlu diingat tentang kunjungan ini.',
  'Klik tombol simpan.',
]));
body.push(...figure('03-complete-modal', 'Jendela penyelesaian. 1 jumlah belanja, 2 pesanan, 3 catatan'));
body.push(P('Status kunjungan berubah menjadi Done, dan barisnya pindah ke bawah daftar. Selesai.'));
body.push(...jangan([
  'Jangan mengarang angka belanja. Kalau kamu benar-benar tidak tahu, tanya kasir dulu.',
  'Jangan meninggalkan walk-in dalam keadaan Active sampai besok. Di akhir shift, pastikan semua baris sudah Done.',
]));
body.push(...salah([
  'Angka belanja salah: klik "Complete" lagi pada baris yang sama. Kolomnya akan terisi angka sebelumnya, dan kamu bisa memperbaikinya.',
  'Tamu atau pax salah total: klik "Edit" dan perbaiki.',
  'Barisnya memang tidak seharusnya ada, misalnya dobel: itu harus di-void oleh manager. Kamu tidak bisa menghapusnya, dan itu memang disengaja supaya laporan tidak berubah tanpa jejak.',
]));

body.push(H2('3.6 Daftar periksa cara 1'));
body.push(...bullets([
  'Nama tamu tercatat, dan kalau dia tamu lama, dipilih dari daftar bukan diketik ulang.',
  'Jumlah orang benar.',
  'Meja dan area terisi, walaupun mungkin dilengkapi belakangan.',
  'Belanja terisi dan status sudah Done sebelum shift berakhir.',
]));

// ═══════════════════ BAB 4 ═══════════════════
body.push(H1('4. Cara 2: Reservasi dari Dashboard'));
body.push(P('Dipakai ketika tamu memesan tempat lewat telepon, WhatsApp, Instagram, atau datang langsung untuk booking, dan kamu yang mencatatnya.'));
body.push(...flow(['Catat reservasinya', 'Hari H: tekan Arrived', 'Tamu selesai makan', 'Completed, isi belanja']));
body.push(...ingat([
  'Langkah 2 tidak boleh dilewati. Reservasi yang tamunya datang tetapi tidak pernah ditekan "Arrived" akan dianggap tidak pernah datang oleh semua laporan.',
]));

body.push(H2('4.1 Membuka formulir'));
body.push(P('Klik tombol reservasi baru di bagian atas Dashboard. Terbuka jendela berjudul "New Reservation".'));
body.push(P('Perhatikan: seluruh bagian bawah formulir masih abu-abu dan tidak bisa diisi. Itu normal. Ada keterangan "Pick a guest above, or create a new one, to fill in the rest". Pilih tamunya dulu, sisanya baru terbuka.'));

body.push(H2('4.2 Mengisi data tamu'));
body.push(...proc([
  'Ketik nama atau nomor HP tamu di kolom "Guest".',
  'Kalau tamu muncul di daftar hasil, klik namanya. Bagian bawah formulir langsung aktif.',
  'Kalau tamu belum ada, isi "Name" dan "Phone" pada blok tamu baru di bawahnya.',
]));
body.push(...ingat([
  'Selalu cari dulu sebelum membuat tamu baru. Kalau kamu membuat data baru untuk tamu yang sudah ada, riwayat kunjungannya terpecah jadi dua dan dia tidak lagi terlihat sebagai langganan.',
]));

body.push(H2('4.3 Mengisi detail reservasi'));
body.push(...fields([
  ['Date', 'Tanggal tamu akan datang. Klik dan pilih dari kalender.', 'Ya'],
  ['Time', 'Jam tamu akan datang. Format 24 jam, misalnya 19:00.', 'Ya'],
  ['Pax', 'Jumlah orang.', 'Ya'],
  ['Area', 'Area tempat tamu akan duduk. Kalau kamu sudah memilih meja, kolom ini terisi sendiri.', 'Sebaiknya'],
  ['Pemilih meja', 'Meja yang akan disiapkan. Meja yang sudah dipakai reservasi lain di jam itu tampil tidak bisa diklik.', 'Sebaiknya'],
  ['Occasion', 'Acaranya, misalnya Birthday atau Business Dinner. Berguna untuk penyambutan.', 'Tidak'],
  ['Status', 'Biarkan apa adanya untuk reservasi biasa. Sistem yang mengurus ini.', 'Tidak'],
  ['Reservation Source', 'Dari mana reservasi ini datang: WhatsApp, Phone Call, Instagram, Referral, dan seterusnya. Kalau tidak ada di daftar, pilih "Other (type below)" lalu tuliskan.', 'Ya, isi selalu'],
  ['Notes', 'Permintaan khusus, alergi, kursi bayi, dan sejenisnya.', 'Tidak'],
]));
body.push(...figure('04-reservasi-baru', 'Formulir New Reservation, nomor mengikuti tabel di atas'));
body.push(...ingat([
  '"Reservation Source" kelihatan sepele tapi selalu diisi. Dari kolom itu restoran tahu kanal mana yang benar-benar mendatangkan tamu, dan itu menentukan ke mana biaya promosi pergi.',
]));

body.push(H3('Bagian jam dan durasi, boleh dilewati untuk reservasi biasa'));
body.push(P('Di tengah formulir ada beberapa kolom tentang waktu yang terdengar rumit. Untuk reservasi makan malam biasa, biarkan saja apa adanya. Ini penjelasannya kalau suatu saat kamu butuh.'));
body.push(...fields([
  ['Reservation hours, from dan to', 'Jam mulai dan jam selesai, untuk acara yang sudah pasti jadwalnya. Wajib diisi kalau kamu mencentang "Reserve entire area".', 'Tidak'],
  ['Expected duration if no end time (minutes)', 'Perkiraan lama tamu duduk kalau jam selesai tidak diisi. Bawaannya 180 menit, yaitu 3 jam.', 'Tidak'],
  ['Buffer before event (minutes)', 'Waktu persiapan sebelum tamu datang, misalnya 30 menit untuk menata dekorasi. Selama waktu itu meja dihitung sudah terpakai.', 'Tidak'],
  ['Reserve entire area', 'Centang hanya untuk acara yang memakai SELURUH area secara eksklusif, misalnya gathering perusahaan. Jangan dicentang untuk reservasi biasa.', 'Tidak'],
]));

body.push(H2('4.4 Kalau muncul panel "Request deposit"'));
body.push(P('Pada sebagian area, atau kalau jumlah pax besar, akan muncul panel berisi centang "Request deposit" dan kolom jumlah rupiah. Panel ini bisa terisi dan tercentang dengan sendirinya.'));
body.push(...istilah([
  'Deposit atau DP adalah uang jaminan yang dibayar tamu di depan supaya mejanya ditahan.',
]));
body.push(P('Yang perlu kamu tahu sebagai staf baru:'));
body.push(...bullets([
  'Kalau panel itu tercentang, kolom Status akan terkunci. Itu normal, jangan dipaksa diubah.',
  'Kalau jumlahnya sudah terisi otomatis, biarkan saja kecuali manager bilang lain.',
  'Kalau jumlahnya KOSONG dan tidak bisa disimpan, berarti ini party besar yang harganya harus dibicarakan dulu dengan tamu. Jangan mengarang angka. Tanyakan ke manager.',
  'Kalau tamu tidak perlu DP sama sekali, hilangkan centangnya.',
]));
body.push(...figure('04-panel-deposit', 'Panel Request deposit. 1 centang permintaan DP, 2 jumlahnya'));
body.push(P('Penanganan DP selanjutnya, mulai dari mengirim tagihan sampai mencatat pembayaran, ada di manual pelatihan yang lengkap. Untuk sekarang cukup tahu bahwa reservasi berDP tidak langsung pasti sampai uangnya masuk.'));

body.push(H2('4.5 Menyimpan'));
body.push(P('Klik "Save Reservation" di bagian paling bawah formulir. Reservasi akan muncul di bagian "Upcoming Reservations" pada Dashboard, di tab tanggal yang sesuai.'));
body.push(...salah([
  'Ada yang salah setelah tersimpan? Buka reservasinya dari daftar, lalu pilih "Edit Full Details" untuk membuka kembali formulir yang sama.',
]));

body.push(H2('4.6 Hari H: saat tamu datang'));
body.push(...proc([
  'Buka Dashboard, lihat bagian "Upcoming Reservations", tab "Today".',
  'Cari baris tamunya dan klik barisnya untuk membuka jendela "Update Reservation".',
  'Klik tombol "Arrived".',
]));
body.push(...figure('04-update-reservasi', 'Jendela Update Reservation, tempat tombol Arrived dan Completed berada'));
body.push(...ingat([
  'Detik kamu menekan "Arrived", sistem membuat catatan kunjungan. Itulah yang membuat tamu ini terhitung sebagai orang yang benar-benar datang.',
  'Tekan saat tamu benar-benar duduk, bukan saat kamu sempat. Jam kedatangan diambil dari saat tombol ditekan.',
]));

body.push(H2('4.7 Saat tamu selesai'));
body.push(...proc([
  'Buka reservasinya lagi.',
  'Klik tombol "Completed".',
  'Isi "Spend Amount (Rp)" dengan total belanja.',
  'Isi pesanan dan catatan kalau perlu, sama seperti walk-in.',
  'Klik simpan.',
]));

body.push(H2('4.8 Kalau tamu tidak datang'));
body.push(P('Ini bagian yang paling sering dikerjakan salah oleh staf baru, jadi baca dengan teliti.'));
body.push(P('Kalau kamu menekan "Completed" pada reservasi yang tidak pernah ditekan "Arrived", akan muncul pertanyaan: apakah tamu ini datang? Ada dua pilihan, dan salah satunya HARUS dipilih.'));
body.push(spacer(80));
body.push(table(
  ['Pilihanmu', 'Yang terjadi', 'Pakai kalau'],
  [
    ['Ya, datang', 'Sistem membuat catatan kunjungan, lalu meminta jumlah belanja seperti biasa.', 'Tamu memang datang, hanya tombol Arrived-nya terlewat ditekan.'],
    ['Tidak datang', 'Reservasi ditandai "Cancelled (No Show)". Tidak ada jumlah belanja yang diminta.', 'Tamu benar-benar tidak muncul.'],
  ],
  [1800, 4400, 3160],
));
body.push(spacer(190));
body.push(...jangan([
  'Jangan menandai reservasi sebagai selesai untuk tamu yang tidak datang. Di restoran lain hal ini terjadi 15 kali dalam beberapa bulan, 91 orang yang dianggap datang padahal tidak, dan laporan omzet ikut salah.',
  'Jangan mengisi angka belanja karangan hanya supaya tombol simpan bisa ditekan. Pilih "tidak datang", dan sistem tidak akan meminta angka apa pun.',
]));

body.push(H2('4.9 Daftar periksa cara 2'));
body.push(...bullets([
  'Tamu dicari dulu di database sebelum dibuat baru.',
  'Tanggal, jam, dan jumlah orang benar.',
  'Reservation Source terisi.',
  '"Arrived" ditekan saat tamu tiba.',
  '"Completed" dan jumlah belanja diisi setelah tamu pulang, atau ditandai no show dengan jujur.',
]));

// ═══════════════════ BAB 5 ═══════════════════
body.push(H1('5. Cara 3: Reservasi dari Form Online'));
body.push(P('Restoran punya halaman reservasi di internet. Tamu mengisi sendiri dari HP-nya, dan datanya langsung masuk ke sistem tanpa kamu mengetik apa pun. Tugasmu di sini bukan mencatat, tetapi menindaklanjuti.'));
body.push(...flow(['Tamu memesan sendiri', 'Kamu follow up lewat WhatsApp', 'Hari H: tekan Arrived', 'Completed, isi belanja']));

body.push(H2('5.1 Reservasi online tidak selalu berarti sudah pasti'));
body.push(P('Ketika tamu selesai mengisi form, sistem memutuskan sendiri salah satu dari tiga keadaan. Kamu perlu bisa membedakannya, karena tindakanmu berbeda.'));
body.push(spacer(80));
body.push(table(
  ['Status', 'Artinya', 'Yang kamu lakukan'],
  [
    ['Reserved', 'Sudah pasti. Meja aman. Tamu tidak perlu bayar apa pun di depan.', 'Cukup follow up dan ingatkan jamnya.'],
    ['Incoming', 'Butuh DP. Meja ditahan, tetapi baru pasti setelah uangnya masuk.', 'Kirim tagihan DP, lalu catat pembayarannya. Lihat manual lengkap.'],
    ['Waitlist', 'Belum diputuskan. Party-nya terlalu besar, terlalu kecil untuk area itu, atau areanya penuh. MEJA BELUM DITAHAN.', 'Hubungi tamu dan tentukan. Jangan didiamkan.'],
  ],
  [1700, 4300, 3360],
));
body.push(spacer(190));
body.push(...figure('05-form-online-terisi', 'Form reservasi online, seperti yang dilihat tamu di HP-nya'));
body.push(...jangan([
  'Jangan menganggap semua reservasi online sudah pasti. Tamu berstatus Waitlist sudah diberi tahu di halaman konfirmasi bahwa reservasinya BELUM dikonfirmasi dan diminta tidak datang sebelum dihubungi. Kalau kamu diam saja, tamu itu menunggu kabar yang tidak pernah datang.',
]));

body.push(H2('5.2 Tiga tempat melihat reservasi online'));
body.push(spacer(80));
body.push(table(
  ['Tempat', 'Gunanya'],
  [
    ['Bel notifikasi', 'Angka merah di bel menandakan ada reservasi online yang belum ditindaklanjuti siapa pun. Buka ini setiap mulai shift.'],
    ['Dashboard, tab "Online form"', 'Semua reservasi online untuk 14 hari ke depan, dalam satu tab di bagian Upcoming Reservations.'],
    ['Halaman Reservations', 'Daftar lengkap, bisa dicari dan difilter. Ini tempat kerja utama untuk reservasi online.'],
  ],
  [2500, 6860],
));
body.push(spacer(190));

body.push(H2('5.3 Memakai halaman Reservations'));
body.push(P('Buka menu "Reservations" di sisi kiri. Ini alat yang tersedia di atas daftar.'));
body.push(...fields([
  ['Kolom pencarian', 'Cari tamu dengan nama atau nomor HP. Berguna kalau tamu menelepon menanyakan reservasinya.', 'Tidak'],
  ['Pilihan tanggal', 'Lihat satu tanggal, atau ubah ke mode rentang untuk melihat beberapa hari sekaligus.', 'Tidak'],
  ['Online form only', 'Nyalakan ini untuk menyembunyikan semua reservasi yang dicatat staf, sehingga tinggal yang datang dari form online.', 'Tidak'],
  ['Tombol status', 'All, Reserved, Waitlist, Incoming, Arrived, Completed, Cancelled, No Show, Deleted. Klik untuk menyaring.', 'Tidak'],
  ['Run Sheet', 'Membuka lembar kerja harian untuk dicetak. Isinya mengikuti data terbaru setiap kali dibuka atau dicetak ulang.', 'Tidak'],
  ['Export Excel', 'Mengunduh daftar menjadi file Excel.', 'Tidak'],
]));
body.push(...figure('05-halaman-reservations', 'Halaman Reservations. 1 pencarian, 2 tanggal, 3 Online form only'));
body.push(P('Setiap baris punya kolom: Time, Guest & booking, Seating, Status & deposit, dan Actions. Klik barisnya untuk membuka jendela "Update Reservation", tempat semua tombol tindakan berada.'));
body.push(...ingat([
  'Cara paling cepat memeriksa pekerjaan yang tertinggal: buka Reservations, nyalakan "Online form only", lalu klik status "Waitlist" dan "Incoming". Yang muncul adalah daftar tamu yang sedang menunggu kabar darimu.',
]));

body.push(H2('5.4 Menindaklanjuti reservasi online'));
body.push(...proc([
  'Buka bel notifikasi dan lihat reservasi online yang belum ditangani.',
  'Buka reservasinya, periksa statusnya lebih dulu memakai tabel di bagian 5.1.',
  'Hubungi tamu lewat WhatsApp: pastikan pesanannya, tanyakan kebutuhan khusus, dan ingatkan jamnya. Untuk Waitlist, sampaikan keputusan restoran.',
  'Tetapkan meja kalau belum ada: pilih area dan meja di jendela yang sama, lalu klik "Save tables and availability".',
  'Kalau tamu perlu bukti, klik "Terbitkan tiket". Sistem membuat satu tautan berisi nama, tanggal, jam, jumlah orang, dan area, yang bisa kamu kirim ke tamu.',
  'Setelah benar-benar dihubungi, centang tanda follow-up pada daftar bel.',
]));
body.push(...ingat([
  'Bel akan terus menyala sampai ada yang mencentangnya. Itu memang disengaja: pernah ada satu reservasi online yang tidak tersentuh selama 17 hari karena belnya berhenti terlalu cepat.',
  'Membuka jendela WhatsApp tidak otomatis mencentang follow-up. Jendela terbuka bukan berarti pesan terkirim.',
  '"Terbitkan tiket" hanya bisa untuk reservasi yang sudah berstatus Reserved. Menerbitkannya dua kali memakai tautan yang sama, jadi jangan takut mengulang.',
]));

body.push(H2('5.5 Hari H dan penyelesaian'));
body.push(P('Dari titik ini, reservasi online tidak berbeda sama sekali dengan reservasi yang kamu catat sendiri. Tekan "Arrived" saat tamu tiba, lalu "Completed" dan isi belanjanya saat tamu selesai. Lihat bagian 4.6 sampai 4.8.'));

body.push(H2('5.6 Daftar periksa cara 3'));
body.push(...bullets([
  'Bel notifikasi dibuka setiap awal shift.',
  'Status setiap reservasi online diperiksa: Reserved, Incoming, atau Waitlist.',
  'Tamu dihubungi lewat WhatsApp, dan tanda follow-up dicentang setelahnya.',
  'Tidak ada Waitlist yang menginap tanpa kabar.',
  '"Arrived" dan "Completed" dikerjakan seperti reservasi biasa.',
]));

// ═══════════════════ BAB 6 ═══════════════════
body.push(H1('6. Kartu Contekan'));

body.push(H2('6.1 Situasi dan tindakan'));
body.push(spacer(80));
body.push(table(
  ['Situasinya', 'Yang kamu lakukan'],
  [
    ['Tamu masuk tanpa pesan, restoran ramai', 'Quick Walk-In di Dashboard: nama, HP, pax, Enter.'],
    ['Tamu masuk tanpa pesan, restoran sepi', 'Tombol Walk-In, isi lengkap sekalian dengan meja.'],
    ['Tamu menelepon untuk pesan tempat', 'Tombol reservasi baru di Dashboard, isi formulir, Save Reservation.'],
    ['Tamu reservasi tiba di restoran', 'Buka reservasinya, klik "Arrived".'],
    ['Tamu selesai makan dan membayar', 'Klik "Complete" atau "Completed", isi jumlah belanja.'],
    ['Tamu reservasi tidak muncul', 'Klik "Completed", jawab "tidak datang". Jangan isi belanja.'],
    ['Ada reservasi online masuk', 'Buka bel, periksa statusnya, hubungi tamu lewat WhatsApp, centang follow-up.'],
    ['Reservasi online berstatus Waitlist', 'Hubungi tamu hari itu juga. Mejanya belum ditahan.'],
    ['Salah isi angka belanja', 'Klik Complete lagi pada baris yang sama, perbaiki angkanya.'],
    ['Baris tidak seharusnya ada', 'Panggil manager. Kamu tidak bisa menghapus, dan itu memang disengaja.'],
  ],
  [3600, 5760],
));
body.push(spacer(190));

body.push(H2('6.2 Arti status reservasi'));
body.push(spacer(80));
body.push(table(
  ['Status', 'Arti singkat', 'Meja ditahan?'],
  [
    ['Incoming', 'Menunggu DP masuk', 'Ya'],
    ['Waitlist', 'Menunggu keputusan staf', 'Tidak'],
    ['Reserved', 'Sudah pasti', 'Ya'],
    ['Arrived', 'Tamu sudah datang', 'Ya'],
    ['Completed', 'Selesai, belanja tercatat', 'Tidak lagi'],
    ['Cancelled', 'Tamu membatalkan', 'Tidak'],
    ['Cancelled (No Show)', 'Tamu tidak muncul', 'Tidak'],
  ],
  [2200, 5460, 1700],
));
body.push(spacer(190));

body.push(H2('6.3 Lima kesalahan yang paling sering dilakukan staf baru'));
body.push(...proc([
  'Membuat data tamu baru padahal tamunya sudah ada. Selalu cari dulu, dan klik hasil pencariannya.',
  'Lupa menekan "Arrived" saat tamu reservasi tiba. Laporan akan menganggap tamu itu tidak pernah datang.',
  'Menandai reservasi selesai untuk tamu yang tidak datang. Jawab "tidak datang" dengan jujur.',
  'Meninggalkan walk-in tanpa jumlah belanja sampai besok. Selesaikan semua sebelum shift berakhir.',
  'Mendiamkan reservasi online berstatus Waitlist. Tamu itu sedang menunggu kabar, dan mejanya belum aman.',
]));

body.push(new Paragraph({ spacing: { before: 460, after: 0 },
  children: [new TextRun({ text: 'Kalau ada langkah di panduan ini yang tidak cocok dengan yang kamu lihat di layar, beri tahu manager. Aplikasi ini sering diperbarui, dan panduan harus ikut diperbarui.', size: 20, italics: true, color: GREY })] }));

// ── Document ──
const doc = new Document({
  creator: 'Intoch',
  title: 'Panduan Dasar Intoch untuk Staf Baru',
  description: 'Tiga cara mencatat kunjungan tamu, dari nama tamu sampai kunjungan selesai',
  styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
  numbering: {
    config: [
      { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } } }] },
      { reference: 'dots', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } } }] },
    ],
  },
  sections: [{
    properties: { page: { margin: { top: 1200, bottom: 1200, left: 1080, right: 1080 } } },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Intoch GMS · Panduan Dasar untuk Staf Baru · ', size: 17, color: GREY }),
          new TextRun({ children: [PageNumber.CURRENT], size: 17, color: GREY }),
        ] })] }),
    },
    children: body,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('/home/claude/manual/Panduan_Dasar_Intoch_Staf_Baru.docx', buf);
  console.log('written', buf.length, 'bytes');
});
