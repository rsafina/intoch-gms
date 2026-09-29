/* Public, fictional sales stories only. No app globals, credentials or persistence. */
(function () {
  'use strict';
  const step = (label, title, text, scene, note = '') => ({ label, title, text, scene, note });
  const definitions = [
    { slug: 'reactivation', category: 'Hubungan pelanggan', title: "Tingkatkan After-Sales, Ciptakan Customer Relationship",
      problem: "Temukan pelanggan yang lama belum kembali, dan berikan perhatian lewat pesan WhatsApp.",
      keyMessage: "Tingkatkan After-Sales, Ciptakan Customer Relationship",
      steps: [
        step("Data", "Bu Michelle dulu rutin makan di sini.", "Bu Michelle dulu rutin makan di sini. Tapi, sudah 3 bulan dia tidak datang, dan tidak ada yang sadar.", "database"),
        step("Insight", "Melalui report 'Customer At Risk', pelanggan dengan visit mulai 60 hari lalu dapat ditemukan.", "Melalui report 'Customer At Risk', pelanggan dengan visit mulai 60 hari lalu dapat ditemukan.", "risk"),
        step("Action", "Follow up dengan campaign, siapkan pesan ajakan repeat order dan kirim secara personal melalui WhatsApp.", "Follow up dengan campaign, siapkan pesan ajakan repeat order dan kirim secara personal melalui WhatsApp.", "reactivate", "Dengan Intoch, data pelanggan menjadi milik Anda sepenuhnya, dan dapat Anda manfaatkan untuk menciptakan Customer Relationship.")
      ], related: ['customer-database', 'campaign'] },
    { slug: 'customer-database', category: 'Kenali tamu', title: "Kenali Pelanggan Lebih Baik dengan Customer Database",
      problem: "Bantu tim waiter Anda melayani lebih personal, tanpa perlu menghafal.",
      keyMessage: "Kenali Pelanggan Lebih Baik dengan Customer Database",
      steps: [
        step("Cari", "Bu Michelle menelepon untuk pesan meja.", "Bu Michelle menelepon untuk pesan meja. Cukup ketik namanya, profilnya langsung muncul.", "search"),
        step("Kenali", "Tim langsung tahu berapa kali ia datang, kapan terakhir, dan berapa belanjanya.", "Tim langsung tahu berapa kali ia datang, kapan terakhir, dan berapa belanjanya.", "profile"),
        step("Layani", "Ada catatan “suka meja teras”.", "Ada catatan “suka meja teras”. Tim bisa langsung menawarkan meja favoritnya.", "preference", "Total belanja pelanggan dapat ditambahkan di data kunjungan dan menjadi 'spending behavior' yang dapat digunakan di masa depan.")
      ], related: ['reactivation', 'walk-in'] },
    { slug: 'campaign', category: 'Pesan yang relevan', title: "Berhenti bagikan pesan broadcast yang sama ke semua leads pelanggan Anda.",
      problem: "Kirimkan broadcast marketing yang relevan dengan history visit, data spending, atau event spesial pelanggan.",
      keyMessage: "Berhenti bagikan pesan broadcast yang sama ke semua leads pelanggan Anda.",
      steps: [
        step("Semua tamu", "Ada pelanggan new comer, ada loyal customer dan ada yang lama tidak repeat order.", "Ada pelanggan new comer, ada loyal customer dan ada yang lama tidak repeat order. Tentu, marketing broadcastnya tidak bisa sama.", "campaign-segments"),
        step("Pilih audiens", "Contoh, Anda ingin pelanggan 'New Comer' untuk berkunjung kedua kalinya.", "Contoh, Anda ingin pelanggan 'New Comer' untuk berkunjung kedua kalinya. Anda bisa membuat campaign dengan target kategori 'Pelanggan Baru'.", "newcomers"),
        step("Siapkan pesan", "Buat pesan broadcast khusus untuk 'Pelanggan Baru', dan kirimkan WhatsApp personal ke target leads.", "Buat pesan broadcast khusus untuk 'Pelanggan Baru', dan kirimkan WhatsApp personal ke target leads.", "campaign", "Fitur campaign Intoch bantu Anda menyiapkan template pesan WhatsApp dan terhubung langsung ke target leads.")
      ], related: ['reactivation', 'customer-insight'] },
    { slug: 'walk-in', category: 'Di meja penerima tamu', title: "Dapatkan data pelanggan walk-in, tanpa membuat mereka menunggu.",
      problem: "Saat ramai pun, data pelanggan tetap tercatat tanpa membuat antrean.",
      keyMessage: "Dapatkan data pelanggan walk-in, tanpa membuat mereka menunggu.",
      steps: [
        step("Catat cepat", "Cukup isi nama, nomor WhatsApp, dan jumlah pax, lalu antarkan pelanggan ke meja.", "Cukup isi nama, nomor WhatsApp, dan jumlah pax, lalu antarkan pelanggan ke meja.", "walkin"),
        step("Kunjungan", "Tambahkan nomor meja dan note setelah Anda/pelanggan menentukan tempat duduknya.", "Tambahkan nomor meja dan note setelah Anda/pelanggan menentukan tempat duduknya.", "visit"),
        step("Kembali", "Ubah nomor meja dengan fleksibel kapanpun pelanggan request untuk pindah meja.", "Ubah nomor meja dengan fleksibel kapanpun pelanggan request untuk pindah meja.", "bayu-profile")
      ], related: ['customer-database', 'reservation'] },
    { slug: 'reservation', category: 'Sebelum tamu datang', title: "Mudahkan Reservasi Pelanggan dengan Online Form, Simpan dan Manfaatkan Data Kemudian",
      problem: "Setiap data kunjungan terakumulasi, on track dan jadi database yang siap digunakan.",
      keyMessage: "Mudahkan Reservasi Pelanggan dengan Online Form, Simpan dan Manfaatkan Data Kemudian",
      steps: [
        step("Tamu memilih", "Michelle klik link form reservasi, kemudian isi nama, nomor WhatsApp, pilih tanggal, waktu, dan jumlah pax.", "Michelle klik link form reservasi, kemudian isi nama, nomor WhatsApp, pilih tanggal, waktu, dan jumlah pax.", "reservation"),
        step("Booking masuk", "Reservasi otomatis muncul di dashboard, lengkap dengan notifikasi untuk tim resto.", "Reservasi otomatis muncul di dashboard, lengkap dengan notifikasi untuk tim resto.", "booking"),
        step("Data tersimpan", "Nama dan nomor WhatsApp Michelle otomatis tersimpan di database Anda.", "Nama dan nomor WhatsApp Michelle otomatis tersimpan di database Anda.", "booked-profile", "Contoh reservasi ini tanpa deposit. Advance setting tersedia jika reservasi membutuhkan deposit.")
      ], related: ['follow-up', 'walk-in'] },
    { slug: 'follow-up', category: 'Tindak lanjut reservasi', title: "Pantau Konfirmasi Booking dalam Satu Daftar",
      problem: "Tim tahu booking mana yang sudah dan belum dihubungi, tanpa saling tanya.",
      keyMessage: "Pantau Konfirmasi Booking dalam Satu Daftar",
      steps: [
        step("Perlu tindakan", "Booking Bu Michelle masuk ke daftar Follow Up karena belum ada yang menghubunginya.", "Booking Bu Michelle masuk ke daftar Follow Up karena belum ada yang menghubunginya.", "follow-list"),
        step("Buka konteks", "Detail booking dan profil Bu Michelle sudah terbuka.", "Detail booking dan profil Bu Michelle sudah terbuka. Pesan konfirmasinya juga sudah disiapkan.", "follow-context"),
        step("Tandai selesai", "Setelah menghubungi Bu Michelle, staf menandai “Sudah di-follow up”.", "Setelah menghubungi Bu Michelle, staf menandai “Sudah di-follow up”. Shift berikutnya langsung tahu.", "follow-done", "Status baru berubah setelah staf menandainya, bukan saat WhatsApp dibuka.")
      ], related: ['reservation', 'customer-database'] },
    { slug: 'membership', category: 'Hubungan jangka panjang', title: "Beri Pelanggan Setia Alasan untuk Kembali",
      problem: "Belanja member terkumpul jadi stiker, lalu ditukar voucher.",
      keyMessage: "Beri Pelanggan Setia Alasan untuk Kembali",
      steps: [
        step("Kenali member", "Bu Jessica, member Family, datang lagi.", "Bu Jessica, member Family, datang lagi. Tim langsung lihat jumlah kunjungan dan sisa stikernya.", "member"),
        step("Catat aktivitas", "Setelah makan, transaksinya dicatat.", "Setelah makan, transaksinya dicatat. Stiker Bu Jessica otomatis bertambah.", "stickers", "Di contoh ini, Rp100.000 = 1 stiker dan 10 stiker = 1 voucher. Aturannya bisa Anda ubah."),
        step("Reward", "Stikernya sudah 10, bisa ditukar voucher.", "Stikernya sudah 10, bisa ditukar voucher. Bu Jessica punya alasan untuk datang lagi.", "reward")
      ], related: ['customer-database', 'full-journey'] },
    { slug: 'customer-insight', category: 'Dari pola ke tindakan', title: "Tahu Siapa yang Perlu Disapa dengan Customer Insight",
      problem: "Lihat siapa yang aktif dan siapa yang mulai jarang datang.",
      keyMessage: "Tahu Siapa yang Perlu Disapa dengan Customer Insight",
      steps: [
        step("Baca pola", "Bu Michelle sudah 4 kali datang.", "Bu Michelle sudah 4 kali datang. Kelihatannya pelanggan setia, padahal terakhir datang 95 hari lalu.", "profile"),
        step("Lihat jeda", "Intoch mengelompokkan pelanggan dari kunjungan terakhirnya.", "Intoch mengelompokkan pelanggan dari kunjungan terakhirnya. Yang lama absen langsung terlihat.", "risk"),
        step("Tindak lanjuti", "Dua pelanggan At Risk langsung jadi daftar penerima campaign ajakan kembali.", "Dua pelanggan At Risk langsung jadi daftar penerima campaign ajakan kembali.", "reactivate", "Segmen dibuat dari riwayat kunjungan yang tercatat. Intoch tidak menebak perilaku pelanggan.")
      ], related: ['reactivation', 'campaign'] },
    { slug: 'full-journey', category: 'Cerita Intoch Restaurant', title: "Dari Kunjungan Pertama sampai Jadi Pelanggan Langganan",
      problem: "Setiap kunjungan dan pesan tersimpan di satu profil pelanggan.",
      keyMessage: "Dari Kunjungan Pertama sampai Jadi Pelanggan Langganan",
      steps: [
        step("Datang", "Pak Brian datang pertama kali tanpa reservasi.", "Pak Brian datang pertama kali tanpa reservasi. Tim mencatatnya di meja A3.", "walkin"),
        step("Kenali", "Nama dan nomor Pak Brian kini punya profil sendiri, siap dipakai di kunjungan berikutnya.", "Nama dan nomor Pak Brian kini punya profil sendiri, siap dipakai di kunjungan berikutnya.", "bayu-profile"),
        step("Jaga hubungan", "Pak Brian belum kembali sejak kunjungan pertama.", "Pak Brian belum kembali sejak kunjungan pertama. Tim menyiapkan pesan terima kasih untuknya.", "journey-message"),
        step("Kembali", "Saat Pak Brian kembali, tim sudah mengenalnya.", "Saat Pak Brian kembali, tim sudah mengenalnya. Kunjungan keduanya tercatat di profil yang sama.", "return", "Ini contoh perjalanan pelanggan. Hasil nyata bergantung pada restoran dan penawaran Anda.")
      ], related: ['membership', 'campaign'] }
  ];
  window.IntochDemoData = {
    definitions,
    restaurant: 'Intoch Restaurant', date: '23 Sep 2026',
    contact: 'https://wa.me/6281325063362?text=Halo%2C%20saya%20tertarik%20dengan%20Intoch%20untuk%20restoran%20saya.',
    guests: [
      { name: 'Michelle', initials: 'MI', last: '20 Jun', days: 95, visits: 4, spend: 'Rp1.240.000', note: 'Suka meja teras', phone: '0812 •••• 0098' },
      { name: 'Noelle', initials: 'NO', last: '10 Jul', days: 75, visits: 3, spend: 'Rp870.000', note: 'Tidak pedas', phone: '0813 •••• 0021' },
      { name: 'Jessica', initials: 'JE', last: '18 Sep', days: 5, visits: 8, spend: 'Rp2.800.000', note: 'Member Family', phone: '0815 •••• 0072' },
      { name: 'Daniel', initials: 'DA', last: '20 Sep', days: 3, visits: 2, spend: 'Rp540.000', note: 'Indoor', phone: '0816 •••• 0043' },
      { name: 'John', initials: 'JO', last: '22 Sep', days: 1, visits: 5, spend: 'Rp1.600.000', note: 'Makan bersama keluarga', phone: '0817 •••• 0054' },
      { name: 'Brian', initials: 'BR', last: '23 Sep', days: 0, visits: 1, spend: 'Belum dicatat', note: 'Walk-in · 2 orang · A3', phone: '0818 •••• 0065' }
    ]
  };
})();
