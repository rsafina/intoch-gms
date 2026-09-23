/* Public, fictional sales stories only. No app globals, credentials or persistence. */
(function () {
  'use strict';
  const step = (label, title, text, scene, note = '') => ({ label, title, text, scene, note });
  const definitions = [
    { slug: 'reactivation', category: 'Hubungan pelanggan', title: 'Pelanggan Lama Kembali',
      problem: 'Punya banyak data tamu. Siapa yang sudah lama tidak datang?',
      keyMessage: 'Temukan customer yang sudah lama tidak kembali.',
      steps: [
        step('Data', 'Masih ingat Dewi?', 'Dulu rutin datang. Di antara nama-nama lain, jeda kunjungannya mudah terlewat.', 'database'),
        step('Insight', 'Lihat siapa yang mulai menjauh.', 'Pilih segmen At Risk. Tamu yang lebih dari 60 hari belum berkunjung terlihat bersama kunjungan terakhirnya.', 'risk'),
        step('Action', 'Ajak kembali dengan alasan yang relevan.', 'Buat campaign untuk segmen ini, lalu siapkan pesan personal. Staf menghubungi penerima satu per satu lewat WhatsApp.', 'reactivate', 'Data yang sudah Anda miliki tetap berguna. Tidak harus mengganti POS atau platform reservasi Anda.')
      ], related: ['customer-database', 'campaign'] },
    { slug: 'customer-database', category: 'Kenali tamu', title: 'Kenali Customer',
      problem: 'Nama familiar. Tapi tim lupa kunjungan dan kesukaannya?',
      keyMessage: 'Customer data bukan cuma tersimpan — tapi bisa digunakan.',
      steps: [
        step('Cari', 'Satu nama, konteksnya terbuka.', 'Cari Dewi saat ia menghubungi restoran. Tim melihat profil yang sama tanpa menggali chat lama.', 'search'),
        step('Kenali', 'Bukan sekadar nomor telepon.', 'Riwayat reservasi, walk-in, belanja yang tercatat, dan catatan tamu membantu tim mengenalinya.', 'profile'),
        step('Layani', 'Sambut dengan lebih personal.', 'Catatan “suka meja teras” memberi tim konteks untuk percakapan berikutnya.', 'preference', 'Belanja hanya ditampilkan jika pernah dicatat. Penggabungan data dari sistem lain memerlukan penyiapan data saat onboarding.')
      ], related: ['reactivation', 'walk-in'] },
    { slug: 'campaign', category: 'Pesan yang relevan', title: 'Campaign Berdasarkan Segmen',
      problem: 'Pesan yang sama dikirim ke semua orang?',
      keyMessage: 'Kirim pesan yang relevan ke customer yang tepat.',
      steps: [
        step('Semua tamu', 'Setiap tamu punya konteks berbeda.', 'Ada yang baru datang minggu ini. Ada yang sudah berbulan-bulan tidak kembali.', 'database'),
        step('Pilih audiens', 'Enam tamu. Dua yang perlu diajak kembali.', 'Segmen At Risk mempersempit audiens. Pesan ajakan kembali tidak diarahkan ke tamu yang baru datang.', 'risk'),
        step('Siapkan pesan', 'Satu tujuan, audiens yang sesuai.', 'Tinjau pesan dan dua penerima sebelum staf membuka WhatsApp satu per satu.', 'campaign', 'Membuka WhatsApp bukan bukti pesan terkirim. Pengiriman tetap dilakukan oleh staf.')
      ], related: ['reactivation', 'customer-insight'] },
    { slug: 'walk-in', category: 'Di meja penerima tamu', title: 'Walk-in Saat Ramai',
      problem: 'Tamu terus datang. Mencatat data sering tertinggal?',
      keyMessage: 'Tetap kenal customer meski datang tanpa reservasi.',
      steps: [
        step('Catat cepat', 'Tamu masuk. Catat yang perlu saja.', 'Nama, kontak, jumlah tamu, dan meja. Tim bisa langsung melanjutkan pelayanan.', 'walkin'),
        step('Kunjungan', 'Duduk di meja A3, tercatat di Intoch.', 'Kunjungan Bayu tersimpan sebagai walk-in untuk dua orang.', 'visit'),
        step('Kembali', 'Lain kali, bukan mulai dari nol.', 'Cari kontak yang sama saat Bayu kembali. Riwayat kunjungannya sudah ada.', 'bayu-profile')
      ], related: ['customer-database', 'reservation'] },
    { slug: 'reservation', category: 'Sebelum tamu datang', title: 'Reservasi Mandiri',
      problem: 'Booking tersebar di chat. Staf harus mencatat ulang?',
      keyMessage: 'Reservasi masuk otomatis tanpa pencatatan ulang.',
      steps: [
        step('Tamu memilih', 'Tamu mengatur rencananya sendiri.', 'Dewi memilih tanggal, area, jam, dan empat orang melalui tautan reservasi.', 'reservation'),
        step('Booking masuk', 'Tim langsung melihat reservasinya.', 'Booking muncul di daftar reservasi dengan notifikasi untuk ditindaklanjuti.', 'booking'),
        step('Data tersimpan', 'Kontak tamu ikut tersimpan.', 'Reservasi Dewi terhubung ke profilnya. Tim tidak perlu menyalin nama dan nomor dari chat.', 'booked-profile', 'Contoh area tanpa deposit. Status dan kebutuhan deposit mengikuti pengaturan restoran.')
      ], related: ['follow-up', 'walk-in'] },
    { slug: 'follow-up', category: 'Tindak lanjut reservasi', title: 'Follow Up dengan Mudah',
      problem: 'Booking masuk, tapi siapa yang sudah menghubungi tamunya?',
      keyMessage: 'Tidak ada customer yang terlewat untuk di-follow-up.',
      steps: [
        step('Perlu tindakan', 'Booking baru punya tempat di antrean.', 'Daftar follow-up menunjukkan reservasi Dewi yang masih perlu ditindaklanjuti.', 'follow-list'),
        step('Buka konteks', 'Detailnya siap sebelum menghubungi.', 'Periksa tanggal, jam, jumlah orang, dan profil tamu. Pesan konfirmasi disiapkan untuk WhatsApp.', 'follow-context'),
        step('Tandai selesai', 'Tim berikutnya tahu sudah ditangani.', 'Setelah benar-benar menghubungi tamu, staf menandai “Sudah di-follow up”.', 'follow-done', 'Membuka WhatsApp tidak otomatis menandai reservasi selesai ditindaklanjuti.')
      ], related: ['reservation', 'customer-database'] },
    { slug: 'membership', category: 'Hubungan jangka panjang', title: 'Pelanggan Setia Kembali',
      problem: 'Punya member, tapi aktivitas dan reward-nya jarang dibuka?',
      keyMessage: 'Ubah customer loyal menjadi relationship jangka panjang.',
      steps: [
        step('Kenali member', 'Sari datang lagi. Tim mengenalinya.', 'Profil membership Family menunjukkan kunjungan dan saldo stiker yang sudah dimiliki.', 'member'),
        step('Catat aktivitas', 'Belanja tercatat, stiker bertambah.', 'Simpan transaksi member dari kunjungan yang benar-benar terjadi.', 'stickers', 'Contoh aturan Senja: Rp100.000 per stiker, 10 stiker per voucher. Aturan dapat diatur restoran.'),
        step('Reward', 'Ada alasan untuk kunjungan berikutnya.', 'Sepuluh stiker dikonversi menjadi voucher member. Saldo stiker dan voucher dapat ditelusuri.', 'reward')
      ], related: ['customer-database', 'full-journey'] },
    { slug: 'customer-insight', category: 'Dari pola ke tindakan', title: 'Customer Insight',
      problem: 'Data tamu bertambah. Apa yang perlu dilakukan berikutnya?',
      keyMessage: 'Kenali pola customer sebelum menentukan campaign.',
      steps: [
        step('Baca pola', 'Frekuensi saja belum cukup.', 'Dewi pernah datang empat kali, tetapi kunjungan terakhirnya sudah 95 hari lalu.', 'profile'),
        step('Lihat jeda', 'Pisahkan yang aktif dan yang lama absen.', 'Segmen berdasarkan kunjungan terakhir membantu menemukan tamu yang perlu disapa kembali.', 'risk'),
        step('Tindak lanjuti', 'Jadikan temuan sebagai audiens.', 'Siapkan campaign reaktivasi untuk dua tamu At Risk, dengan pesan yang sesuai konteks mereka.', 'reactivate', 'Contoh memakai riwayat kunjungan dan segmen yang tersedia; tidak memprediksi perilaku atau menjanjikan hasil campaign.')
      ], related: ['reactivation', 'campaign'] },
    { slug: 'full-journey', category: 'Cerita Senja Resto', title: 'Full Customer Journey',
      problem: 'Dari tamu pertama kali sampai menjadi pelanggan, konteksnya sering putus?',
      keyMessage: 'Dari reservasi sampai customer kembali — semuanya terhubung.',
      steps: [
        step('Datang', 'Mulai dari satu kunjungan.', 'Bayu datang tanpa reservasi. Tim mencatat dua orang di meja A3.', 'walkin'),
        step('Kenali', 'Kunjungan menjadi konteks.', 'Nama, kontak, dan riwayat tersimpan di profil Bayu untuk pelayanan berikutnya.', 'bayu-profile'),
        step('Jaga hubungan', 'Sapa dengan pesan yang sesuai.', 'Beberapa waktu kemudian, tim menyiapkan pesan untuk tamu baru yang belum kembali.', 'journey-message'),
        step('Kembali', 'Saat Bayu kembali, tim sudah mengenalnya.', 'Pada kunjungan berikutnya, gunakan profil yang sama. Riwayat bertambah, hubungan berlanjut.', 'return', 'Ilustrasi perjalanan tamu, bukan jaminan hasil campaign. Membership tersedia bila tamu bergabung.')
      ], related: ['membership', 'campaign'] }
  ];
  window.IntochDemoData = {
    definitions,
    restaurant: 'Senja Resto', date: '23 Sep 2026',
    contact: 'https://wa.me/6281325063362?text=Halo%2C%20saya%20tertarik%20dengan%20Intoch%20untuk%20restoran%20saya.',
    guests: [
      { name: 'Dewi Lestari', initials: 'DL', last: '20 Jun', days: 95, visits: 4, spend: 'Rp1.240.000', note: 'Suka meja teras', phone: '0812 •••• 0098' },
      { name: 'Rina Putri', initials: 'RP', last: '10 Jul', days: 75, visits: 3, spend: 'Rp870.000', note: 'Tidak pedas', phone: '0813 •••• 0021' },
      { name: 'Sari Wulandari', initials: 'SW', last: '18 Sep', days: 5, visits: 8, spend: 'Rp2.800.000', note: 'Member Family', phone: '0815 •••• 0072' },
      { name: 'Andi Saputra', initials: 'AS', last: '20 Sep', days: 3, visits: 2, spend: 'Rp540.000', note: 'Indoor', phone: '0816 •••• 0043' },
      { name: 'Bima Santoso', initials: 'BS', last: '22 Sep', days: 1, visits: 5, spend: 'Rp1.600.000', note: 'Makan bersama keluarga', phone: '0817 •••• 0054' },
      { name: 'Bayu Pratama', initials: 'BP', last: '23 Sep', days: 0, visits: 1, spend: 'Belum dicatat', note: 'Walk-in · 2 orang · A3', phone: '0818 •••• 0065' }
    ]
  };
})();
