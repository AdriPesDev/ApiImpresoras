// test-db.js
const mysql = require("mysql2/promise");
require("dotenv").config();

async function testConnection() {
  console.log("🔍 Probando conexión a MySQL...");
  console.log("📊 Configuración:");
  console.log(`   Host: ${process.env.DB_HOST}`);
  console.log(`   Puerto: ${process.env.DB_PORT}`);
  console.log(`   Usuario: ${process.env.DB_USER}`);
  console.log(`   Base de datos: ${process.env.DB_NAME}`);

  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    console.log("✅ Conexión exitosa!");
    const [rows] = await connection.execute("SELECT 1+1 as result");
    console.log("✅ Query de prueba exitosa:", rows[0]);

    await connection.end();
    return true;
  } catch (error) {
    console.log("❌ Error de conexión:");
    console.log("   Código:", error.code);
    console.log("   Mensaje:", error.message);
    console.log("   Errno:", error.errno);
    console.log("   SQL State:", error.sqlState);
    return false;
  }
}

testConnection();
