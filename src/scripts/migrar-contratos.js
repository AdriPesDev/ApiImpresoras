// Migración de contratos implícitos (datos en tabla impresoras) al esquema canónico.
// Ejecutar desde la raíz del proyecto: node src/scripts/migrar-contratos.js
// Es idempotente: verifica antes de insertar, puede ejecutarse varias veces sin duplicados.

require('dotenv').config({ path: '.env.local' });
require('dotenv').config(); // fallback para vars no definidas en .env.local
const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host:               process.env.DB_HOST,
    port:               process.env.DB_PORT || 3306,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASSWORD,
    database:           process.env.DB_NAME,
    connectTimeout:     30000,
    waitForConnections: true,
    connectionLimit:    5,
  });

  console.log('\n=== MIGRACIÓN CONTRATOS ===\n');

  // Descubrir valores permitidos en el ENUM tipo_copias_incluidas
  const [[colInfo]] = await pool.query(
    "SHOW COLUMNS FROM contrato_impresoras LIKE 'tipo_copias_incluidas'"
  );
  let enumValues = [];
  const typeStr = colInfo?.Type ?? '';
  const enumMatch = typeStr.match(/enum\((.+)\)/i);
  if (enumMatch) {
    enumValues = enumMatch[1].split(',').map(v => v.replaceAll("'", '').trim());
  }
  console.log(`Valores ENUM tipo_copias_incluidas: [${enumValues.join(', ')}]`);

  // Descubrir valores distintos de tipo_facturacion en impresoras activas
  const [tiposImpresoras] = await pool.query(
    `SELECT tipo_facturacion, COUNT(*) AS n
     FROM impresoras
     WHERE activa = 1 AND empresa_id IS NOT NULL
     GROUP BY tipo_facturacion
     ORDER BY n DESC`
  );
  console.log('Valores tipo_facturacion en impresoras:');
  tiposImpresoras.forEach(r => console.log(`  "${r.tipo_facturacion}" (${r.n} impresoras)`));

  // Todos los contratos migrados usan 'mensual' (copias incluidas se reinician cada mes).
  const toTipoCopias = (_v) => 'mensual';
  console.log('tipo_copias_incluidas → "mensual" para todos los contratos migrados\n');

  // Impresoras activas sin contrato explícito en contrato_impresoras
  const [impresoras] = await pool.query(`
    SELECT i.id, i.serial_number, i.empresa_id, i.tipo_facturacion,
           i.precio_copia_bn, i.precio_copia_color1, i.precio_copia_color2, i.precio_copia_color3
    FROM impresoras i
    WHERE i.activa = 1
      AND i.empresa_id IS NOT NULL
      AND i.id NOT IN (
        SELECT DISTINCT impresora_id
        FROM contrato_impresoras
        WHERE impresora_id IS NOT NULL
      )
    ORDER BY i.empresa_id, i.serial_number
  `);

  console.log(`Impresoras a migrar: ${impresoras.length}`);
  if (impresoras.length === 0) {
    console.log('Nada que migrar.\n=== FIN ===\n');
    await pool.end();
    return;
  }

  let creados = 0;
  let saltados = 0;
  let errores = 0;

  for (const imp of impresoras) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Guard dentro de la transacción
      const [existing] = await conn.query(
        'SELECT id FROM contrato_impresoras WHERE impresora_id = ? LIMIT 1',
        [imp.id],
      );
      if (existing.length > 0) {
        saltados++;
        await conn.commit();
        continue;
      }

      // Cabecera del contrato (serial_number como número de contrato)
      const [ins] = await conn.query(
        'INSERT INTO contratos (numero_contrato, empresa_id, fecha_inicio, activo) VALUES (?, ?, CURDATE(), 1)',
        [imp.serial_number, imp.empresa_id],
      );
      const contratoId = ins.insertId;

      // Línea de impresora con precios migrados y tipo de copias mapeado
      const tipoCopias = toTipoCopias(imp.tipo_facturacion);
      await conn.query(
        `INSERT INTO contrato_impresoras
           (contrato_id, impresora_id, empresa_id, porcentaje_participacion,
            copias_bn_incluidas, copias_c1_incluidas, copias_c2_incluidas, copias_c3_incluidas,
            precio_bn, precio_color1, precio_color2, precio_color3,
            precio_minimo_mensual, tipo_copias_incluidas, activo)
         VALUES (?, ?, ?, 100, 0, 0, 0, 0, ?, ?, ?, ?, 0, ?, 1)`,
        [
          contratoId, imp.id, imp.empresa_id,
          imp.precio_copia_bn     || 0,
          imp.precio_copia_color1 || 0,
          imp.precio_copia_color2 || 0,
          imp.precio_copia_color3 || 0,
          tipoCopias,
        ],
      );

      await conn.commit();
      creados++;
      if (creados % 50 === 0) console.log(`  ... ${creados} creados`);
    } catch (err) {
      await conn.rollback();
      console.error(`  ERROR impresora ${imp.id} (${imp.serial_number}): ${err.message}`);
      errores++;
    } finally {
      conn.release();
    }
  }

  await pool.end();
  console.log(`\nResultado: ${creados} creados | ${saltados} saltados | ${errores} errores`);
  console.log('\n=== FIN MIGRACIÓN ===\n');
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
