require('dotenv').config();
const { execSync } = require('child_process');
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode'); // Library qrcode biasa (tetap diperlukan jika ada logic lain)
const qrcodeTerminal = require('qrcode-terminal'); // Menampilkan QR di Terminal
// const Tesseract = require('tesseract.js'); // Dihapus untuk menghemat RAM
const { HttpsProxyAgent } = require('https-proxy-agent');
const cron = require('node-cron');
const fs = require('fs');     // Library baru untuk membaca file
const path = require('path'); // Library baru untuk mengatur jalur file
const axios = require('axios');
const cheerio = require('cheerio');
const mongoose = require('mongoose');

// =========================
// KONFIGURASI BOT VIA DB
// =========================
const appConfigSchema = new mongoose.Schema({
    id: { type: String, default: 'main' },
    isReminderActive: { type: Boolean, default: false },
    reminderIntervalHrs: { type: Number, default: 1 },
    reminderMessage: { type: String, default: '🔒 Jangan lupa kunci pintu!' },
    reminderGroupId: { type: String, default: '' },
    reminderMentions: { type: [String], default: [] }
});
const AppConfig = mongoose.models.AppConfig || mongoose.model('AppConfig', appConfigSchema);

let autoReminderTimer = null;

async function mulaiAutoReminder() {
    if (autoReminderTimer) clearInterval(autoReminderTimer);
    if (mongoose.connection.readyState !== 1) return;
    try {
        let config = await AppConfig.findOne({ id: 'main' });
        if (!config || !config.isReminderActive || !config.reminderGroupId) return;
        const durasiMs = config.reminderIntervalHrs * 60 * 60 * 1000;
        console.log(`[SYSTEM] Auto-reminder berjalan setiap ${config.reminderIntervalHrs} jam di grup ${config.reminderGroupId}`);
        autoReminderTimer = setInterval(async () => {
            try {
                if (!client || !client.info) return; // bot mungkin terputus
                const chatGrup = await client.getChatById(config.reminderGroupId);
                let kontakYangDiTag = [];
                let stringTag = "";
                for (let nomor of config.reminderMentions) {
                    try {
                        const kontak = await client.getContactById(nomor);
                        if (kontak) kontakYangDiTag.push(kontak);
                        stringTag += `@${nomor.split('@')[0]} `;
                    } catch (e) { }
                }
                let teksFinal = stringTag ? `${stringTag.trim()} ${config.reminderMessage}` : config.reminderMessage;
                await chatGrup.sendMessage(teksFinal, { mentions: kontakYangDiTag });
                console.log('Berhasil mengirim auto-reminder ke grup tersebut!');
            } catch (error) {
                console.error('Gagal mengirim auto-reminder berkala:', error.message);
            }
        }, durasiMs);
    } catch (err) {
        console.error("Gagal memuat auto-reminder:", err.message);
    }
}


function bersihkanGembok(direktori) {
    if (!fs.existsSync(direktori)) return;

    const isiDirektori = fs.readdirSync(direktori);
    for (const item of isiDirektori) {
        const jalurLengkap = path.join(direktori, item);

        try {
            // Gunakan lstatSync untuk menangani file shortcut (symlink) yang rusak
            const stat = fs.lstatSync(jalurLengkap);

            if (stat.isDirectory()) {
                bersihkanGembok(jalurLengkap); // Cari ke dalam sub-folder
            } else if (item.startsWith('Singleton')) {
                fs.unlinkSync(jalurLengkap);
                console.log(`🧹 Sisa crash dibersihkan: ${item}`);
            }
        } catch (err) {
            // Jika file tidak bisa dibaca atau terhapus, abaikan dan lanjut ke file berikutnya
        }
    }
}

console.log('Mengecek dan membersihkan memori sistem...');
bersihkanGembok(path.join(__dirname, '.wwebjs_auth'));

const memoriPercakapan = new Map();

// Menghapus data percakapan rutin setiap 3 jam untuk mencegah server kehabisan memori
setInterval(() => {
    console.log('[SYSTEM] Menjalankan Garbage Collection memori...');
    if (memoriPercakapan.size > 100) {
        memoriPercakapan.clear(); // Hapus paksa jika cache user terlalu banyak
    }
}, 3 * 60 * 60 * 1000);

const app = express();
const port = process.env.PORT || 3000;

console.log(`[SYSTEM] Memulai server Express pada port ${port}...`);

let qrCodeImage = ''; // Variabel untuk menyimpan gambar QR Code sementara

// app.get('/', (req, res) => {
//     res.send('Bot WhatsApp OCR sedang berjalan!');
// });

app.get('/status', (req, res) => {
    // Mengecek apakah client sudah memiliki info wid (berarti sudah login)
    const isReady = !!(client.info && client.info.wid);
    res.json({ ready: isReady });
});

