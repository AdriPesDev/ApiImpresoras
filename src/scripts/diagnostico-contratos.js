// Diagnóstico rápido de las tablas de contratos.
// Ejecutar desde la raíz del proyecto: node src/scripts/diagnostico-contratos.js

require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT || 3306,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 30000,
  });

  const q = async (sql) => { const [r] = await conn.query(sql); return r; };

  console.log('\n=== DIAGNÓSTICO CONTRATOS ===\n');

  // 1. Tablas nuevas
  const [[nc]] = await conn.query('SELECT COUNT(*) AS n FROM contratos');
  const [[nci]] = await conn.query('SELECT COUNT(*) AS n FROM contrato_impresoras');
  console.log(`contratos (nueva):           ${nc.n} filas`);
  console.log(`contrato_impresoras (nueva): ${nci.n} filas`);

  if (nci.n > 0) {
    const rows = await q('SELECT id, contrato_id, impresora_id, empresa_id, activo FROM contrato_impresoras LIMIT 5');
    console.log('  Muestra contrato_impresoras:', rows);
  }

  // 2. Tabla legada
  try {
    const [[lc]] = await conn.query('SELECT COUNT(*) AS n FROM contratos_impresoras');
    console.log(`\ncontratos_impresoras (legada): ${lc.n} filas`);
    if (lc.n > 0) {
      const rows = await q('SELECT id, impresora_id, empresa_id, numero_contrato, activo, fecha_inicio FROM contratos_impresoras LIMIT 10');
      console.log('  Muestra contratos_impresoras (legada):', rows);
    }
  } catch (e) {
    console.log(`\ncontratos_impresoras (legada): NO EXISTE (${e.message})`);
  }

  // 3. Revisar si hay contrato_impresoras sin contrato header válido
  const huerfanas = await q(`
    SELECT ci.id, ci.contrato_id, ci.impresora_id
    FROM contrato_impresoras ci
    LEFT JOIN contratos c ON c.id = ci.contrato_id
    WHERE c.id IS NULL
  `);
  console.log(`\nFilas contrato_impresoras sin cabecera en contratos: ${huerfanas.length}`);
  if (huerfanas.length) console.log('  Huérfanas:', huerfanas);

  // 4. Contenido completo de contratos
  const allContratos = await q('SELECT id, numero_contrato, empresa_id, activo, fecha_inicio FROM contratos');
  console.log(`\nTodas las filas de contratos (${allContratos.length}):`, allContratos);

  await conn.end();
  console.log('\n=== FIN DIAGNÓSTICO ===\n');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
