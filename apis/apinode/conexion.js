require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 50,
  dateStrings: true
});

// Corta consultas lentas (p. ej. SLEEP/BENCHMARK inyectados).
// La conexion del evento es la cruda (callback): hay que pedir su wrapper
// promise para no lanzar una excepcion sincrona dentro del evento, que
// rompe la cola del pool en el servidor vivo.
pool.on('connection', (conexion) => {
  try {
    conexion.promise().query('SET SESSION max_statement_time = 5').catch(() => {});
  } catch (e) {
    // Nunca rompe la creacion de conexiones del pool.
  }
});

module.exports = pool;
