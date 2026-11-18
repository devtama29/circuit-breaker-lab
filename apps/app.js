const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');

const app = express();
app.use(express.json());

// --- Menerima Konfigurasi dari Environment Variables (Kubernetes) ---
const PORT = process.env.PORT || 80;
const SERVICE_CLASS = process.env.SERVICE_CLASS || 'ekonomi'; // Identitas layanan: 'ekonomi' / 'eksekutif'
const MAX_DB_CONNECTIONS = parseInt(process.env.MAX_DB_CONNECTIONS || '10'); // Pembatas Pool DB

// --- 1. Setup Koneksi PostgreSQL (Shared DB) ---
const pool = new Pool({
    host: process.env.DB_HOST || 'shared-db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'secret',
    database: process.env.DB_NAME || 'tiket_db',
    port: 5432,
    max: MAX_DB_CONNECTIONS // Implementasi isolasi perlindungan database
});

// --- 2. Setup Koneksi Redis (Terpisah per layanan) ---
const redisClient = redis.createClient({
    url: `redis://${process.env.REDIS_HOST || 'redis-ekonomi'}:6379`
});
redisClient.connect().catch(console.error);
redisClient.on('connect', () => console.log(`Terhubung ke ${process.env.REDIS_HOST}`));

// --- ENDPOINT GET: Membaca Jadwal ---
app.get('/schedules', async (req, res) => {
    try {
        const cacheKey = `jadwal_${SERVICE_CLASS}`;
        
        // A. Cek data di Redis Cache terlebih dahulu
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
            return res.json({ 
                source: 'redis_cache', 
                kelas: SERVICE_CLASS,
                data: JSON.parse(cachedData) 
            });
        }

        // B. Jika tidak ada di cache, query ke PostgreSQL (Ambil sesuai kelasnya saja)
        const query = 'SELECT id, rute, waktu, harga FROM schedules WHERE kelas = $1';
        const { rows } = await pool.query(query, [SERVICE_CLASS]);

        // C. Simpan hasil query ke Redis selama 60 detik (Time To Live)
        await redisClient.setEx(cacheKey, 60, JSON.stringify(rows));

        return res.json({ 
            source: 'database_postgres', 
            kelas: SERVICE_CLASS,
            data: rows 
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- ENDPOINT POST: Menambah Jadwal (Write) ---
app.post('/schedules', async (req, res) => {
    const { rute, waktu, harga } = req.body;
    try {
        // A. Insert ke PostgreSQL
        const query = 'INSERT INTO schedules (kelas, rute, waktu, harga) VALUES ($1, $2, $3, $4) RETURNING *';
        const { rows } = await pool.query(query, [SERVICE_CLASS, rute, waktu, harga]);
        
        // B. Invalidate (Hapus) Cache lama karena ada data baru
        await redisClient.del(`jadwal_${SERVICE_CLASS}`);
        
        return res.json({ 
            message: 'Jadwal berhasil ditambahkan dan cache diperbarui', 
            data: rows[0] 
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Layanan [${SERVICE_CLASS.toUpperCase()}] berjalan di port ${PORT}`);
});