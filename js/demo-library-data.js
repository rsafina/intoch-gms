/* Public, fictional sales stories only. No app globals, credentials or persistence. */
(function () {
  'use strict';
  const step = (label, title, text, scene, note = '') => ({ label, title, text, scene, note });
  const definitions = [
    { slug: 'reactivation', category: 'Hubungan pelanggan', title: "Tingkatkan After-Sales, Ciptakan Customer Relationship",
      problem: "Sapa pelanggan lewat WhatsApp di setiap momen, dari konfirmasi reservasi sampai ucapan terima kasih.",
      keyMessage: "Tingkatkan After-Sales, Ciptakan Customer Relationship",
      steps: [
        step("Follow up", "Bu Michelle reservasi malam ini. Satu klik Follow up, pesan konfirmasi WhatsApp sudah terisi.", "Bu Michelle reservasi malam ini. Satu klik Follow up, pesan konfirmasi WhatsApp sudah terisi lengkap dengan tanggal, jam, dan jumlah tamu.", "rel-followup"),
        step("Issue ticket", "Klik Issue ticket, dan Bu Michelle menerima tiket konfirmasi reservasi lewat WhatsApp.", "Klik Issue ticket, dan Bu Michelle menerima tiket konfirmasi reservasi lewat WhatsApp. Tiketnya bisa dibuka dan diunduh dari ponselnya.", "rel-ticket"),
        step("WA Thanks", "Setelah kunjungan selesai, tamu walk-in maupun reservasi dapat ucapan terima kasih.", "Setelah kunjungan selesai, tamu walk-in maupun reservasi dapat ucapan terima kasih. Cukup klik WA Thanks.", "rel-thanks", "Pesan tetap dikirim staf lewat WhatsApp. Isi template bisa Anda ubah sesuai gaya restoran.")
      ], related: ['follow-up', 'walk-in'] },
    { slug: 'customer-database', category: 'Kenali tamu', title: "Kenali Pelanggan Lebih Baik dengan Customer Database",
      problem: "Bantu tim waiter Anda melayani lebih personal, tanpa perlu menghafal.",
      keyMessage: "Kenali Pelanggan Lebih Baik dengan Customer Database",
      steps: [
        step("Cari tamu", "Cari nama, lalu buka Guest Profile.", "Ketik nama Michelle di Guest Database. Klik ikon mata untuk melihat rata-rata belanja, catatan, dan riwayat kunjungannya.", "db-guest"),
        step("Kenali member", "Data membership ada di profil yang sama.", "Cari Jessica dan buka profilnya. Status member, saldo stiker, voucher, dan riwayat kunjungan langsung terlihat.", "db-member")
      ], related: ['reactivation', 'walk-in'] },
    { slug: 'campaign', category: 'Pesan yang relevan', title: "Berhenti bagikan pesan broadcast yang sama ke semua leads pelanggan Anda.",
      problem: "Kirimkan broadcast marketing yang relevan dengan history visit, data spending, atau event spesial pelanggan.",
      keyMessage: "Berhenti bagikan pesan broadcast yang sama ke semua leads pelanggan Anda.",
      steps: [
        step("Kenali segmen", "Report Customer Insight membagi pelanggan menjadi Acquire, Retain, dan At Risk.", "Report Customer Insight membagi pelanggan menjadi Acquire (tamu pertama kali), Retain (tamu yang kembali), dan At Risk (lama tidak datang).", "segment-report"),
        step("Buat campaign", "Ajak 23 tamu yang kembali menikmati promo dessert.", "Ajak 23 tamu yang kembali menikmati promo dessert. Klik Buat Campaign, beri nama, lalu pilih segmen 'Tamu yang kembali'.", "campaign-create"),
        step("Kirim pesan", "Undangan datang kembali dengan kesempatan dessert gratis sudah siap.", "Ajak tamu datang lagi sebelum 31 Oktober untuk kesempatan menikmati dessert gratis. Kirim pesan promonya secara personal lewat WhatsApp.", "campaign-send", "Fitur campaign Intoch bantu Anda menyiapkan template pesan WhatsApp dan terhubung langsung ke target leads.")
      ], related: ['reactivation', 'customer-insight'] },
    { slug: 'walk-in', category: 'Di meja penerima tamu', title: "Dapatkan data pelanggan walk-in, tanpa membuat mereka menunggu.",
      problem: "Saat ramai pun, data pelanggan tetap tercatat tanpa membuat antrean.",
      keyMessage: "Dapatkan data pelanggan walk-in, tanpa membuat mereka menunggu.",
      steps: [
        step("Pilih tamu", "Pilih tamu dari saran nama.", "Ketik nama Jessica, pilih dari saran yang muncul, lalu klik Add. Walk-in langsung tercatat tanpa mengisi ulang data tamu.", "quick-existing"),
        step("Tamu baru", "Belum terdaftar? Tambahkan tamu baru.", "Untuk tamu baru seperti Brian, cukup isi nama lalu klik Add. Nomor telepon opsional; detail lainnya bisa menyusul.", "quick-new", "Pendaftaran cepat dalam kurang dari 20 detik."),
        step("Setelah duduk", "Lengkapi detail setelah tamu duduk.", "Tamu sudah duduk? Klik Edit, pilih meja dan tambahkan catatan, lalu Save Changes. Detail walk-in diperbarui di daftar yang sama.", "quick-seat")
      ], related: ['customer-database', 'reservation'] },
    { slug: 'reservation', category: 'Sebelum tamu datang', title: "Mudahkan Reservasi Pelanggan dengan Online Form, Simpan dan Manfaatkan Data Kemudian",
      problem: "Form dengan identitas restoran Anda. Reservasi masuk otomatis, data tamu langsung tersimpan.",
      keyMessage: "Mudahkan Reservasi Pelanggan dengan Online Form, Simpan dan Manfaatkan Data Kemudian",
      steps: [
        step("Form restoran Anda", "Reservasi dengan identitas restoran Anda.", "Logo dan nama restoran Anda menyambut tamu. Michelle mengisi kontak, jumlah tamu, area, tanggal, dan jam, lalu klik Reserve Now.", "rsv-form"),
        step("Masuk otomatis", "Notifikasi masuk, reservasi siap dikelola.", "Reservasi otomatis masuk ke dashboard dengan notifikasi. Temukan di Upcoming Reservations, lalu klik Update untuk melengkapi meja nanti.", "rsv-dashboard"),
        step("Tamu tersimpan", "Satu reservasi, satu profil tamu baru.", "Nama dan nomor WhatsApp Michelle otomatis tersimpan di Guest Database. Buka profilnya untuk melihat detail reservasi; riwayat kunjungan dimulai setelah ia datang.", "rsv-guest", "Contoh reservasi ini tanpa deposit.")
      ], related: ['follow-up', 'walk-in'] },
    { slug: 'follow-up', category: 'Follow up reservasi', title: "Pantau Konfirmasi Booking dalam Satu Daftar",
      problem: "Tim tahu booking mana yang sudah dan belum dihubungi, tanpa saling tanya.",
      keyMessage: "Pantau Konfirmasi Booking dalam Satu Daftar",
      steps: [
        step("Filter reservasi", "Temukan reservasi yang perlu ditangani.", "Pilih periode, status Reserved, dan Online form only. Cari nama tamu untuk langsung menemukan reservasi yang Anda butuhkan.", "fu-filter"),
        step("Hubungi & kirim tiket", "Follow up dan issue ticket dari reservasi yang sama.", "Klik Follow up untuk menyiapkan WhatsApp konfirmasi. Lalu Issue ticket untuk membagikan tiket reservasi kepada tamu.", "fu-actions"),
        step("Cek notifikasi", "Tandai follow up dan cek kedatangan secara terpisah.", "Setelah menghubungi tamu, centang Sudah di-follow up pada notifikasi. Menjelang kedatangan, buka Arrival checks dan tandai Sudah dicek.", "fu-checks", "Membuka WhatsApp tidak otomatis mencentang checklist. Cek kedatangan tidak mengubah status tamu menjadi Arrived.")
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
