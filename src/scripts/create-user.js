#!/usr/bin/env node
// ============================================================
// Crea un usuario en la tabla 'usuarios'.
//
// Uso:
//   node scripts/create-user.js <username> <password> <rol>
//
// Ejemplo:
//   node scripts/create-user.js admin MiContraseña123 admin
//   node scripts/create-user.js viewer viewer123 viewer
//
// Requiere las variables de entorno de BD en .env
// ============================================================

const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config();

async function main() {
  const [,, username, password, rol] = process.argv;

  if (!username || !password || !rol) {
    console.error('Uso: node scripts/create-user.js <username> <password> <rol>');
    console.error('Roles válidos: admin, viewer');
    process.exit(1);
  }

  if (!['admin', 'viewer'].includes(rol)) {
    console.error(`Rol "${rol}" no válido. Usa "admin" o "viewer".`);
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'control_impresoras',
  });

  try {
    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      `INSERT INTO usuarios (username, email, password, rol, activo)
       VALUES (?, ?, ?, ?, TRUE)`,
      [username, `${username}@local`, hash, rol],
    );

    console.log(`✅ Usuario "${username}" creado con rol "${rol}".`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      console.error(`❌ El usuario "${username}" ya existe.`);
    } else {
      console.error('❌ Error:', err.message);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
