// Builds the four role manuals from one set of shared chapters, so every file
// looks identical and only its content differs. Screenshots come from
// ../screens by fixed name; a missing file drops its figure silently.
const K = require('./manual-kit.js');
const {
  fs, path, INK, ACC, GREY,
  P, H1, H2, H3, proc, tutorial, bullets, fields, table, flow,
  istilah, ingat, jangan, salah, spacer, figure, resetFigures,
  Document, Packer, Paragraph, TextRun, AlignmentType, LevelFormat, Footer,
  PageNumber, convertInchesToTwip,
} = K;

const VERSION = 'Versi 2.0  ·  13 September 2026';
const PAGES = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'toc-pages.json'), 'utf8')); }
  catch { return {}; }
})();

// ── Cover + table of contents ───────────────────────────────────────────
function cover(title, subtitle, note) {
  return [
    new Paragraph({ spacing: { before: 2400, after: 0 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'INTOCH', size: 56, bold: true, color: INK, characterSpacing: 60 })] }),
    new Paragraph({ spacing: { before: 120, after: 620 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Guest Management System', size: 24, color: ACC, allCaps: true, characterSpacing: 40 })] }),
    new Paragraph({ spacing: { after: 140 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, size: 40, bold: true, color: INK })] }),
    new Paragraph({ spacing: { after: 120 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: subtitle, size: 23, color: GREY })] }),
    new Paragraph({ spacing: { after: 880 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: note, size: 20, color: ACC, italics: true })] }),
    new Paragraph({ spacing: { after: 60 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: VERSION, size: 20, color: GREY })] }),
    new Paragraph({ spacing: { after: 0 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Dokumen internal. Mohon tidak dibagikan ke luar restoran.', size: 19, color: GREY, italics: true })] }),
  ];
}

function toc(key, chapters) {
  const pages = PAGES[key] || {};
  return [
    new Paragraph({ pageBreakBefore: true, spacing: { after: 240 },
      children: [new TextRun({ text: 'Daftar Isi', size: 32, bold: true, color: INK })] }),
    ...chapters.map(t => new Paragraph({
      spacing: { after: 120, line: 288 },
      tabStops: [{ type: 'right', position: 9000, leader: 'dot' }],
      children: [
        new TextRun({ text: t, size: 21 }),
        new TextRun({ text: '\t' + (pages[t] || ''), size: 21 }),
      ],
    })),
  ];
}

// ── Shared chapters ─────────────────────────────────────────────────────
function chapterBasics(n) {
  return [
    H1(n + '. Mengenal Intoch dalam Lima Menit'),
    P('Intoch mencatat siapa yang makan di restoran ini, kapan, berapa orang, dan berapa belanjanya. Semua fitur lain dibangun di atas catatan itu.'),
    H2(n + '.1 Tiga kata yang dipakai terus'),
    ...istilah([
      'TAMU (guest): orangnya. Satu data permanen: nama, nomor HP, riwayat kunjungan.',
      'KUNJUNGAN (visit): satu kali tamu itu makan di sini. Satu tamu bisa punya banyak kunjungan.',
      'RESERVASI (reservation): janji bahwa tamu akan datang. Belum tentu jadi kunjungan, karena tamu bisa tidak muncul.',
    ]),
    H2(n + '.2 Tiga cara kunjungan masuk ke sistem'),
    spacer(70),
    table(['Cara', 'Situasinya', 'Dikerjakan di'], [
      ['Walk-in', 'Tamu datang tanpa pesan lebih dulu', 'Dashboard'],
      ['Reservasi oleh staf', 'Tamu telepon atau WhatsApp, staf yang mencatat', 'Dashboard'],
      ['Reservasi online', 'Tamu memesan sendiri lewat form di internet', 'Halaman Reservations'],
    ], [1800, 5200, 2360]),
    spacer(180),
    H2(n + '.3 Satu aturan yang membuat semuanya masuk akal'),
    ...ingat([
      'Reservasi yang tamunya datang TIDAK otomatis menjadi kunjungan. Seseorang harus menekan "Arrived" saat tamu tiba. Itulah detik ketika sistem mencatat bahwa orang ini benar-benar datang.',
      'Di akhir, jumlah belanja harus diisi. Dari angka itulah laporan omzet, riwayat tamu, dan sticker membership dihitung.',
    ]),
    ...flow(['Catat tamunya', 'Tamu datang', 'Tamu selesai makan', 'Isi belanja, selesai']),
  ];
}

function chapterLogin(n, roleName, menuRows, sidebarFigure, extra = []) {
  return [
    H1(n + '. Login dan Layar Kamu'),
    H2(n + '.1 Masuk ke aplikasi'),
    ...proc([
      'Buka aplikasi Intoch di browser.',
      'Isi Username, huruf kecil semua, tanpa spasi.',
      'Isi PIN 4 angka milikmu.',
      'Tekan Enter.',
    ]),
    ...figure('02-login', 'Layar login. 1 username, 2 PIN empat angka'),
    P('Kalau muncul tulisan merah, username atau PIN salah. Kalau tetap gagal, hubungi Admin: bisa jadi akunmu belum aktif.'),
    ...jangan([
      'Jangan memakai akun orang lain dan jangan memberikan PIN-mu. Semua perubahan data tercatat atas nama pemilik PIN yang login.',
      'Setelah aplikasi diperbarui, semua orang wajib login ulang. Sesi lama sengaja ditolak.',
    ]),
    H2(n + '.2 Menu yang kamu lihat sebagai ' + roleName),
    spacer(70),
    table(['Menu', 'Isinya'], menuRows, [2400, 6960]),
    spacer(180),
    ...figure(sidebarFigure, 'Menu di sisi kiri untuk akun ' + roleName + '. Nama dan peranmu tertulis di bawah'),
    ...extra,
  ];
}

// Deposit policy, explained from the angle each role needs.
function chapterDepositPolicy(n, angle) {
  let sub = 0;
  const S = () => n + '.' + (++sub) + ' ';
  const head = [
    H1(n + '. Fitur Deposit'),
    P('Deposit adalah uang muka yang dibayar tamu sebelum hari kunjungan, supaya mejanya benar-benar ditahan. Tidak semua reservasi memerlukannya. Yang menentukan perlu atau tidak, dan berapa, adalah satu pengaturan restoran yang dijelaskan di bawah ini.'),
    H2(S() + 'Dua Cara Menentukan Deposit'),
    P('Sejak September 2026 restoran memilih SATU dari dua cara menentukan deposit. Pilihannya ada di Settings, bagian Reservation Form, pada kolom "Deposit basis". Seluruh aplikasi mengikuti pilihan itu.'),
    spacer(70),
    table(['', 'By area (berdasarkan area)', 'By guest count (berdasarkan jumlah tamu)'], [
      ['Angkanya dari mana', 'Nilai deposit yang disimpan pada tiap area. Tetap sama sampai diubah.', 'Tidak ada angka otomatis. Staf mengisi jumlah yang disepakati dengan tamu.'],
      ['Kapan deposit diminta', 'Kalau area itu punya nilai deposit', 'Kalau jumlah tamu melewati batas "No deposit up to"'],
      ['Status reservasi', 'Incoming', 'Incoming, atau Waitlist kalau di atas batas reservasi biasa'],
      ['Jatuh tempo otomatis', 'Ya, pada jam reservasi itu sendiri', 'Tidak ada'],
      ['Jenis invoice', 'Invoice sederhana', 'Sederhana atau rinci, dipilih staf'],
    ], [1900, 3730, 3730]),
    spacer(180),
    ...ingat([
      'Pada mode jumlah tamu, deposit BUKAN harga per orang dikali jumlah tamu. Sistem tidak pernah mengalikan apa pun. Angkanya selalu hasil kesepakatan dengan tamu, diketik oleh staf.',
    ]),

    H2(S() + 'Yang Dilihat Tamu di Form Online'),
    P('Pilihan tadi mengubah satu panel kecil di form online, tepat di bawah pilihan area. Panel itu yang membuat tamu tahu apakah dia perlu bayar di muka atau tidak. Bentuknya berbeda untuk tiap mode, dan perbedaan ini yang paling sering ditanyakan tamu.'),

    H3('Mode by area: angkanya langsung terlihat'),
    P('Tamu melihat baris "Deposit (DP)" beserta nominalnya, diambil dari nilai deposit area yang dia pilih. Tamu sudah tahu berapa yang harus ditransfer bahkan sebelum menekan Reserve Now. Kalau tamu berpindah area, angkanya ikut berubah.'),
    ...figure('05-form-online-dp-area', 'Mode by area. Baris "Deposit (DP)" menampilkan nominal yang diambil dari area yang dipilih tamu'),

    H3('Mode by guest count: angkanya tidak ditampilkan'),
    P('Tidak ada nominal sama sekali. Yang muncul hanya kalimat "A deposit is required to confirm your reservation" dan keterangan bahwa staf akan menghubungi tamu untuk jumlah dan cara pembayarannya. Ini disengaja: pada mode ini angkanya belum ada sampai staf dan tamu menyepakatinya, jadi sistem tidak boleh menebak.'),
    ...figure('05-form-online-dp-pax', 'Mode by guest count. Tidak ada nominal DP, hanya pemberitahuan bahwa staf akan menghubungi tamu'),
    ...ingat([
      'Kalau jumlah tamu masih di bawah batas "No deposit up to", panel ini tidak menampilkan pemberitahuan deposit sama sekali. Tamu memang tidak diminta DP.',
      'Konsekuensinya untuk staf: pada mode by guest count, tamu datang ke percakapan WhatsApp TANPA tahu angkanya. Sebutkan nominalnya dengan jelas saat follow up, jangan berasumsi tamu sudah membacanya di form.',
    ]),
  ];
  return head.concat(angle(n, S));
}

function chapterLargeParty(n, forRole) {
  return [
    H1(n + '. Party Besar dan Pilihan Format Invoice'),
    P('Kalau jumlah tamu melewati batas "Regular booking up to", reservasi itu tidak diperlakukan seperti reservasi biasa. Statusnya menjadi Waitlist, dan ada satu keputusan tambahan yang harus diambil manusia: format invoicenya.'),
    ...figure('deposit-large-party', 'Panel party besar di jendela Update Reservation: pilih format, lihat jumlah tamu, isi angka yang disepakati'),
    H2(n + '.1 Urutannya'),
    ...proc([
      'Hubungi tamu lebih dulu. Sepakati jumlah tamu sebenarnya, jam, area, dan berapa yang harus dibayar di muka.',
      'Pilih "Invoice format" pada panel kuning: Simple deposit atau Detailed invoice.',
      'Isi "Agreed amount" dengan angka yang disepakati.',
      'Klik "Save amount".',
      'Tetapkan meja dan jam, lalu klik "Save tables and availability".',
      'Kirim invoicenya lewat tombol "Invoice & WhatsApp", lalu catat pembayaran begitu uangnya masuk.',
    ]),
    H2(n + '.2 Simple atau Detailed'),
    spacer(70),
    table(['Format', 'Isinya', 'Pakai kalau'], [
      ['Simple deposit', 'Satu angka yang disepakati, tanpa rincian item', 'Acara sederhana, tamu hanya perlu tahu berapa yang harus ditransfer'],
      ['Detailed invoice', 'Rincian item, deposit, dan pelunasan', 'Acara besar dengan menu dan biaya yang perlu dirinci, dan dibayar lebih dari sekali'],
    ], [1900, 3600, 3860]),
    spacer(180),
    ...figure('modal-deposit-format', 'Jendela pilihan format invoice, muncul saat invoice pertama dibuat untuk party besar'),
    ...warnLargeParty(forRole),
  ];
}

// The online-form flow, told as one sequence from the guest's tap to a
// confirmed booking. Statuses are explained AFTER the steps, because the
// steps are what a new reader actually needs first.
function chapterOnlineFlow(n, forRole, opts = {}) {
  const depositRef = opts.depositRef || 'bab Fitur Deposit';
  let sub = 0;
  const S = () => n + '.' + (++sub) + ' ';
  const who = forRole === 'finance' ? 'kamu' : 'kamu';
  return [
    H1(n + '. ' + (opts.title || 'Reservasi dari Form Online')),
    P('Ini satu-satunya jenis reservasi yang tidak ' + who + ' ketik sendiri. Tamu yang mengisinya, dan tugasmu adalah menindaklanjuti. Empat langkah berikut dikerjakan berurutan.'),
    ...flow(['Tamu mengisi form', 'Waitlist: waive atau ajukan DP', 'DP masuk, catat', 'Reserved']),

    H2(S() + 'Langkah demi langkah'),
    ...tutorial([
      {
        lead: 'Tamu mengisi form sendiri.',
        text: 'Reservasi lewat form online datang langsung dari tamu. Dari HP-nya, tamu mengisi nama, nomor HP, jumlah orang, area, tanggal, dan jam. Pada langkah ini kamu tidak mengetik apa pun.',
        fig: ['05-form-online-netral', 'Form yang dilihat tamu, sebelum area dipilih. Panel informasi baru muncul setelah tamu memilih area'],
        after: ingat([
          'Setelah tamu memilih area, muncul panel kecil berisi minimum tamu dan minimum belanja. Panel ini BISA menampilkan perkiraan DP, bisa juga tidak, tergantung setting deposit yang dipakai restoran. Dua kemungkinannya dijelaskan lengkap dengan gambar di ' + depositRef + '.',
          'Artinya kamu tidak boleh berasumsi tamu sudah tahu angka DP-nya. Periksa dulu setting mana yang sedang aktif sebelum follow up.',
        ]),
      },
      {
        lead: 'Reservasi muncul di Deposit queue dengan status Waitlist.',
        text: 'Buka Dashboard, lalu tab "Deposit queue". Reservasi yang baru masuk ada di sana, menunggu dikonfirmasi dan diputuskan DP-nya. Ada dua kemungkinan. Kalau DP tidak diperlukan, klik tombol "Waive" dan status booking langsung menjadi Reserved. Kalau DP diperlukan, isi nominal DP sesuai jumlah yang disepakati bersama tamu, lalu klik tombol "Invoice & WhatsApp" untuk mengajukan DP. Pada tahap ini status booking menjadi Incoming.',
        fig: ['finance-deposit-queue', 'Tab Deposit queue di Dashboard. Tiap baris menunjukkan status dan keterangan pembayarannya'],
        after: ingat([
          'Kalau restoran memakai mode area, nominal DP sudah terisi sendiri dari nilai area dan reservasinya biasanya langsung berstatus Incoming. Yang perlu kamu lakukan tinggal mengirim tagihannya.',
          'Tombol "Invoice & WhatsApp" mengerjakan dua hal sekaligus: membuat invoice dan membuka WhatsApp. Pesannya harus benar-benar dikirim, bukan sekadar menutup tab.',
        ]),
      },
      {
        lead: 'DP diterima, catat pembayarannya.',
        text: 'Begitu uang DP masuk, buka reservasinya dan klik tombol "Record payment". Isi jumlah yang benar-benar diterima, lalu simpan. Status booking berubah menjadi Reserved dan mejanya aman.',
        after: ingat([
          'Kalau yang masuk baru sebagian, statusnya tetap Incoming sampai kekurangannya dilunasi, dan jatuh temponya tidak bergeser.',
        ]),
      },
      {
        lead: 'Centang notifikasinya.',
        text: 'Icon lonceng di kanan atas memberi tahu bahwa ada reservasi online yang baru masuk. Setelah reservasi itu ditindaklanjuti seperti langkah nomor 2, centang notifikasinya. Kalau tidak dicentang, angka di lonceng akan terus muncul walaupun pekerjaannya sudah selesai.',
      },
    ]),

    H2(S() + 'Arti Status Booking'),
    P('Empat langkah tadi sebenarnya memindahkan reservasi dari satu status ke status berikutnya. Ini arti ketiganya, berurutan.'),
    spacer(70),
    table(['Status', 'Artinya', 'Meja ditahan?', 'Yang harus dilakukan'], [
      ['1. Waitlist', 'Baru masuk dari form online, belum diputuskan apa pun.', 'Belum', 'Hubungi tamu hari itu juga. Konfirmasi, lalu waive atau ajukan DP.'],
      ['2. Incoming', 'DP sudah diajukan, tinggal menunggu uangnya masuk.', 'Ya', 'Pantau pembayarannya dan ingatkan tamu sebelum jatuh tempo.'],
      ['3. Reserved', 'Sudah pasti. DP lunas, atau memang dibebaskan.', 'Ya', 'Ingatkan jamnya, lalu tekan "Arrived" saat tamu datang.'],
    ], [1500, 3100, 1200, 3560]),
    spacer(180),
    ...jangan([
      'Waitlist TIDAK menahan meja. Selama masih Waitlist, meja yang sama bisa diambil reservasi lain. Jangan menundanya sampai besok.',
    ].concat(opts.warn || [])),

    ...(typeof opts.extra === 'function' ? opts.extra(S) : (opts.extra || [])),

    H2(S() + 'Cara tercepat melihat reservasi yang perlu ditindaklanjuti'),
    ...proc([
      'Buka menu "Reservations".',
      'Nyalakan saringan "Online form only", supaya yang tampil hanya reservasi dari form.',
      'Klik status "Waitlist" untuk yang belum diputuskan, lalu "Incoming" untuk yang menunggu uang masuk.',
      'Kerjakan Waitlist lebih dulu, karena mejanya belum ditahan.',
    ]),
    ...figure('05-halaman-reservations', 'Halaman Reservations. 1 pencarian, 2 tanggal, 3 saringan Online form only'),
    ...ingat([
      'Bel notifikasi terus menyala sampai seseorang mencentangnya. Membuka jendela WhatsApp tidak otomatis mencentangnya.',
      'Biasakan memeriksa Deposit queue dan daftar Waitlist di awal shift, bukan di akhir.',
    ]),
  ];
}

function warnLargeParty(forRole) {
  const common = [
    'Waitlist TIDAK menahan meja. Selama masih Waitlist, meja yang sama bisa diambil reservasi lain. Tetapkan meja segera setelah ada kesepakatan.',
    'Tidak ada kedaluwarsa otomatis untuk party besar. Kalau tamu menghilang, seseorang harus membatalkannya secara manual. Periksa daftar Waitlist setiap hari.',
  ];
  const extra = {
    staff: ['Kalau acaranya menyangkut penutupan area, harga khusus, atau diskon, minta keputusan Manager sebelum mengisi angka.'],
    finance: ['Menyimpan angka TIDAK mengubah status. Yang mempromosikan reservasi menjadi Reserved adalah uang yang masuk.'],
    manager: ['Kamu yang memutuskan harga khusus, diskon, dan penutupan area. Staf sengaja tidak diberi wewenang itu.'],
    admin: ['Kamu menentukan batasnya di Settings; keputusan per reservasi tetap di tangan manager, finance, atau staf yang menangani.'],
  }[forRole] || [];
  return jangan(common.concat(extra));
}

// ── The four documents ──────────────────────────────────────────────────
const DOCS = {
  admin: {
    file: 'Panduan_Admin_Intoch.docx',
    title: 'Panduan Admin',
    subtitle: 'Peran, kebijakan deposit, akun staf, dan pengaturan pembayaran',
    note: 'Untuk pemegang akun Admin. Kamu satu-satunya yang bisa mengubah hal-hal di dokumen ini.',
    chapters: [
      '1. Mengenal Intoch dalam Lima Menit',
      '2. Login dan Layar Kamu',
      '3. Empat Peran dan Siapa Boleh Apa',
      '4. Fitur Deposit',
      '5. Mengelola Akun Staf',
      '6. Pengaturan Pembayaran',
      '7. Kartu Contekan Admin',
    ],
    build: () => [
      ...chapterBasics(1),
      ...chapterLogin(2, 'Admin', [
        ['Dashboard', 'Ringkasan restoran: belanja tercatat, kunjungan, reservasi, walk-in, dan yang perlu perhatian.'],
        ['Reservations, Walk-Ins, Guests, Membership', 'Semua halaman operasional, sama seperti yang dilihat staf.'],
        ['Broadcast, Reports, Vouchers, Invoice', 'Kampanye WhatsApp, laporan, voucher, dan pembuat invoice.'],
        ['Settings', 'Areas, Reservation Form, Prizes, WA Templates, Thresholds, Branding, dan Staff. Hanya Admin yang melihat tab Staff.'],
        ['Staff Dashboard', 'Melihat dashboard yang dipakai front desk, tanpa berganti akun.'],
      ], 'admin-sidebar', [
        ...figure('admin-dashboard', 'Dashboard Admin: ringkasan restoran, bukan layar kerja harian front desk'),
      ]),

      H1('3. Empat Peran dan Siapa Boleh Apa'),
      P('Sejak September 2026 ada peran baru, Finance, yang sebelumnya digabung dengan Staff. Staf front office kini fokus pada reservasi dan tamu, sementara Finance fokus pada siapa yang harus membayar dan bagaimana prosesnya.'),
      spacer(70),
      table(['Peran', 'Menu yang terlihat', 'Yang bisa dilakukan', 'Yang tidak bisa'], [
        ['Owner', 'Dashboard, Reports', 'Melihat ringkasan dan laporan', 'Semua penyimpanan data'],
        ['Admin', 'Semua, termasuk Settings > Staff', 'Semuanya, termasuk akun staf, rekening bank, QRIS, dan kebijakan deposit', 'Tidak ada batasan di aplikasi'],
        ['Manager', 'Semua kecuali Settings > Staff', 'Operasional, laporan, pembebasan deposit, void, hapus reservasi, semua jenis invoice', 'Akun staf, rekening bank, QRIS'],
        ['Staff (FO)', 'Dashboard, Reservations, Walk-Ins, Guests, Membership', 'Operasional harian, invoice deposit, mencatat pembayaran masuk', 'Halaman Invoice, void, hapus, pembayaran negatif, pembebasan deposit kecuali diizinkan'],
        ['Finance', 'Dashboard, Reservations, Guests, Membership, Invoice, Vouchers', 'Semua urusan tagihan: invoice deposit, invoice umum, settlement, mencatat pembayaran', 'Walk-in, rekening bank dan QRIS, akun staf, pembebasan deposit kecuali diizinkan'],
      ], [1350, 2150, 3100, 2760]),
      spacer(180),
      ...ingat([
        'Menu yang disembunyikan bukan satu-satunya pengaman. Database memeriksa peran setiap kali data disimpan, jadi seseorang yang memaksa membuka halaman yang bukan haknya tetap ditolak saat menyimpan.',
        'Finance tidak melihat Walk-Ins, kartu Quick Walk-In, ubin statistik, maupun okupansi area. Dashboardnya sengaja hanya berisi reservasi dan antrian deposit.',
      ]),

      ...chapterDepositPolicy(4, (n, S) => [
        H2(S() + 'Mengubah pilihannya'),
        ...proc([
          'Buka Settings, lalu tab "Reservation Form".',
          'Gulir ke bagian "Deposit basis".',
          'Pilih "By area" atau "By guest count".',
          'Kalau memilih "By guest count", isi dua kolom di bawahnya.',
          'Simpan halaman itu.',
        ]),
        ...figure('admin-deposit-basis-area', 'Mode "By area". 1 pilihan basis deposit'),
        ...figure('admin-deposit-basis-pax', 'Mode "By guest count". 1 pilihan basis, 2 batas bebas deposit, 3 batas reservasi biasa'),
        H2(S() + 'Arti dua kolom pada mode jumlah tamu'),
        spacer(70),
        table(['Kolom', 'Artinya', 'Contoh'], [
          ['No deposit up to (guests)', 'Sampai jumlah ini, tamu tidak diminta deposit sama sekali.', 'Diisi 4: reservasi 1 sampai 4 orang bebas deposit, 5 orang sudah diminta.'],
          ['Regular booking up to (guests)', 'Sampai jumlah ini, reservasi diperlakukan biasa. Di atasnya menjadi party besar yang perlu keputusan.', 'Diisi 20: 21 orang ke atas masuk Waitlist dan staf memilih format invoice.'],
        ], [2500, 3400, 3460]),
        spacer(180),
        ...ingat([
          'Isi 0 pada kolom pertama berarti SEMUA reservasi meminta deposit, termasuk tamu satu orang.',
          'Dua kolom itu hanya berlaku untuk mode jumlah tamu. Pada mode area keduanya diabaikan, walaupun di layar mungkin masih terlihat.',
        ]),
        H2(S() + 'Kalau memilih mode area'),
        P('Nilai depositnya diambil dari tiap area, yang diatur di Settings > Areas. Area tanpa nilai deposit berarti tidak meminta deposit. Angka itu tetap sama untuk setiap reservasi sampai kamu mengubahnya.'),
        ...jangan([
          'Mengubah basis deposit mengubah perilaku seluruh aplikasi, termasuk form yang dilihat tamu. Beri tahu manager, staf, dan finance sebelum menggantinya, bukan sesudah mereka kebingungan.',
        ]),
      ]),

      H1('5. Mengelola Akun Staf'),
      P('Settings, tab "Staff". Hanya Admin yang melihat tab ini.'),
      ...proc([
        'Klik "Add Staff" untuk akun baru, atau "Edit" pada baris akun yang sudah ada.',
        'Isi Name, Username, dan PIN 4 angka.',
        'Pilih Role: Staff, Finance, Manager, Admin, atau Owner.',
        'Kalau perannya Staff atau Finance, muncul pilihan "Can waive deposits". Biarkan mati kecuali orang itu memang dipercaya membebaskan deposit.',
        'Klik "Save Staff".',
      ]),
      ...figure('admin-staff-form', 'Jendela Add Staff. 1 pilihan peran, 2 izin membebaskan deposit'),
      ...ingat([
        'PIN tidak bisa dibaca siapa pun, termasuk kamu. PIN hanya bisa diganti.',
        'Sistem menolak menonaktifkan atau menurunkan Admin terakhir yang aktif.',
        'Seseorang tidak bisa mengubah perannya sendiri, termasuk kamu.',
        'Menonaktifkan akun langsung mencabut aksesnya ke database, tanpa menunggu orangnya logout.',
      ]),
      ...jangan([
        'PIN hanya empat angka. Jangan pakai 0000, 1111, 1234, atau tanggal lahir. Ganti PIN yang pernah dibagikan lewat chat.',
        'Buat satu akun Admin cadangan yang tidak dipakai sehari-hari, catat PIN-nya di tempat aman. Kalau kamu satu-satunya Admin dan lupa PIN, tidak ada jalan masuk dari dalam aplikasi.',
      ]),

      H1('6. Pengaturan Pembayaran'),
      P('Settings > Reservation Form, bagian "Deposit payment details". Isinya rekening bank dan gambar QRIS yang akan dilihat tamu pada invoice deposit.'),
      ...ingat([
        'Hanya Admin yang boleh mengubah rekening dan QRIS. Manager, Finance, dan Staff tidak bisa, dan database ikut menolaknya, bukan hanya tombolnya yang disembunyikan.',
        'Kalau keduanya kosong, aplikasi menolak membuat invoice deposit dengan pesan "Add bank details or a QRIS image in Settings first". Itu disengaja: invoice tanpa tujuan pembayaran membuang satu-satunya pesan yang pasti dibuka tamu.',
      ]),

      H1('7. Kartu Contekan Admin'),
      spacer(70),
      table(['Kalau kamu ingin', 'Buka'], [
        ['Mengubah cara deposit dihitung', 'Settings > Reservation Form > Deposit basis'],
        ['Mengubah nilai deposit sebuah area', 'Settings > Areas'],
        ['Mengubah rekening atau QRIS', 'Settings > Reservation Form > Deposit payment details'],
        ['Membuat akun baru atau reset PIN', 'Settings > Staff'],
        ['Memberi staf izin membebaskan deposit', 'Settings > Staff > Edit > Can waive deposits'],
        ['Melihat layar yang dipakai front desk', 'Menu "Staff Dashboard" di sidebar'],
      ], [3800, 5560]),
    ],
  },

  manager: {
    file: 'Panduan_Manager_Intoch.docx',
    title: 'Panduan Manager',
    subtitle: 'Wewenang, keputusan deposit, dan operasional harian',
    note: 'Untuk pemegang akun Manager. Kamu memutuskan hal-hal yang sengaja tidak diberikan kepada staf.',
    chapters: [
      '1. Mengenal Intoch dalam Lima Menit',
      '2. Login dan Layar Kamu',
      '3. Batas Wewenang Manager',
      '4. Fitur Deposit',
      '5. Party Besar dan Pilihan Format Invoice',
      '6. Keputusan yang Hanya Manager',
      '7. Kartu Contekan Manager',
    ],
    build: () => [
      ...chapterBasics(1),
      ...chapterLogin(2, 'Manager', [
        ['Dashboard', 'Layar kerja harian: Quick Walk-In, reservasi mendatang, antrian deposit, walk-in hari ini.'],
        ['Reservations, Walk-Ins, Guests, Membership', 'Semua halaman operasional.'],
        ['Broadcast, Reports, Vouchers, Invoice', 'Kampanye, laporan, voucher, dan pembuat invoice.'],
        ['Settings', 'Areas, Reservation Form, Prizes, WA Templates, Thresholds, Branding. Tab Staff tidak terlihat, itu milik Admin.'],
      ], 'admin-sidebar', [
        P('Catatan: gambar di atas diambil dari akun Admin. Menu Manager sama persis kecuali tab "Staff" di dalam Settings dan menu "Staff Dashboard", yang keduanya hanya milik Admin.', { size: 19, italics: true, color: GREY }),
      ]),

      H1('3. Batas Wewenang Manager'),
      P('Sejak September 2026 peran Finance dipisah dari Staff. Staf front office fokus pada reservasi dan tamu; Finance fokus pada tagihan dan pembayaran. Kamu berada di atas keduanya untuk urusan operasional.'),
      spacer(70),
      table(['Tindakan', 'Staff', 'Finance', 'Manager', 'Admin'], [
        ['Mencatat walk-in dan reservasi', 'Ya', 'Reservasi saja', 'Ya', 'Ya'],
        ['Membuat invoice deposit', 'Ya', 'Ya', 'Ya', 'Ya'],
        ['Invoice umum dan settlement', 'Tidak', 'Ya', 'Ya', 'Ya'],
        ['Mencatat pembayaran masuk', 'Ya', 'Ya', 'Ya', 'Ya'],
        ['Penyesuaian pembayaran negatif', 'Tidak', 'Tidak', 'Ya', 'Ya'],
        ['Membebaskan deposit', 'Hanya jika diizinkan', 'Hanya jika diizinkan', 'Ya', 'Ya'],
        ['Void kunjungan, hapus reservasi', 'Tidak', 'Tidak', 'Ya', 'Ya'],
        ['Rekening bank dan QRIS', 'Tidak', 'Tidak', 'Tidak', 'Ya'],
        ['Akun staf dan peran', 'Tidak', 'Tidak', 'Tidak', 'Ya'],
      ], [3000, 1590, 1590, 1590, 1590]),
      spacer(180),

      ...chapterDepositPolicy(4, (n, S) => [
        H2(S() + 'Yang perlu kamu periksa'),
        P('Kebijakannya dipasang Admin, tetapi kamu yang akan ditanya staf ketika layar tidak sesuai harapan. Buka Settings > Reservation Form dan lihat sendiri mana yang sedang aktif sebelum menjawab.'),
        ...figure('admin-deposit-basis-pax', 'Bagian Deposit basis di Settings. 1 basis, 2 batas bebas deposit, 3 batas reservasi biasa'),
        H2(S() + 'Pertanyaan yang sering muncul dari staf'),
        spacer(70),
        table(['Kata staf', 'Yang sebenarnya terjadi'], [
          ['"Kolom depositnya kosong, saya harus isi berapa?"', 'Restoran memakai mode jumlah tamu. Tidak ada angka otomatis. Angkanya hasil kesepakatan dengan tamu, dan kamu yang memutuskan kalau ada harga khusus.'],
          ['"Kenapa reservasi 2 orang ini diminta deposit?"', 'Mode jumlah tamu dengan batas bebas deposit diisi 1, atau mode area dan areanya punya nilai deposit.'],
          ['"Statusnya tidak bisa saya ubah ke Reserved."', 'Reservasi yang meminta deposit terkunci di Incoming sampai dibayar atau dibebaskan. Itu disengaja.'],
          ['"Reservasi ini hilang dari daftar meja."', 'Statusnya Waitlist. Waitlist tidak menahan meja.'],
        ], [3400, 5960]),
        spacer(180),
      ]),

      ...chapterLargeParty(5, 'manager'),

      H1('6. Keputusan yang Hanya Manager'),
      H2('6.1 Membebaskan deposit'),
      ...proc([
        'Buka reservasinya, lihat panel deposit.',
        'Klik "Waive".',
        'Tulis alasannya. Wajib, dan ditolak kalau kosong.',
        'Klik "Waive deposit". Reservasi menjadi Reserved tanpa pembayaran.',
      ]),
      ...ingat([
        'Pembayaran yang sudah tercatat tetap menempel pada reservasi itu.',
        'Tanpa alasan tertulis, seminggu kemudian tidak ada yang bisa membedakan pembebasan atas izin chef dari deposit yang sekadar terlupa.',
        'Kamu bisa memberi izin ini kepada Staff atau Finance tertentu, tetapi yang memasangnya di akun mereka adalah Admin.',
      ]),
      H2('6.2 Void kunjungan dan hapus reservasi'),
      ...bullets([
        '"Void" pada walk-in dipakai untuk baris yang salah total. Barisnya tetap tersimpan sebagai riwayat tetapi dikeluarkan dari semua laporan.',
        '"Delete Reservation" hanya untuk baris yang salah masuk, misalnya duplikat. Alasan harus ditulis.',
        '"Cancel" berbeda dari "Delete": Cancel berarti tamu membatalkan, dan itu informasi yang dipakai laporan.',
      ]),
      ...jangan([
        'Jangan menghapus untuk merapikan tampilan. Angka laporan bulan lalu bisa berubah tanpa jejak.',
        'Membatalkan reservasi yang sudah ada uangnya memunculkan kotak yang menanyakan apakah uangnya sudah dikembalikan. Kotak itu sengaja tidak bisa ditutup dengan klik di luar.',
      ]),
      H2('6.3 Tamu yang tidak datang'),
      P('Kalau staf menekan "Completed" pada reservasi yang tidak pernah ditandai "Arrived", aplikasi bertanya apakah tamu itu datang. Pastikan staf menjawab jujur: pilihan "tidak datang" menandai reservasi sebagai Cancelled (No Show) dan tidak meminta angka belanja apa pun.'),
      ...ingat([
        'Di restoran lain, 15 reservasi ditandai selesai padahal tamunya tidak datang, 91 pax, semuanya di akhir shift. Laporan omzet dan riwayat tamu ikut salah selama berminggu-minggu.',
      ]),

      H1('7. Kartu Contekan Manager'),
      spacer(70),
      table(['Situasi', 'Tindakan'], [
        ['Staf bingung angka deposit', 'Cek Settings > Reservation Form > Deposit basis, lalu jelaskan modenya'],
        ['Tamu minta DP dibebaskan', 'Buka reservasi > Waive > tulis alasan'],
        ['Party besar minta harga khusus', 'Putuskan angkanya, lalu isi di panel kuning pada Update Reservation'],
        ['Walk-in salah total', 'Void pada baris walk-in'],
        ['Reservasi duplikat', 'Delete Reservation, tulis alasan'],
        ['Reservasi berbayar dibatalkan', 'Jawab kotak pengembalian dana dengan jujur'],
        ['Daftar Waitlist menumpuk', 'Periksa tiap pagi, hubungi tamunya, atau batalkan'],
      ], [3800, 5560]),
    ],
  },

  staff: {
    file: 'Panduan_Staff_Intoch.docx',
    title: 'Panduan Staff',
    subtitle: 'Walk-in, reservasi, dan apa yang harus diserahkan ke orang lain',
    note: 'Untuk staf front office. Fokusmu adalah tamu dan reservasi, bukan tagihan.',
    chapters: [
      '1. Mengenal Intoch dalam Lima Menit',
      '2. Login dan Layar Kamu',
      '3. Walk-In',
      '4. Reservasi dari Dashboard',
      '5. Reservasi dari Form Online',
      '6. Fitur Deposit',
      '7. Party Besar dan Pilihan Format Invoice',
      '8. Batas Wewenangmu',
      '9. Kartu Contekan Staff',
    ],
    build: () => [
      ...chapterBasics(1),
      ...chapterLogin(2, 'Staff', [
        ['Dashboard', 'Layar kerjamu. Quick Walk-In, reservasi mendatang, antrian deposit, dan walk-in hari ini.'],
        ['Reservations', 'Daftar lengkap reservasi, bisa dicari dan difilter.'],
        ['Walk-Ins', 'Semua walk-in hari ini, dengan tombol Edit dan Complete.'],
        ['Guests', 'Database tamu.'],
        ['Membership', 'Kartu anggota, sticker, dan voucher.'],
      ], 'staff-sidebar', [
        ...figure('staff-dashboard', 'Dashboard Staff. Perhatikan tab "Deposit queue" di bawah ringkasan tanggal'),
        ...ingat([
          'Halaman Invoice, Reports, Broadcast, dan Settings tidak ada di menumu. Itu normal, bukan kerusakan.',
        ]),
      ]),

      H1('3. Walk-In'),
      ...flow(['Tamu masuk, catat namanya', 'Beri meja', 'Tamu selesai makan', 'Complete, isi belanja']),
      H2('3.1 Jalan cepat: Quick Walk-In'),
      ...proc([
        'Ketik nama tamu di kolom "Guest name". Setelah dua huruf muncul daftar tamu lama; klik namanya kalau ada.',
        'Isi "Phone (optional)" bila tamu memberikan nomornya.',
        'Ubah angka pax di kolom kecil sebelah kanan.',
        'Tekan Enter atau klik "Add".',
      ]),
      ...figure('03-quick-walkin', 'Kartu Quick Walk-In. 1 nama, 2 nomor HP, 3 jumlah orang, 4 tombol Add'),
      ...jangan([
        'Kalau keterangan yang muncul menyebut nama tamu lain, berarti nomor HP itu milik orang lain. Simpan tanpa nomor dan laporkan ke manager.',
        'Jangan mengubah nama tamu lama hanya karena ejaannya beda. Ketikanmu dipakai untuk mencari, bukan mengoreksi.',
      ]),
      H2('3.2 Jalan lengkap: tombol Walk-In'),
      ...fields([
        ['Guest', 'Cari nama atau nomor HP, klik hasilnya.', 'Ya'],
        ['Name, Phone', 'Untuk tamu yang belum ada di sistem.', 'Ya, kalau tamu baru'],
        ['Pax', 'Jumlah orang. Bawaannya 2.', 'Ya'],
        ['Pemilih meja', 'Klik meja yang dipakai. Meja terpakai tidak bisa diklik.', 'Sebaiknya'],
        ['Notes', 'Permintaan khusus, alergi, pesan untuk kitchen.', 'Tidak'],
      ]),
      ...figure('03-register-walkin', 'Jendela Register Walk-In. 1 pencarian tamu, 2 jumlah orang, 3 area, 4 catatan'),
      H2('3.3 Menyelesaikan kunjungan'),
      ...proc([
        'Klik "Complete" pada baris tamunya.',
        'Isi "Spend Amount (Rp)". Wajib.',
        'Isi pesanan dan catatan bila perlu.',
        'Klik simpan. Status menjadi Done.',
      ]),
      ...figure('03-complete-modal', 'Jendela penyelesaian. 1 jumlah belanja, 2 pesanan, 3 catatan'),
      ...jangan([
        'Jangan mengarang angka belanja. Kalau tidak tahu, tanya kasir.',
        'Jangan meninggalkan walk-in berstatus Active sampai besok.',
      ]),

      H1('4. Reservasi dari Dashboard'),
      P('Dipakai ketika tamu memesan lewat telepon, WhatsApp, atau datang langsung untuk booking, dan kamu yang mencatatnya.'),
      ...flow(['Catat reservasinya', 'Hari H: tekan Arrived', 'Tamu selesai makan', 'Completed, isi belanja']),
      P('Buka Dashboard, lalu klik tombol "New Reservation" di bagian atas. Jendela di bawah ini terbuka. Nomor pada gambar sama persis dengan nomor langkah di teks.'),
      ...figure('04-reservasi-baru', 'Bagian atas jendela New Reservation. Nomor 1 sampai 6 mengikuti nomor langkah pada 4.1'),

      H2('4.1 Langkah demi langkah'),
      ...tutorial([
        {
          lead: 'Isi nama tamu.',
          text: 'Ketik nama atau nomor HP di kolom "Guest". Setelah dua huruf muncul daftar tamu lama, klik namanya kalau ada. Kalau tamunya memang baru, klik "Create new guest" dan kolom Name serta Phone muncul seperti pada gambar. Selalu cari dulu sebelum membuat tamu baru, supaya riwayat kunjungannya tidak terpecah dua.',
        },
        {
          lead: 'Isi nomor HP.',
          text: 'Kolom "Phone" baru muncul setelah kamu memilih membuat tamu baru, jadi jangan bingung kalau di awal kolom ini belum kelihatan. Boleh dikosongkan, tetapi tanpa nomor HP tamu ini tidak bisa ditagih DP dan tidak bisa dikirimi tiket.',
        },
        { lead: 'Isi Date.', text: 'Tanggal tamu akan datang.' },
        { lead: 'Isi Time.', text: 'Jam kedatangan, format 24 jam, misalnya 19:00.' },
        { lead: 'Isi Pax.', text: 'Jumlah orang. Bawaannya 2.' },
        {
          lead: 'Pilih Area dan meja.',
          text: 'Kolom "Area" terisi sendiri mengikuti meja yang kamu klik di bagian "Tables" di bawahnya. Meja yang sudah dipakai reservasi lain pada jam itu tidak bisa diklik.',
          after: ingat([
            'Di bawah nomor 6 ada panel "Request deposit". Isi dan perilakunya mengikuti setting deposit restoran, dijelaskan lengkap di Bab 6. Fitur Deposit.',
          ]),
        },
        {
          lead: 'Pilih Reservation Source.',
          text: 'Dari mana reservasi ini datang: WhatsApp, Phone Call, Instagram, Referral, dan seterusnya. Selalu diisi, karena dari kolom inilah restoran tahu kanal mana yang benar-benar mendatangkan tamu.',
        },
        {
          lead: 'Klik "Save Reservation".',
          text: 'Tombolnya ada di paling bawah jendela. Kalau masih ada kolom wajib yang kosong, jendela tidak akan tertutup dan kolom yang bermasalah ditandai. Setelah tersimpan, reservasinya muncul di "Upcoming Reservations" pada Dashboard.',
          fig: ['04-reservasi-simpan', 'Bagian bawah jendela yang sama. 7 Reservation Source, 8 tombol Save Reservation'],
        },
      ]),
      ...salah([
        'Ada yang salah setelah tersimpan? Buka reservasinya dari daftar, lalu pilih "Edit Full Details" untuk membuka kembali formulir yang sama.',
      ]),

      H2('4.2 Hari H'),
      ...proc([
        'Saat tamu tiba, buka reservasinya dan klik "Arrived".',
        'Saat tamu selesai, klik "Completed" dan isi jumlah belanja.',
      ]),
      ...ingat([
        'Kalau "Arrived" tidak pernah ditekan, aplikasi akan bertanya apakah tamu datang. Jawab jujur. Untuk tamu yang tidak muncul, pilih "tidak datang", dan tidak ada angka belanja yang diminta.',
      ]),

      ...chapterOnlineFlow(5, 'staff', {
        depositRef: 'Bab 6. Fitur Deposit',
        warn: ['Kalau akunmu tidak diizinkan membebaskan deposit, tombol "Waive" tidak muncul. Itu normal. Minta Manager atau Finance yang mengerjakan, jangan mencari jalan lain.'],
      }),

      ...chapterDepositPolicy(6, (n, S) => [
        H2(S() + 'Yang kamu lihat di formulir'),
        P('Panel "Request deposit" pada formulir reservasi terisi sendiri mengikuti kebijakan restoran. Kalau kolom jumlahnya kosong dan tidak terisi otomatis, itu berarti restoran memakai mode jumlah tamu dan angkanya harus disepakati dulu dengan tamu.'),
        ...figure('staff-deposit-pax', 'Panel deposit pada mode jumlah tamu. 1 centang permintaan deposit, 2 kolom jumlah yang dibiarkan kosong'),
        ...ingat([
          'Saat panel itu tercentang, kolom Status terkunci. Itu normal, jangan dipaksa.',
          'Jangan mengarang angka deposit. Kalau kosong, tanyakan ke Manager atau Finance berapa yang harus diminta.',
        ]),
      ]),

      ...chapterLargeParty(7, 'staff'),

      H1('8. Batas Wewenangmu'),
      P('Beberapa hal sengaja tidak diberikan kepada staf front office. Kalau kamu membutuhkannya, minta orang yang tepat, jangan mencari jalan lain.'),
      spacer(70),
      table(['Yang tidak bisa kamu lakukan', 'Minta ke'], [
        ['Membebaskan deposit, kecuali akunmu diberi izin khusus', 'Manager, atau Finance yang diizinkan'],
        ['Void walk-in yang salah total', 'Manager'],
        ['Menghapus reservasi', 'Manager'],
        ['Invoice umum, settlement, atau koreksi pembayaran', 'Finance'],
        ['Mengubah rekening bank atau QRIS', 'Admin'],
        ['Membuat akun atau reset PIN', 'Admin'],
      ], [5000, 4360]),
      spacer(180),
      ...ingat([
        'Kalau muncul pesan "This account cannot perform this action", itu penolakan dari database, bukan salah klik. Jangan diulang, minta orang yang berwenang.',
      ]),

      H1('9. Kartu Contekan Staff'),
      spacer(70),
      table(['Situasi', 'Tindakan'], [
        ['Tamu datang tanpa pesan, restoran ramai', 'Quick Walk-In: nama, HP, pax, Enter'],
        ['Tamu datang tanpa pesan, restoran sepi', 'Tombol Walk-In, isi lengkap dengan meja'],
        ['Tamu menelepon untuk pesan tempat', 'New Reservation, isi formulir, Save Reservation'],
        ['Tamu reservasi tiba', 'Buka reservasinya, klik "Arrived"'],
        ['Tamu selesai makan', 'Complete atau Completed, isi jumlah belanja'],
        ['Tamu reservasi tidak muncul', 'Completed, jawab "tidak datang", jangan isi belanja'],
        ['Kolom deposit kosong', 'Tanya Manager atau Finance, jangan mengarang angka'],
        ['Reservasi online berstatus Waitlist', 'Hubungi tamu hari itu juga, mejanya belum ditahan'],
      ], [3800, 5560]),
    ],
  },

  finance: {
    file: 'Panduan_Finance_Intoch.docx',
    title: 'Panduan Finance',
    subtitle: 'Siapa yang harus membayar, berapa, dan bagaimana menagihnya',
    note: 'Peran baru, dipisah dari Staff pada September 2026. Fokusmu adalah tagihan dan pembayaran.',
    chapters: [
      '1. Mengenal Intoch dalam Lima Menit',
      '2. Login dan Layar Kamu',
      '3. Reservasi dari Form Online dan Antrian Deposit',
      '4. Fitur Deposit',
      '5. Party Besar dan Pilihan Format Invoice',
      '6. Menagih dan Mencatat Pembayaran',
      '7. Pembebasan dan Pembatalan',
      '8. Kartu Contekan Finance',
    ],
    build: () => [
      ...chapterBasics(1),
      ...chapterLogin(2, 'Finance', [
        ['Dashboard', 'Reservasi mendatang dan antrian deposit. Tanpa kartu walk-in dan tanpa ubin statistik.'],
        ['Reservations', 'Daftar lengkap reservasi, bisa difilter per status.'],
        ['Guests', 'Database tamu, untuk mencari nomor HP dan riwayatnya.'],
        ['Membership', 'Kartu anggota dan voucher.'],
        ['Vouchers', 'Voucher berdiri sendiri.'],
        ['Invoice', 'Pembuat invoice: deposit, umum, dan pelunasan.'],
      ], 'finance-sidebar', [
        ...ingat([
          'Kamu tidak melihat Walk-Ins, Reports, Broadcast, maupun Settings. Kartu Quick Walk-In dan ubin statistik juga sengaja disembunyikan dari dashboardmu.',
          'Pencatatan walk-in tetap pekerjaan staf front office. Kalau ada walk-in yang perlu dikoreksi, minta mereka.',
        ]),
      ]),

      ...chapterOnlineFlow(3, 'finance', {
        title: 'Reservasi dari Form Online dan Antrian Deposit',
        depositRef: 'Bab 4. Fitur Deposit',
        extra: (S) => [
          H2(S() + 'Membaca baris di Deposit queue'),
          P('Tiap baris punya satu kalimat keterangan uang. Kalimat itulah yang memberi tahu apa yang harus kamu kerjakan pada baris tersebut.'),
          spacer(70),
          table(['Yang tertulis', 'Artinya'], [
            ['No payment requested yet', 'Belum ada tagihan sama sekali. Ini yang paling mendesak.'],
            ['Awaiting a decision', 'Party besar yang angkanya belum disepakati. Hubungi tamu dulu.'],
            ['Deposit paid / requested Rp X / Rp Y', 'Sudah dibayar X dari Y yang diminta. Kalau X kurang dari Y, masih ada sisa.'],
            ['Deposit paid', 'Lunas. Tidak ada yang perlu kamu kerjakan.'],
          ], [3200, 6160]),
          spacer(180),
        ],
      }),

      ...chapterDepositPolicy(4, (n, S) => [
        H2(S() + 'Apa artinya untuk tagihanmu'),
        spacer(70),
        table(['Mode', 'Angka yang ditagih', 'Yang perlu kamu lakukan'], [
          ['By area', 'Sudah terisi otomatis dari nilai area', 'Tinggal kirim invoicenya. Jatuh tempo ada di jam reservasi, jadi kejar sebelum itu.'],
          ['By guest count', 'Kosong sampai seseorang menyepakatinya dengan tamu', 'Pastikan angkanya sudah disepakati sebelum menagih. Tanpa angka, tombol invoice tidak muncul.'],
        ], [1900, 3300, 4160]),
        spacer(180),
        ...figure('admin-deposit-basis-pax', 'Bagian Deposit basis di Settings, hanya bisa dibuka Admin. 1 basis, 2 batas bebas deposit, 3 batas reservasi biasa'),
        ...ingat([
          'Kamu tidak bisa membuka Settings. Kalau perlu tahu mode yang sedang aktif, tanya Admin atau Manager, atau lihat gejalanya: kolom jumlah yang terisi sendiri berarti mode area.',
        ]),
      ]),

      ...chapterLargeParty(5, 'finance'),

      H1('6. Menagih dan Mencatat Pembayaran'),
      H2('6.1 Sebelum menagih, dua syarat'),
      ...bullets([
        'Rekening bank atau QRIS sudah diisi Admin. Kalau belum, muncul "Add bank details or a QRIS image in Settings first" dan kamu harus meminta Admin.',
        'Tamu punya nomor HP di sistem. Kalau kosong, muncul "This guest has no phone number".',
      ]),
      H2('6.2 Mengirim tagihan deposit'),
      ...proc([
        'Buka reservasinya dari Deposit queue atau halaman Reservations.',
        'Pada panel deposit, klik "Invoice & WhatsApp".',
        'Periksa ringkasannya, tambahkan catatan bila perlu.',
        'Klik "Create invoice & open WhatsApp".',
        'KIRIM pesannya di WhatsApp. Jangan hanya menutup tab.',
      ]),
      ...jangan([
        'Tombol itu melakukan dua hal: membuat invoice dan membuka WhatsApp. Menutup tab tanpa mengirim membuat sistem mencatat invoice sudah dibuat padahal tamu belum ditagih.',
      ]),
      H2('6.3 Mencatat pembayaran'),
      ...proc([
        'Buka reservasinya, klik "Record payment".',
        'Isi "Amount" dengan jumlah yang benar-benar masuk, bukan yang ditagih.',
        'Isi "Paid on", "Method", dan "Reference" bila ada.',
        'Klik "Save payment".',
      ]),
      ...ingat([
        'Kalau pembayaran menutup seluruh kekurangan, status berubah menjadi Reserved pada saat itu juga, dalam satu tindakan yang sama.',
        'Pembayaran SEBAGIAN tetap Incoming, dan jatuh temponya tidak bergeser. Ini disengaja: kalau jatuh tempo ikut mundur, tamu bisa menahan meja selamanya dengan mengirim Rp 1.000 setiap hari.',
        'Kalau muncul konflik meja saat status hendak berubah, sistem membatalkan pencatatan pembayaran DAN perubahan status. Selesaikan mejanya dulu, lalu catat ulang.',
      ]),
      H2('6.4 Pelunasan dan invoice lain'),
      P('Halaman "Invoice" adalah pembuat invoice lengkap: acara, pesanan besar, dan pelunasan. Kamu bisa menyimpannya, mengunduh PDF, atau mengirim lewat WhatsApp.'),
      ...figure('finance-invoice', 'Halaman Invoice. Kolom isian di kiri, hasil yang akan dikirim ke tamu di kanan'),
      ...bullets([
        'Untuk sisa tagihan setelah DP pada reservasi, pakai "Record another payment" di panel deposit reservasi tersebut.',
        'Invoice deposit terbaru yang sudah diterbitkan adalah yang dianggap sistem sebagai tagihan aktif. Invoice lama tetap tersimpan sebagai riwayat.',
      ]),

      H1('7. Pembebasan dan Pembatalan'),
      H2('7.1 Membebaskan deposit'),
      P('Kamu hanya bisa melakukannya kalau Admin mencentang "Can waive deposits" pada akunmu. Kalau tombol "Waive" tidak muncul, atau muncul pesan "This account cannot waive deposits", mintalah Manager yang mengerjakan.'),
      ...proc([
        'Buka reservasinya, klik "Waive" pada panel deposit.',
        'Tulis alasannya. Wajib.',
        'Klik "Waive deposit".',
      ]),
      H2('7.2 Membatalkan reservasi yang sudah ada uangnya'),
      P('Muncul kotak "This booking has been paid" yang menyebutkan jumlah yang sudah diterima dan menanyakan apakah sudah dikembalikan. Kotak ini satu-satunya yang tidak bisa ditutup dengan mengklik di luarnya.'),
      ...ingat([
        'Membatalkan reservasi tidak memindahkan uang sesen pun. Pengembalian dana adalah pekerjaan terpisah yang harus benar-benar dilakukan.',
      ]),

      H1('8. Kartu Contekan Finance'),
      spacer(70),
      table(['Situasi', 'Tindakan'], [
        ['Mulai shift', 'Dashboard > tab "Deposit queue"'],
        ['"No payment requested yet"', 'Kirim invoice deposit lewat "Invoice & WhatsApp"'],
        ['"Awaiting a decision"', 'Hubungi tamu, sepakati angka, pilih format invoice, Save amount'],
        ['Bukti transfer masuk', 'Record payment, isi jumlah yang benar-benar masuk'],
        ['Bayar sebagian', 'Tetap Incoming. Jatuh tempo tidak bergeser'],
        ['Perlu invoice rinci atau pelunasan', 'Menu Invoice'],
        ['Tamu minta DP dibebaskan', 'Waive kalau akunmu diizinkan, kalau tidak minta Manager'],
        ['Rekening atau QRIS salah', 'Minta Admin. Kamu tidak bisa mengubahnya'],
      ], [3800, 5560]),
    ],
  },
};

// ── Render ──────────────────────────────────────────────────────────────
function render(key) {
  const spec = DOCS[key];
  resetFigures();
  const body = [
    ...cover(spec.title, spec.subtitle, spec.note),
    ...toc(key, spec.chapters),
    ...spec.build(),
    new Paragraph({ spacing: { before: 460, after: 0 },
      children: [new TextRun({ text: 'Kalau ada langkah di panduan ini yang tidak cocok dengan yang kamu lihat di layar, beri tahu manager. Aplikasi ini sering diperbarui.', size: 20, italics: true, color: GREY })] }),
  ];
  const doc = new Document({
    creator: 'Intoch',
    title: spec.title + ' Intoch',
    description: spec.subtitle,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    numbering: { config: [
      { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } } }] },
      { reference: 'dots', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } } }] },
    ] },
    sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1200, left: 1080, right: 1080 } } },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Intoch GMS · ' + spec.title + ' · ', size: 17, color: GREY }),
          new TextRun({ children: [PageNumber.CURRENT], size: 17, color: GREY }),
        ] })] }) },
      children: body,
    }],
  });
  return Packer.toBuffer(doc).then(buf => {
    fs.writeFileSync(path.join(__dirname, spec.file), buf);
    console.log(spec.file.padEnd(34), buf.length, 'bytes');
  });
}

module.exports = { DOCS };

if (require.main === module) {
  const only = process.argv[2];
  (async () => {
    for (const key of Object.keys(DOCS)) {
      if (only && only !== key) continue;
      await render(key);
    }
  })();
}
