/**
 * Test de integración Dolibarr LOCAL (Docker).
 *
 * Lee un consumo REAL de la BD de producción (solo lectura)
 * y crea una factura de prueba en el Dolibarr local.
 *
 * Uso: node test_dolibarr_local.js <API_KEY_LOCAL>
 *      API_KEY_LOCAL = clave generada en el perfil del admin de http://localhost:8069
 */
const LOCAL_URL = 'http://localhost:8069';
const LOCAL_KEY = process.argv[2];

if (!LOCAL_KEY) {
  console.error('Uso: node test_dolibarr_local.js <API_KEY_LOCAL>');
  console.error('Obtén la clave en http://localhost:8069 → Perfil usuario → Generar clave API');
  process.exit(1);
}

// Override ANTES de requerir cualquier servicio
process.env.DOLIBARR_URL = LOCAL_URL;
process.env.DOLIBARR_API_KEY = LOCAL_KEY;

const API = __dirname;
const mysql = require(API + '/node_modules/mysql2/promise');
require(API + '/node_modules/dotenv').config({ path: API + '/.env' });
const DolibarrService = require(API + '/src/services/dolibarr.service');
const { nombreMes } = require(API + '/src/services/motorFacturacion');

(async () => {
  const doli = new DolibarrService();

  // ── 1. Conectividad (usa /users/info — siempre devuelve 200) ────────────────
  console.log('=== 1) Conectividad Dolibarr local ===');
  try {
    const r = await fetch(`${LOCAL_URL}/api/index.php/users/info`, {
      headers: { DOLAPIKEY: LOCAL_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const u = await r.json();
    console.log(`OK — usuario: ${u.login} (admin: ${u.admin})`);
  } catch (e) {
    console.error('FALLO de conectividad:', e.message);
    console.error('Asegúrate de que el Docker está corriendo y la API key es válida.');
    process.exit(1);
  }

  // ── 2. Crear tercero de test ────────────────────────────────────────────────
  console.log('\n=== 2) Crear tercero de test ===');
  let socid;
  try {
    socid = await doli.post('thirdparties', {
      name: 'TEST EMPRESA SL',
      client: 1,
      fournisseur: 0,
      country_id: 4,
    });
    console.log(`Tercero creado con ID: ${socid}`);
  } catch (e) {
    console.error('Error creando tercero:', e.message);
    process.exit(1);
  }

  // ── 3. Leer consumo real de BD prod (solo lectura) ──────────────────────────
  console.log('\n=== 3) Consumo real de BD prod (solo lectura) ===');
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, connectTimeout: 30000, timezone: 'Z',
  });

  const [rows] = await pool.query(`
    SELECT cm.*, i.serial_number, i.modelo, e.nombre_oficial AS empresa
    FROM consumos_mensuales cm
    JOIN impresoras i ON i.id = cm.impresora_id
    LEFT JOIN empresas e ON e.id = i.empresa_id
    WHERE cm.copias_bn_mes > 0
    ORDER BY cm.periodo DESC
    LIMIT 1
  `);
  await pool.end();

  if (!rows.length) {
    console.error('No hay consumos en la BD. Importa primero el CSV de junio.');
    process.exit(1);
  }
  const c = rows[0];
  console.log(`${c.serial_number} (${c.modelo}) — ${c.empresa}`);
  console.log(`Periodo: ${c.periodo}  BN: ${c.copias_bn_mes}  Total: ${Number(c.total_facturar).toFixed(2)}€`);

  // ── 4. Construir payload (idéntico al de facturacion.service) ───────────────
  console.log('\n=== 4) Payload de factura ===');
  const periodoStr = typeof c.periodo === 'string' ? c.periodo : c.periodo.toISOString().slice(0, 7);
  const [yyyy] = periodoStr.split('-').map(Number);
  const mesNombreStr = nombreMes(periodoStr);
  const hoy = Math.floor(Date.now() / 1000);
  const vencimiento = hoy + 30 * 86400;

  const lineas = [];

  if (c.copias_bn_mes > 0) {
    const precioBn = c.copias_bn_mes > 0 ? Number(c.importe_bn) / c.copias_bn_mes : 0;
    lineas.push({
      desc: `[TEST LOCAL] Copias B/N ${mesNombreStr} ${yyyy}\nImpresora: ${c.serial_number} (${c.modelo})\nCopias: ${c.copias_bn_mes}`,
      qty: c.copias_bn_mes,
      subprice: parseFloat(precioBn.toFixed(6)),
      tva_tx: 21,
      product_type: 1,
    });
  }

  if (Number(c.copias_color_mes) > 0) {
    const precioC = Number(c.importe_color) / Number(c.copias_color_mes);
    lineas.push({
      desc: `[TEST LOCAL] Copias Color ${mesNombreStr} ${yyyy}\nImpresora: ${c.serial_number}\nCopias: ${c.copias_color_mes}`,
      qty: Number(c.copias_color_mes),
      subprice: parseFloat(precioC.toFixed(6)),
      tva_tx: 21,
      product_type: 1,
    });
  }

  const payload = {
    socid: String(socid),
    type: 0,
    date: hoy,
    date_lim_reglement: vencimiento,
    cond_reglement_id: 1,
    lines: lineas,
  };

  console.log(`socid: ${payload.socid}  líneas: ${lineas.length}`);
  console.log('línea[0]:', lineas[0]?.desc?.replace(/\n/g, ' ').slice(0, 80));

  // ── 5. Crear factura en Dolibarr local ─────────────────────────────────────
  console.log('\n=== 5) crearFactura → Dolibarr local ===');
  let facturaId;
  try {
    facturaId = await doli.crearFactura(payload);
    console.log(`✓ Factura creada con ID: ${facturaId}`);
  } catch (e) {
    console.error('Error al crear factura:', e.message);
    process.exit(1);
  }

  // ── 6. Verificar que existe ─────────────────────────────────────────────────
  console.log('\n=== 6) Verificación ===');
  try {
    const resp = await fetch(`${LOCAL_URL}/api/index.php/invoices/${facturaId}`, {
      headers: { DOLAPIKEY: LOCAL_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const factura = await resp.json();
    console.log(`status: ${factura.statut}  total_ttc: ${factura.total_ttc}€  socid: ${factura.socid}`);
    console.log(`ref: ${factura.ref}`);
    console.log(`\n✓ DONE — Factura visible en http://localhost:8069 (ref: ${factura.ref})`);
    console.log('Si la factura es correcta, el flujo de producción está listo.');
  } catch (e) {
    console.log(`Factura creada (ID ${facturaId}) pero no se pudo verificar:`, e.message);
    console.log('Compruébala en http://localhost:8069');
  }
})().catch(e => {
  console.error('\nFATAL:', e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
