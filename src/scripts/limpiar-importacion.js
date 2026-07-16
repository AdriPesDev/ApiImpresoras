/**
 * limpiar-importacion.js
 *
 * Limpia los datos de una importación de un día concreto para poder repetir
 * la prueba desde cero.
 *
 * Uso:
 *   node src/scripts/limpiar-importacion.js                  (dry-run, muestra qué borrará)
 *   node src/scripts/limpiar-importacion.js --confirmar      (borra realmente)
 *   node src/scripts/limpiar-importacion.js --fecha 2026-06-24   (otra fecha, default=ayer)
 *   node src/scripts/limpiar-importacion.js --periodo 2026-06    (para consumos_mensuales)
 *   node src/scripts/limpiar-importacion.js --confirmar --incluir-facturadas
 *                                  (además borra lo ya facturado — PELIGRO, ver abajo)
 *
 * Qué borra:
 *   1. historial_importaciones  → registros importados en la fecha indicada
 *                                  (permite re-importar el mismo fichero CSV)
 *   2. logs_facturacion         → logs del periodo (para poder re-facturar en mock)
 *   3. consumos_mensuales       → filas del periodo con facturado=0
 *                                  (permite recalcular consumos al re-importar)
 *   4. registros_contadores     → ultima lectura de cada impresora si está
 *                                  dentro del periodo indicado
 *                                  (permite que la re-importación registre lecturas limpias)
 *
 * Por defecto, las filas facturado=1 (facturas ya emitidas en Dolibarr) y las
 * lecturas de las impresoras que las respaldan quedan PROTEGIDAS: nunca se
 * borran sin pasar --incluir-facturadas. Sin esa protección, este script podía
 * borrar el rastro local de facturas reales ya enviadas a Dolibarr.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

// ── Argumentos ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const confirmar = args.includes('--confirmar');
const incluirFacturadas = args.includes('--incluir-facturadas');

const fechaIdx = args.indexOf('--fecha');
let fechaImportacion;
if (fechaIdx !== -1 && args[fechaIdx + 1]) {
  fechaImportacion = args[fechaIdx + 1];
} else {
  // Ayer por defecto
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  fechaImportacion = ayer.toISOString().slice(0, 10);
}

const periodoIdx = args.indexOf('--periodo');
let periodo;
if (periodoIdx !== -1 && args[periodoIdx + 1]) {
  periodo = args[periodoIdx + 1];
} else {
  // Derivar el periodo del mes de la fecha de importación
  periodo = fechaImportacion.slice(0, 7); // 'YYYY-MM'
}

// ── Conexión ──────────────────────────────────────────────────────────────────
async function getPool() {
  return mysql.createPool({
    host:              process.env.DB_HOST,
    port:              parseInt(process.env.DB_PORT || '3306', 10),
    user:              process.env.DB_USER,
    password:          process.env.DB_PASSWORD,
    database:          process.env.DB_NAME,
    connectTimeout:    30000,
    waitForConnections: true,
    connectionLimit:   3,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  LIMPIEZA DE IMPORTACIÓN`);
  console.log(`  Fecha importación : ${fechaImportacion}`);
  console.log(`  Periodo consumos  : ${periodo}`);
  console.log(`  Modo              : ${confirmar ? '⚠️  BORRADO REAL' : '🔍 DRY-RUN (sin cambios)'}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  const pool = await getPool();

  try {
    // ── 1. historial_importaciones ─────────────────────────────────────────
    const [historial] = await pool.query(
      `SELECT id, nombre_archivo, total_registros, fecha_importacion, usuario
       FROM historial_importaciones
       WHERE DATE(fecha_importacion) = ?
       ORDER BY fecha_importacion`,
      [fechaImportacion],
    );

    console.log(`📋 historial_importaciones (fecha ${fechaImportacion}):`);
    if (historial.length === 0) {
      console.log('   → Ningún registro encontrado para esa fecha.\n');
    } else {
      historial.forEach((h) => {
        console.log(`   • [${h.id}] ${h.nombre_archivo}  (${h.total_registros} registros, ${h.fecha_importacion})`);
      });
      console.log(`   → ${historial.length} fila(s) se borrarán.\n`);
    }

    // ── 2. logs_facturacion ────────────────────────────────────────────────
    const [logs] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM logs_facturacion WHERE periodo = ?`,
      [periodo],
    );
    const nLogs = logs[0].cnt;
    console.log(`🧾 logs_facturacion (periodo ${periodo}):`);
    if (incluirFacturadas) {
      console.log(`   → ${nLogs} fila(s) se borrarán.\n`);
    } else {
      console.log(`   → ${nLogs} fila(s) PROTEGIDAS (log de facturas reales). Usa --incluir-facturadas para borrarlas.\n`);
    }

    // ── 3. consumos_mensuales: solo facturado=0 se borra por defecto ──────
    const [consumos] = await pool.query(
      `SELECT
         SUM(facturado = 0) AS pendientes,
         SUM(facturado = 1) AS facturados
       FROM consumos_mensuales WHERE periodo = ?`,
      [periodo],
    );
    const nPendientes = consumos[0].pendientes || 0;
    const nFacturados = consumos[0].facturados || 0;
    console.log(`📊 consumos_mensuales (periodo ${periodo}):`);
    console.log(`   • Pendientes (facturado=0): ${nPendientes} → se borrarán.`);
    console.log(`   • Ya facturados (facturado=1): ${nFacturados} → ${incluirFacturadas ? 'se borrarán (--incluir-facturadas)' : 'PROTEGIDAS, no se borran'}.\n`);

    // Impresoras con un consumo ya facturado en este periodo: sus lecturas
    // tampoco se tocan salvo --incluir-facturadas (evitan borrar la evidencia
    // de una factura real ya emitida en Dolibarr).
    const [facturadasRows] = await pool.query(
      `SELECT cm.impresora_id, i.serial_number
       FROM consumos_mensuales cm
       INNER JOIN impresoras i ON i.id = cm.impresora_id
       WHERE cm.periodo = ? AND cm.facturado = 1`,
      [periodo],
    );
    const impresorasProtegidas = new Set(facturadasRows.map((r) => r.impresora_id));
    if (facturadasRows.length && !incluirFacturadas) {
      console.log(`🔒 Impresoras con factura real en ${periodo} (lecturas protegidas): ${facturadasRows.map((r) => r.serial_number).join(', ')}\n`);
    }

    // ── 4. registros_contadores: última lectura en el periodo ──────────────
    const [regsAll] = await pool.query(
      `SELECT rc.id, rc.impresora_id, i.serial_number, i.modelo, rc.fecha_lectura
       FROM registros_contadores rc
       INNER JOIN impresoras i ON i.id = rc.impresora_id
       INNER JOIN (
         SELECT impresora_id, MAX(fecha_lectura) AS max_fecha
         FROM registros_contadores
         GROUP BY impresora_id
       ) latest ON rc.impresora_id = latest.impresora_id
                AND rc.fecha_lectura = latest.max_fecha
       WHERE DATE_FORMAT(rc.fecha_lectura, '%Y-%m') = ?
       ORDER BY i.serial_number`,
      [periodo],
    );
    const regsPreview = incluirFacturadas
      ? regsAll
      : regsAll.filter((r) => !impresorasProtegidas.has(r.impresora_id));
    const regsProtegidos = regsAll.length - regsPreview.length;

    console.log(`🖨️  registros_contadores (última lectura por impresora en periodo ${periodo}):`);
    if (regsPreview.length === 0) {
      console.log('   → Ningún registro encontrado.\n');
    } else {
      regsPreview.slice(0, 10).forEach((r) => {
        console.log(`   • [${r.id}] ${r.serial_number} — ${r.modelo} — ${r.fecha_lectura}`);
      });
      if (regsPreview.length > 10) {
        console.log(`   … y ${regsPreview.length - 10} más`);
      }
      console.log(`   → ${regsPreview.length} fila(s) se borrarán.`);
    }
    if (regsProtegidos > 0) {
      console.log(`   (${regsProtegidos} lectura(s) excluida(s) por pertenecer a impresoras con factura real)`);
    }
    console.log('');

    // ── Resumen final ──────────────────────────────────────────────────────
    if (!confirmar) {
      console.log('══════════════════════════════════════════════════════════════');
      console.log('  DRY-RUN completado — ningún dato modificado.');
      console.log('  Para borrar realmente ejecuta con --confirmar:');
      console.log(`  node src/scripts/limpiar-importacion.js --confirmar --fecha ${fechaImportacion} --periodo ${periodo}`);
      console.log('══════════════════════════════════════════════════════════════\n');
      return;
    }

    // ── Borrado real ──────────────────────────────────────────────────────
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1. historial
      if (historial.length > 0) {
        const ids = historial.map((h) => h.id);
        await conn.query(
          `DELETE FROM historial_importaciones WHERE id IN (${ids.map(() => '?').join(',')})`,
          ids,
        );
        console.log(`✅ historial_importaciones: ${historial.length} fila(s) borrada(s).`);
      }

      // 2. logs_facturacion (protegido salvo --incluir-facturadas)
      if (incluirFacturadas) {
        const [delLogs] = await conn.query(
          `DELETE FROM logs_facturacion WHERE periodo = ?`,
          [periodo],
        );
        console.log(`✅ logs_facturacion: ${delLogs.affectedRows} fila(s) borrada(s).`);
      } else {
        console.log(`⏭️  logs_facturacion: 0 fila(s) borrada(s) (protegido, usa --incluir-facturadas).`);
      }

      // 3. consumos_mensuales (facturado=0 siempre; facturado=1 solo con --incluir-facturadas)
      const [delConsumos] = await conn.query(
        incluirFacturadas
          ? `DELETE FROM consumos_mensuales WHERE periodo = ?`
          : `DELETE FROM consumos_mensuales WHERE periodo = ? AND facturado = 0`,
        [periodo],
      );
      console.log(`✅ consumos_mensuales: ${delConsumos.affectedRows} fila(s) borrada(s).`);

      // 4. registros_contadores (regsPreview ya excluye las protegidas)
      if (regsPreview.length > 0) {
        const regIds = regsPreview.map((r) => r.id);
        const [delRegs] = await conn.query(
          `DELETE FROM registros_contadores WHERE id IN (${regIds.map(() => '?').join(',')})`,
          regIds,
        );
        console.log(`✅ registros_contadores: ${delRegs.affectedRows} fila(s) borrada(s).`);
      }

      await conn.commit();
      console.log('\n✅ Borrado completado. Ya puedes re-importar el CSV y repetir la prueba.\n');
    } catch (err) {
      await conn.rollback();
      console.error('\n❌ Error durante el borrado — rollback aplicado:', err.message);
      throw err;
    } finally {
      conn.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