app.get('/', (req, res) => {
    if (qrCodeImage) {
        // Jika ada QR Code, tampilkan di web HTML
        res.send(`
            <html>
                <head>
                    <title>HanBot - Scan QR</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                </head>
                <body style="text-align: center; font-family: Arial, sans-serif; margin-top: 50px; background-color: #f0f2f5;">
                    <div style="background: white; display: inline-block; padding: 20px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                        <h2 style="color: #075e54;">Scan QR Code WhatsApp</h2>
                        <img src="${qrCodeImage}" alt="QR Code" style="border: 1px solid #ddd; padding: 10px; border-radius: 10px; width: 256px; height: 256px;" />
                        <p style="color: #555;">Silakan scan menggunakan WhatsApp di HP Anda.</p>
                        <p style="font-size: 0.8em; color: #888;"><i>Klik tombol di bawah jika QR Code sudah expired.</i></p>
                        <br>
                        <button onclick="location.reload()" style="background: #075e54; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-weight: bold;">Muat QR Code Baru</button>
                    </div>
                </body>
            </html>
        `);
    } else {
        res.send(`
            <html>
                <head>
                    <title>HanBot - Status</title>
                <body style="text-align: center; font-family: Arial, sans-serif; margin-top: 50px; background-color: #f0f2f5;">
                    <div style="background: white; display: inline-block; padding: 30px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                        <h2 style="color: #075e54;">✅ Bot Aktif</h2>
                        <p>Bot WhatsApp OCR sedang berjalan dan sudah terhubung!</p>
                        <button onclick="location.reload()" style="background: #25d366; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-weight: bold;">Refresh Manual</button>
                    </div>
                </body>
            </html>
        `);
    }
});

app.listen(port, () => {
    console.log(`Web server berjalan di port ${port}`);
});

// Konfigurasi Puppeteer khusus untuk Heroku dan Railway
let client;

// Ambil URL Mongodb dari Environment Variable (opsional untuk VPS)
const mongoURI = process.env.MONGODB_URI;

if (mongoURI) {
    console.log('[SYSTEM] Menghubungkan ke MongoDB untuk AppConfig...');
    mongoose.connect(mongoURI).then(() => {
        console.log('[SYSTEM] Terhubung ke MongoDB (Data Reminder Aktif)!');
    }).catch(err => {
        console.error('[ERROR] Gagal terhubung ke MongoDB:', err.message);
    });
}

console.log('[SYSTEM] Menyiapkan WhatsApp Client dengan LocalAuth (VPS Mode)...');
client = new Client({
    authStrategy: new LocalAuth({ clientId: 'hanbot-vps' }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--disable-extensions'
        ],
        executablePath: process.env.GOOGLE_CHROME_BIN || (fs.existsSync('/usr/bin/google-chrome-stable') ? '/usr/bin/google-chrome-stable' : '/usr/bin/chromium-browser')
    }
});

// Inisialisasi event listeners dan client
setupClientEvents(client);
client.initialize().catch(err => {
    console.error('[FATAL] Gagal inisialisasi WA Client:', err.message);
});

