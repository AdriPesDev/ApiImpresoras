const mysql = require("mysql2/promise");
require("dotenv").config();

// Configuración de la conexión a MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "control_impresoras",
  // El servidor MySQL tarda ~10s en el handshake desde hosts remotos (DNS inverso
  // con skip-name-resolve desactivado). El timeout por defecto (10s) moría justo
  // en el límite. Lo subimos y mantenemos las conexiones del pool vivas para no
  // repagar ese coste en cada query. Solución de raíz: `skip-name-resolve` en el servidor.
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT) || 30000,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  timezone: "Z",
});

// Probar la conexión
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log("✅ Conexión a MySQL establecida correctamente");
    connection.release();
    return true;
  } catch (error) {
    console.error("❌ Error conectando a MySQL:", error.message);
    return false;
  }
};

module.exports = { pool, testConnection };