function setupClientEvents(client) {
    client.on('qr', (qr) => {
        console.log('✅ QR Code baru telah dibuat! Silakan scan di bawah ini menggunakan aplikasi WhatsApp HP Anda:');
        qrcodeTerminal.generate(qr, { small: true });
    });

    client.on('authenticated', () => {
        console.log('📡 [SYSTEM] Autentikasi berhasil! Sedang menyiapkan sesi...');
    });

    client.on('loading_screen', (percent, message) => {
        console.log(`📦 [LOADING] ${percent}% - ${message}`);
    });

    client.on('ready', () => {
        qrCodeImage = '';
        console.log('Bot sudah siap dan terhubung!');

        // Memulai timer reminder berkala memanggil fungsi global
        mulaiAutoReminder();
    });

    client.on('auth_failure', (msg) => {
        console.error('⚠️ Autentikasi gagal! Sesi mungkin kedaluwarsa atau korup:', msg);
        console.log('🔄 Sesi korup akan dihapus, silakan scan ulang...');
        qrCodeImage = '';
    });

    client.on('disconnected', (reason) => {
        console.log('❌ Bot terputus dari WhatsApp! Alasan:', reason);
        qrCodeImage = '';
        console.log('🔄 Menunggu Heroku merestart Dyno atau inisialisasi ulang otomatis...');
    });
    // Variable declarations needed by message handler
    // (declared at module scope above setupClientEvents)

    // === MESSAGE HANDLER ===
    client.on('message', async msg => {
        // 1. Abaikan pembaruan status WA
        if (msg.from === 'status@broadcast') return;

        const chat = await msg.getChat();

        // 2. FITUR AUTO-READ GRUP
        if (chat.isGroup && isAutoReadEnabled) {
            await chat.sendSeen();
        }

        // ==========================================
        // BERSIHKAN TEKS UNTUK DETEKSI PERINTAH (COMMAND)
        // Menghapus tag nomor bot SECARA SPESIFIK agar perintah tetap terbaca
        // tapi tetap mempertahankan tag teman yang kamu sebut (mention)
        // ==========================================
        let pesanAsli = msg.body;

        if (client.info && client.info.wid) {
            // Cari dan hapus HANYA tag yang berisi nomor bot ini
            const nomorBot = client.info.wid.user;
            const regexBot = new RegExp(`@${nomorBot}\\b`, 'g');
            pesanAsli = pesanAsli.replace(regexBot, '').trim();
        }

        let perintahKecil = pesanAsli.replace(/@\d+/g, '').toLowerCase().trim();

        // ==========================================
        // DAFTAR SAKLAR FITUR (ON/OFF)
        // ==========================================
        if (perintahKecil === '!link on') {
            isAutoSummaryEnabled = true;
            msg.reply('✅ Fitur Auto-Rangkum Link DIAKTIFKAN.');
            return;
        }
        if (perintahKecil === '!link off') {
            isAutoSummaryEnabled = false;
            msg.reply('❌ Fitur Auto-Rangkum Link DIMATIKAN.');
            return;
        }
        // Bagian OCR dinonaktifkan
        if (perintahKecil === '!autoread on') {
            isAutoReadEnabled = true;
            msg.reply('✅ Fitur Auto-Read grup SEKARANG AKTIF.');
            return;
        }
        if (perintahKecil === '!autoread off') {
            isAutoReadEnabled = false;
            msg.reply('❌ Fitur Auto-Read grup DIMATIKAN.');
            return;
        }
        if (perintahKecil === '!cekid') {
            msg.reply(`ID obrolan ini adalah: *${chat.id._serialized}*\n\nJika kamu mengetik ini di grup, itu adalah ID Grup. Jika di japri, itu adalah ID nomormu.`);
            return;
        }
        if (perintahKecil === '!ram') {
            msg.reply('Mengecek status server... 📊');
            try {
                let memoriTerpakaiMB = '0';
                let batasMemoriMB = 'Maksimal Server';

                try {
                    const memoriTerpakaiBytes = execSync('cat /sys/fs/cgroup/memory.current 2>/dev/null || echo 0').toString().trim();
                    memoriTerpakaiMB = (parseInt(memoriTerpakaiBytes) / 1024 / 1024).toFixed(2);

                    const batasMemoriBytes = execSync('cat /sys/fs/cgroup/memory.max 2>/dev/null || echo max').toString().trim();
                    batasMemoriMB = batasMemoriBytes === 'max' ? 'Hening' : (parseInt(batasMemoriBytes) / 1024 / 1024).toFixed(2) + ' MB';
                } catch (e) {
                    // Fallback jika cgroup tidak bisa dibaca (seperti di Heroku)
                    memoriTerpakaiMB = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
                }

                const diskSpace = execSync("df -h / 2>/dev/null | awk 'NR==2 {print $3 \" / \" $2}' || echo 'N/A'").toString().trim();

                const teksBalasan = `🤖 *LAPORAN STATUS SERVER BOT*\n\n` +
                    `🗄️ *RAM Terpakai:* ${memoriTerpakaiMB} MB / ${batasMemoriMB}\n` +
                    `💾 *Penyimpanan:* ${diskSpace}\n\n` +
                    `⚙️ *Status Fitur:*\n` +
                    `- Auto-Read: ${isAutoReadEnabled ? '✅ ON' : '❌ OFF'}`;
                msg.reply(teksBalasan);
            } catch (error) {
                const memoriNode = process.memoryUsage().rss / 1024 / 1024;
                msg.reply(`📊 *Info RAM (Hanya Node.js)*: ~${Math.round(memoriNode)} MB\n\n*(Gagal membaca total memori kontainer penuh)*`);
            }
            return;
        }

        // ==========================================
        // ⏱️ FITUR STOPWATCH
        // ==========================================
        if (perintahKecil === '!stopwatch start') {
            const idPengirim = msg.from;
            stopwatchData.set(idPengirim, Date.now());
            msg.reply('⏱️ *Stopwatch dimulai!*\nKetik *!stopwatch stop* untuk menghentikan.');
            return;
        }

        if (perintahKecil === '!stopwatch stop') {
            const idPengirim = msg.from;
            if (stopwatchData.has(idPengirim)) {
                const waktuMulai = stopwatchData.get(idPengirim);
                const waktuBerlalu = Date.now() - waktuMulai;
                const detik = Math.floor((waktuBerlalu / 1000) % 60);
                const menit = Math.floor((waktuBerlalu / (1000 * 60)) % 60);
                const jam = Math.floor((waktuBerlalu / (1000 * 60 * 60)) % 24);

                stopwatchData.delete(idPengirim);
                msg.reply(`🛑 *Stopwatch dihentikan!*\n\n⏱️ Waktu tercatat: *${jam}j ${menit}m ${detik}d*`);
            } else {
                msg.reply('⚠️ Tidak ada stopwatch yang sedang berjalan.');
            }
            return;
        }

        // ==========================================
        // ⏳ FITUR TIMER
        // ==========================================
        if (perintahKecil.startsWith('!timer ')) {
            const argumen = perintahKecil.split(' ')[1];
            if (!argumen) return;

            const satuan = argumen.slice(-1);
            const angka = parseInt(argumen.slice(0, -1));

            if (isNaN(angka)) {
                msg.reply('⚠️ Format angka tidak valid. Contoh: *!timer 5m*');
                return;
            }

            let durasiMs = 0;
            if (satuan === 's') durasiMs = angka * 1000;
            else if (satuan === 'm') durasiMs = angka * 60 * 1000;
            else if (satuan === 'h') durasiMs = angka * 60 * 60 * 1000;
            else {
                msg.reply('⚠️ Gunakan satuan *s* (detik), *m* (menit), atau *h* (jam).');
                return;
            }

            msg.reply(`⏳ Timer disetel selama *${angka}${satuan}*. Aku akan memberitahumu jika waktu habis!`);

            setTimeout(() => {
                msg.reply(`⏰ *BEEP BEEP BEEP!*\n\nWaktu timer *${angka}${satuan}* kamu sudah habis!`);
            }, durasiMs);
            return;
        }
        // ==========================================
        // 🔔 FITUR REMINDER DENGAN TAGGING GRUP
        // ==========================================
        if (perintahKecil === '!reminder list' || perintahKecil === '!remind list') {
            let teks = "📋 *Daftar Reminder Sementara (Sekali Jalan):*\n";
            if (listRemindersSatuKali.length === 0) {
                teks += "- Tidak ada\n";
            } else {
                listRemindersSatuKali.forEach((r, i) => {
                    let sisa = Math.max(1, Math.ceil((r.waktuTujuan - Date.now()) / 60000));
                    teks += `${i + 1}. "${r.pesan}" (aktif dalam ~${sisa} menit)\n`;
                });
            }

            teks += "\n📋 *Daftar Auto-Reminder cloud (Berulang):*\n";
            try {
                const config = await AppConfig.findOne({ id: 'main' });
                if (!config || !config.isReminderActive) {
                    teks += "- Tidak ada auto-reminder yang aktif.\n";
                } else {
                    teks += `- Pesan: "${config.reminderMessage}" (Setiap ${config.reminderIntervalHrs} jam)\n`;
                }
            } catch (e) { }
            return msg.reply(teks);
        }

        if (perintahKecil.startsWith('!remind ')) {
            // Buang tag bot di AWAL kalimat agar tidak ikut terproses
            let teksBersih = pesanAsli.replace(/^@\d+\s+/, '').trim();
            const potonganKata = teksBersih.split(' ');

            if (potonganKata.length < 3) {
                msg.reply('⚠️ Format salah. Contoh: *!remind 10m Rapat dimulai @Budi*');
                return;
            }

            const argumenWaktu = potonganKata[1];
            const satuan = argumenWaktu.slice(-1).toLowerCase();
            const angka = parseInt(argumenWaktu.slice(0, -1));

            if (isNaN(angka)) {
                msg.reply('⚠️ Format waktu tidak valid. Gunakan s/m/h (Contoh: 10m).');
                return;
            }

            let durasiMs = 0;
            if (satuan === 's') durasiMs = angka * 1000;
            else if (satuan === 'm') durasiMs = angka * 60 * 1000;
            else if (satuan === 'h') durasiMs = angka * 60 * 60 * 1000;
            else return;

            // 1. Ambil teks pesan intinya saja
            let pesanReminder = potonganKata.slice(2).join(' ');

            // 2. Tangkap semua orang yang kamu tag di pesan ini
            let orangYangDiTag = await msg.getMentions();

            // 3. FILTER PENTING: Jangan biarkan bot men-tag dirinya sendiri!
            if (client.info && client.info.wid) {
                orangYangDiTag = orangYangDiTag.filter(kontak => kontak.id._serialized !== client.info.wid._serialized);
            }

            // 4. Merakit string tag secara murni (misal: @62812... @62815...)
            let stringTag = '';
            for (let kontak of orangYangDiTag) {
                stringTag += `@${kontak.id.user} `; // id.user berisi nomor telepon murni
            }

            // Bersihkan teks asli dari sisa-sisa tag lama yang jelek/rusak
            pesanReminder = pesanReminder.replace(/@\d+/g, '').trim();

            // Deteksi apakah reminder ini adalah sebuah COMMAND (dimulai dengan !)
            const isCommand = pesanReminder.startsWith('!');

            if (isCommand) {
                msg.reply(`✅ *Reminder Command Disetel!*\nAku akan menjalankan perintah *${pesanReminder}* dalam waktu *${angka}${satuan}*.`);
            } else {
                msg.reply(`✅ *Reminder Disetel!*\nAku akan mengingatkan dalam waktu *${angka}${satuan}*.`);
            }

            const idReminder = Date.now();
            listRemindersSatuKali.push({ id: idReminder, waktuTujuan: Date.now() + durasiMs, pesan: pesanReminder });

            setTimeout(async () => {
                listRemindersSatuKali = listRemindersSatuKali.filter(r => r.id !== idReminder);
                const chatGrup = await msg.getChat();

                if (isCommand) {
                    // ===== MODE COMMAND: Kirim pesan sebagai "perintah" ke chat =====
                    // Bot mengirim pesan ke chat ini, lalu message handler akan
                    // memprosesnya sebagai command baru (seperti user mengetiknya).
                    console.log(`[REMIND-CMD] Menjalankan command terjadwal: "${pesanReminder}"`);

                    // Rakit pesan command beserta tag jika ada
                    let commandMsg = pesanReminder;
                    if (stringTag.trim()) {
                        commandMsg = `${pesanReminder} ${stringTag.trim()}`;
                    }

                    await chatGrup.sendMessage(commandMsg, { mentions: orangYangDiTag });
                } else {
                    // ===== MODE BIASA: Kirim pesan reminder teks =====
                    const teksFinal = `${stringTag.trim()} ${pesanReminder}`;
                    await chatGrup.sendMessage(teksFinal, { mentions: orangYangDiTag });
                }
            }, durasiMs);

            return;
        }

        // ==========================================
        // FITUR PENGATURAN AUTO-REMINDER BERKALA (!autoremind)
        // ==========================================
        if (perintahKecil.startsWith('!autoremind')) {
            const chatGrup = await msg.getChat();
            if (!chatGrup.isGroup) return msg.reply('⚠️ Perintah ini hanya bisa digunakan di dalam grup!');

            const potongan = pesanAsli.split(' ');
            const aksi = potongan[1] ? potongan[1].toLowerCase() : '';

            if (aksi === 'stop') {
                await AppConfig.findOneAndUpdate({ id: 'main' }, { isReminderActive: false }, { upsert: true });
                mulaiAutoReminder(); // Refresh timer
                return msg.reply('✅ Auto-reminder untuk grup telah *dimatikan*.');
            } else if (aksi === 'start') {
                const jamStr = potongan[2];
                const jamNum = parseFloat(jamStr);
                if (isNaN(jamNum) || jamNum <= 0) {
                    return msg.reply('⚠️ Format salah!\nContoh: *!autoremind start 2 Pesan kamu @TagOrang*\n(Angka 2 berarti fitur ini akan jalan tiap 2 jam)');
                }

                // Ambil teks pesan utamanya
                let teksBersih = pesanAsli.replace(/!autoremind\s+start\s+[\d\.]+/i, '').trim();
                let teksTanpaTag = teksBersih.replace(/@\d+/g, '').trim();
                if (!teksTanpaTag) teksTanpaTag = "Reminder otomatis!";

                // Tangkap kontak yang di-tag
                let dicantum = await msg.getMentions();
                if (client.info && client.info.wid) {
                    dicantum = dicantum.filter(k => k.id._serialized !== client.info.wid._serialized);
                }
                const arrayNomor = dicantum.map(k => k.id._serialized);

                await AppConfig.findOneAndUpdate({ id: 'main' }, {
                    isReminderActive: true,
                    reminderIntervalHrs: jamNum,
                    reminderMessage: teksTanpaTag,
                    reminderGroupId: chatGrup.id._serialized,
                    reminderMentions: arrayNomor
                }, { upsert: true });

                mulaiAutoReminder(); // Refresh timer
                return msg.reply(`✅ *Auto-reminder Berhasil Disetel!*\n\n📝 Pesan: "${teksTanpaTag}"\n⏱️ Durasi: Setiap *${jamNum} jam*\n👥 Tag: ${arrayNomor.length} orang\n\n_(Ket: Pengaturan ini tersimpan di cloud, aman dari server restart)_`);
            } else if (aksi === 'list') {
                const config = await AppConfig.findOne({ id: 'main' });
                if (!config || !config.isReminderActive) {
                    return msg.reply('ℹ️ Tidak ada auto-reminder yang sedang aktif untuk bot ini.');
                }
                let statusMsg = `📋 *Status Auto-Reminder Aktif:*\n\n`;
                statusMsg += `📝 Pesan: "${config.reminderMessage}"\n`;
                statusMsg += `⏱️ Durasi: Setiap *${config.reminderIntervalHrs} jam*\n`;
                statusMsg += `👥 Tag: ${config.reminderMentions.length} orang\n`;
                statusMsg += `\n_(Gunakan !autoremind stop untuk mematikan)_`;
                return msg.reply(statusMsg);
            } else {
                return msg.reply('⚠️ Gunakan:\n1. *!autoremind start [jam] [pesan] [@tag]*\n2. *!autoremind list*\n3. *!autoremind stop*');
            }
        }

        // 4. FILTER GRUP: Jika di grup, pastikan bot di-tag untuk membalas
        if (chat.isGroup) {
            const mentions = await msg.getMentions();
            const isBotMentioned = mentions.some(contact => contact.id._serialized === client.info.wid._serialized);

            if (!isBotMentioned) {
                return; // Abaikan jika tidak di-tag
            }
        }

        // 5. PENANGANAN MEDIA (MENGGUNAKAN OPENROUTER + GEMINI)
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            const isImage = media.mimetype.includes('image');
            const isVideo = media.mimetype.includes('video');

            if (isImage || isVideo) {
                let pesanAwal;
                try {
                    pesanAwal = await msg.reply("Analyzing...");
                } catch (e) {
                    pesanAwal = await chat.sendMessage("Analyzing...");
                }

                try {
                    const imageBase64 = media.data;
                    const userPrompt = msg.body ? msg.body.replace(/@\d+/g, '').trim() : "";

                    const systemInstruction = "Kamu adalah asisten WhatsApp yang alami dan ringkas. Pahami foto/video yang diberikan dan sesuaikan dengan percakapan user, serta apa permintaan yang disampaikan user. selalu gunakan Bahasa Indonesia.";

                    const defaultPrompt = isImage
                        ? "Tolong jelaskan isi gambar ini secara ringkas. Jika ada teks di dalamnya, bacakan dengan akurat."
                        : "Tolong jelaskan apa yang terjadi dalam video ini secara ringkas.";

                    const finalUserPrompt = userPrompt
                        ? `${userPrompt}\n(Jawablah berdasarkan media yang dilampirkan ini secara ringkas)`
                        : defaultPrompt;

                    console.log('[INFO] Mengirim request ke OpenRouter (Gemini) untuk analisis media...');

                    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        },
                        body: JSON.stringify({
                            model: 'google/gemini-3-flash-preview',
                            messages: [
                                { role: 'system', content: systemInstruction },
                                {
                                    role: 'user',
                                    content: [
                                        { type: 'text', text: finalUserPrompt },
                                        {
                                            type: 'image_url',
                                            image_url: {
                                                url: `data:${media.mimetype};base64,${imageBase64}`
                                            }
                                        }
                                    ]
                                }
                            ]
                        })
                    });

                    const responseData = await response.json();

                    if (responseData.choices && responseData.choices[0] && responseData.choices[0].message) {
                        const hasilAnalisis = responseData.choices[0].message.content;
                        await pesanAwal.edit(`${hasilAnalisis}`);
                    } else {
                        console.error('OpenRouter API Error:', JSON.stringify(responseData));
                        await pesanAwal.edit('⚠️ Gagal memproses media. Pastikan format didukung dan ukuran tidak terlalu besar.');
                    }
                } catch (error) {
                    console.error('Error Analisis Media:', error.message);
                    await pesanAwal.edit('❌ Terjadi kesalahan saat mencoba menganalisis media.');
                }
            }
            return;
        }

        // 6. JIKA PESAN BERUPA TEKS BIASA -> TANYAKAN KE DEEPSEEK
        else if (msg.body) {
            // Gunakan 'let' agar pesan bisa kita sisipi konteks tambahan
            let pesanUser = msg.body.replace(/@\d+/g, '').trim();
            if (pesanUser.length === 0) return;

            // --- FITUR !THINK (DEEPSEEK REASONER) ---
            let aiModel = 'deepseek-chat'; // Model default (cepat)

            if (pesanUser.toLowerCase().startsWith('!think')) {
                aiModel = 'deepseek-reasoner'; // Ubah ke model nalar
                pesanUser = pesanUser.slice(6).trim(); // Buang kata '!think' agar AI tidak bingung

                if (pesanUser.length === 0) {
                    msg.reply('Harap masukkan pertanyaan setelah perintah !think.\nContoh: *!think jelaskan teori relativitas*');
                    return;
                }
            }
            // ----------------------------------------

            const idPengirim = msg.from;

            // --- MENGAMBIL IDENTITAS PENGIRIM PESAN ---
            const kontakPengirim = await msg.getContact();
            // Mengambil nama profil WA, jika tidak ada pakai nomornya
            const namaPengirim = kontakPengirim.pushname || kontakPengirim.name || kontakPengirim.number;

            if (chat.isGroup) {
                // Memodifikasi pesan agar AI tahu siapa yang sedang berbicara
                pesanUser = `[Dikirim oleh: ${namaPengirim}] ${pesanUser}`;
            }
            // ------------------------------------------

            // --- DETEKSI REPLY DENGAN PELINDUNG ANTI-CRASH ---
            const isReply = msg.hasQuotedMsg;
            let isReplyingToBot = false;

            if (isReply) {
                try {
                    // [PELINDUNG 1] Menangkap pesan gaib/usang agar tidak error
                    const quotedMsg = await msg.getQuotedMessage().catch(() => null);

                    // Jika pesan berhasil didapat, ambil teksnya. Jika tidak, beri teks fallback.
                    let teksLama = '[Pesan terlalu lama untuk dimuat atau tidak ditemukan]';
                    if (quotedMsg && quotedMsg.body) {
                        teksLama = quotedMsg.body;
                    }

                    // PERBAIKAN BUG: Di grup, ID pengirim asli ada di .author, 
                    // sedangkan di japri ada di .from. Kita ambil mana yang tersedia.
                    let pengirimPesanLama = null;
                    if (quotedMsg) {
                        pengirimPesanLama = quotedMsg.author || quotedMsg.from;
                    }

                    // Cek apakah pesan lama itu adalah milik bot
                    if (pengirimPesanLama === client.info.wid._serialized) {
                        isReplyingToBot = true;
                    }

                    // SUNTIKKAN KONTEKS KE DEEPSEEK
                    pesanUser = `[Konteks untuk AI: Pengguna saat ini sedang membalas sebuah pesan lama yang berbunyi: "${teksLama}"]\n\nBalasan/Pertanyaan pengguna saat ini: ${pesanUser}`;
                } catch (err) {
                    console.log('[WARNING] Gagal memproses pesan kutipan:', err.message);
                }
            }
            // --- AKHIR DETEKSI REPLY ---

            // --- FITUR AUTO-RANGKUM LINK ---
            // (Sekarang fitur ini bebas mendeteksi link kapan saja)
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const extractedUrls = pesanUser.match(urlRegex);

            if (extractedUrls && isAutoSummaryEnabled) {
                const targetUrl = extractedUrls[0];
                let pesanAwal;
                try {
                    pesanAwal = await msg.reply("Analyzing...");
                } catch (e) {
                    pesanAwal = await chat.sendMessage("Analyzing...");
                }

                try {
                    const { data } = await axios.get(targetUrl, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                        timeout: 10000
                    });

                    const $ = cheerio.load(data);
                    $('script, style, nav, footer, aside, noscript, header').remove();

                    let textContent = '';
                    $('p, h1, h2, h3').each((i, el) => {
                        textContent += $(el).text() + '\n';
                    });

                    textContent = textContent.replace(/\s+/g, ' ').trim().substring(0, 4000);

                    if (textContent.length < 150) {
                        await pesanAwal.edit('Tautan ini tidak berisi artikel teks panjang, atau web tersebut memblokir akses bot.');
                        return;
                    }

                    const promptRangkuman = `Buatkan rangkuman singkat dalam 3-5 poin utama berbahasa Indonesia dari isi artikel berikut. Gunakan bahasa yang mudah dipahami:\n\n${textContent}`;

                    const response = await fetch('https://api.deepseek.com/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
                        },
                        body: JSON.stringify({
                            model: 'deepseek-chat',
                            messages: [{ role: 'user', content: promptRangkuman }]
                        })
                    });

                    const responseData = await response.json();
                    if (responseData.choices && responseData.choices.length > 0) {
                        await pesanAwal.edit(`📝 *Rangkuman Tautan:*\n\n${responseData.choices[0].message.content}`);
                    }
                } catch (error) {
                    console.error('Error membaca tautan:', error.message);
                    await pesanAwal.edit('Gagal memproses tautan. Web mungkin dilindungi keamanan anti-bot atau jaringan sedang sibuk.');
                }
                return;
            }
            // --- AKHIR FITUR AUTO-RANGKUM LINK ---

            // --- SYSTEM PROMPT BARU ---
            const systemPrompt = `Nama mu adalah HanBot. Bot yang ditraining langsung oleh Hanafi selama 40 minggu. Kamu adalah asisten WhatsApp yang cerdas, ramah, dan ringkas. Jawablah selalu dalam bahasa Indonesia. 
    PENTING: Jika kamu berada di dalam grup, pesan dari pengguna akan diawali dengan format [Dikirim oleh: Nama]. Gunakan nama tersebut untuk membedakan siapa yang sedang berbicara denganmu dan balaslah dengan menyebut nama mereka jika dirasa cocok agar lebih akrab.
    INSTRUKSI UNTUK MEMORI: Analisislah apakah pertanyaan atau pernyataan pengguna saat ini benar-benar mengubah topik pembicaraan dari riwayat obrolan sebelumnya. Jika YA (pengguna membahas topik yang sama sekali baru), kamu WAJIB mengawali balasanmu dengan teks persis seperti ini: [RESET_KONTEKS]. Jika topik masih berlanjut atau berkaitan, jangan pernah gunakan teks tersebut.`;

            if (!memoriPercakapan.has(idPengirim)) {
                memoriPercakapan.set(idPengirim, [{ role: 'system', content: systemPrompt }]);
            }

            let riwayat = memoriPercakapan.get(idPengirim);
            riwayat.push({ role: 'user', content: pesanUser });

            if (riwayat.length > 11) {
                riwayat.splice(1, 2);
            }

            try {
                // 1. KIRIM PESAN AWAL (DENGAN PELINDUNG 2: ANTI-CRASH WA WEB)
                let teksAwal = aiModel === 'deepseek-reasoner' ? 'Thinking...' : 'Typing...';
                let pesanAwal;

                try {
                    if (chat.isGroup) {
                        pesanAwal = await msg.reply(teksAwal);
                    } else {
                        pesanAwal = await chat.sendMessage(teksAwal);
                    }
                } catch (errReply) {
                    // JIKA WA WEB MENOLAK msg.reply KARENA BUG PESAN LAMA, PAKSA KIRIM TANPA MENGUTIP
                    console.log('[WARNING] WA menolak Reply. Memaksa kirim langsung...');
                    pesanAwal = await chat.sendMessage(teksAwal);
                }

                console.log(`[INFO] Mengirim request ke API DeepSeek (${aiModel})...`);

                // 2. MINTA DEEPSEEK UNTUK STREAMING
                const response = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: aiModel,
                        messages: riwayat,
                        stream: true
                    })
                });

                if (!response.ok) {
                    console.error(`[ERROR] API DeepSeek: ${response.status} - ${response.statusText}`);
                    await pesanAwal.edit(`⚠️ Maaf, API DeepSeek sedang sibuk (Error ${response.status}).`);
                    memoriPercakapan.get(idPengirim).pop();
                    return;
                }

                // --- PERBAIKAN: PEMBACA STREAM SUPER AKURAT ---
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");

                let balasanAI = '';
                let pemikiranAI = '';
                let bufferData = '';
                let waktuEditTerakhir = Date.now();
                let jumlahEdit = 0;
                // prosesEditBerjalan = pesanAwal.edit(teksSementara + ' ⏳').catch((err) => {
                //     console.error('[WARNING] WA menolak edit:', err.message);
                // });
                let prosesEditBerjalan = null;

                console.log('[INFO] Mulai menerima data stream dari AI...');

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        console.log('[INFO] Aliran data selesai.');
                        break;
                    }

                    // Terjemahkan serpihan data menjadi teks
                    bufferData += decoder.decode(value, { stream: true });
                    const lines = bufferData.split('\n');

                    // Simpan baris terakhir yang mungkin belum utuh
                    bufferData = lines.pop();

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (trimmedLine.startsWith('data: ')) {
                            const dataString = trimmedLine.substring(6);
                            if (dataString === '[DONE]') continue;

                            try {
                                const parsedData = JSON.parse(dataString);
                                const delta = parsedData.choices[0].delta;

                                if (delta.reasoning_content) {
                                    pemikiranAI += delta.reasoning_content;
                                }
                                if (delta.content) {
                                    balasanAI += delta.content;
                                }
                            } catch (error) {
                                // Abaikan error parsing JSON dari server
                            }
                        }
                    }

                    // 4. THROTTLING (JEDA 3 DETIK)
                    if (Date.now() - waktuEditTerakhir > 3000) {
                        waktuEditTerakhir = Date.now();

                        let teksSementara = '';
                        if (pemikiranAI) {
                            teksSementara += `*Thinking...*\n<think>${pemikiranAI}</think>\n\n`;
                        }
                        if (balasanAI) {
                            teksSementara += `*Typing...*\n${balasanAI.replace(/\[RESET_KONTEKS\]|\[Dikirim oleh:.*?\]/gi, '')}`;
                        }

                        // Pastikan ada teks baru sebelum memaksa WhatsApp mengedit
                        // Pastikan ada teks baru sebelum memaksa WhatsApp mengedit
                        if (teksSementara.trim().length > 0) {
                            jumlahEdit++;
                            console.log(`[INFO] Mengirim perintah edit ke WA (ke-${jumlahEdit})...`);

                            // ✅ BENAR: Eksekusi edit dilakukan di sini dan disimpan ke variabel pelacak
                            prosesEditBerjalan = pesanAwal.edit(teksSementara + ' ⏳').catch((err) => {
                                console.error('[WARNING] WA menolak edit:', err.message);
                            });
                        }
                    }
                }

                // ==========================================
                // 5. HASIL AKHIR (SETELAH STREAMING SELESAI)
                // ==========================================

                let balasanBersih = balasanAI.replace(/\[Dikirim oleh:.*?\]/gi, '').trim();
                const mintaReset = balasanBersih.includes('[RESET_KONTEKS]');

                if (mintaReset) {
                    balasanBersih = balasanBersih.replace('[RESET_KONTEKS]', '').trim();

                    if (!isReplyingToBot) {
                        riwayat = [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: pesanUser },
                            { role: 'assistant', content: balasanBersih }
                        ];
                        memoriPercakapan.set(idPengirim, riwayat);
                    }
                } else {
                    riwayat.push({ role: 'assistant', content: balasanBersih });
                }

                // Merakit tampilan pesan final
                let teksAkhir = '';
                if (pemikiranAI) {
                    teksAkhir += `\n<think>${pemikiranAI.trim()}</think>\n\n`;
                }
                if (mintaReset && !isReplyingToBot) {
                    teksAkhir += `Hi! `;
                }
                teksAkhir += `${balasanBersih}`;

                // PELINDUNG 3: Jangan biarkan bot mencoba mengedit dengan teks kosong
                // PELINDUNG 3: Jangan biarkan bot mencoba mengedit dengan teks kosong
                if (teksAkhir.trim().length === 0) {
                    teksAkhir = '⚠️ Maaf, AI memberikan jawaban kosong.';
                }

                // --- PERBAIKAN BUG TABRAKAN EDIT ---
                // 1. Tunggu sampai proses edit sementara (⏳) sebelumnya benar-benar selesai
                if (prosesEditBerjalan) {
                    await prosesEditBerjalan;
                }
                // 2. Beri jeda napas ekstra 1.5 detik agar server WhatsApp tidak menolak edit final ini
                await new Promise(resolve => setTimeout(resolve, 1500));
                // -----------------------------------

                console.log('[INFO] Menerapkan hasil akhir ke WhatsApp...');
                await pesanAwal.edit(teksAkhir);

            } catch (error) {
                console.error('[ERROR] Kerusakan fatal pada proses Stream:', error);
                memoriPercakapan.get(idPengirim).pop();
                // JANGAN gunakan msg.reply di sini! Kita ganti dengan chat.sendMessage agar tidak memicu crash berantai
                chat.sendMessage('⚠️ Terjadi kesalahan jaringan atau pesan gagal diperbarui oleh WhatsApp.').catch(() => { });
            }
        }
    });

    client.on('ready', () => {
        console.log('Reminder sudah siap dan terhubung!');

        // Membuat jadwal setiap jam 21:30 WIB (Waktu Indonesia Barat)
        // Format Cron: Menit(30) Jam(21) Tanggal(*) Bulan(*) Hari(*)
        cron.schedule('30 21 * * *', async () => {

            // 1. GANTI INI: Masukkan ID Grup tempat bot akan mengirim pesan
            // Ingat, ID grup WA selalu diakhiri dengan @g.us
            const idGrup = '120363406357901129@g.us';

            // 2. GANTI INI: Masukkan daftar nomor orang yang ingin di-tag
            // Pastikan formatnya menggunakan kode negara (62) dan diakhiri @c.us
            const daftarNomor = [
                '6285156529790@c.us',
                '6281227990007@c.us'
            ];

            try {
                // Mengambil data grup
                const chatGrup = await client.getChatById(idGrup);

                // Menyiapkan variabel untuk fitur mention
                let kontakYangDiTag = [];
                let teksPesan = 'Hannnn, Ayaaaaa udaahhh mayemmm ihhhh, bobooooo 😠😠😠😠😠 ';

                // Mengambil data setiap kontak agar nama mereka tersorot biru (di-tag)
                for (let nomor of daftarNomor) {
                    const kontak = await client.getContactById(nomor);
                    kontakYangDiTag.push(kontak);
                    teksPesan += `@${nomor.split('@')[0]} `; // Menambahkan @62812... ke dalam teks
                }

                // Mengirim pesan ke grup tersebut dengan mention
                await chatGrup.sendMessage(teksPesan, { mentions: kontakYangDiTag });
                console.log('Berhasil mengirim pesan jadwal otomatis ke grup!');

            } catch (error) {
                console.error('Gagal mengirim pesan terjadwal:', error);
            }

        }, {
            scheduled: true,
            timezone: "Asia/Jakarta" // Menyesuaikan zona waktu (WIB)
        });
    });

} // End of setupClientEvents()

let isAutoReadEnabled = true;
let isAutoSummaryEnabled = true;
const stopwatchData = new Map();
let listRemindersSatuKali = [];


// Menangani proses keluar (Ctrl+C)
process.on('SIGINT', async () => {
    console.log('\nMematikan bot dengan aman...');
    if (client) await client.destroy();
    if (mongoose.connection.readyState === 1) await mongoose.connection.close();
    process.exit(0);
});