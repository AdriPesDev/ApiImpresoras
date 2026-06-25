/**
 * Crea en el Dolibarr local las empresas que tienen consumos pendientes
 * y actualiza su dolibarr_id en la tabla empresas.
 *
 * Uso: npx dotenv -e .env.local -- node src/scripts/sync-empresas-dolibarr.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const DOLIBARR_URL = process.env.DOLIBARR_URL?.replace(/\/$/, '');
const DOLIBARR_API_KEY = process.env.DOLIBARR_API_KEY;

async function dolibarrGet(endpoint, params = {}) {
  const url = new URL(`${DOLIBARR_URL}/api/index.php/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { DOLAPIKEY: DOLIBARR_API_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GET ${endpoint} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function dolibarrPost(endpoint, payload) {
  const res = await fetch(`${DOLIBARR_URL}/api/index.php/${endpoint}`, {
    method: 'POST',
    headers: { DOLAPIKEY: DOLIBARR_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`POST ${endpoint} → ${res.status} ${await res.text()}`);
  return res.json();
}

// Escapa caracteres especiales para el filtro SQL de Dolibarr
function escaparFiltro(nombre) {
  return nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/%/g, '\\%');
}

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // Empresas con consumos pendientes
  const [rows] = await pool.query(`
    SELECT DISTINCT e.id, e.nombre_oficial, e.cif, e.dolibarr_id
    FROM empresas e
    INNER JOIN impresoras i ON i.empresa_id = e.id
    INNER JOIN consumos_mensuales cm ON cm.impresora_id = i.id
    WHERE cm.facturado = 0
    ORDER BY e.nombre_oficial
  `);

  console.log(`\nEmpresas con consumos pendientes: ${rows.length}\n`);

  // Eliminar el índice único de dolibarr_id para poder reasignar IDs libremente
  try {
    await pool.query('ALTER TABLE empresas DROP INDEX dolibarr_id');
    console.log('Índice único en dolibarr_id eliminado (entorno local).\n');
  } catch (_) {
    // Ya no existía o tiene otro nombre — continuar igualmente
  }

  // Ver cuántos terceros hay ya en Dolibarr local
  try {
    const test = await dolibarrGet('thirdparties', { limit: 1 });
    console.log(`Dolibarr local accesible. Procediendo...\n`);
  } catch (e) {
    console.error(`\n✗ No se puede conectar al Dolibarr local: ${e.message}`);
    console.error(`  Verifica que está corriendo en ${DOLIBARR_URL} y que la API key es correcta.\n`);
    await pool.end();
    process.exit(1);
  }

  let creadas = 0, yaExistian = 0, errores = 0;
  const fallidas = [];

  for (const empresa of rows) {
    try {
      // Buscar por nombre exacto
      let dolibarrId = null;
      try {
        const busqueda = await dolibarrGet('thirdparties', {
          sqlfilters: `(t.nom:=:'${escaparFiltro(empresa.nombre_oficial)}')`,
          limit: 1,
        });
        if (Array.isArray(busqueda) && busqueda.length > 0) {
          dolibarrId = Number(busqueda[0].id ?? busqueda[0].rowid ?? busqueda[0].ref);
        }
      } catch (_) {
        // Si el filtro falla por caracteres raros, intentar búsqueda por página
      }

      if (dolibarrId) {
        yaExistian++;
        console.log(`  ↺  [${empresa.id}] ${empresa.nombre_oficial} → ya existe (id ${dolibarrId})`);
      } else {
        const nombreLimpio = empresa.nombre_oficial.trim().substring(0, 128);
        const payload = {
          name: nombreLimpio,
          status: 1,
          client: 1,
          // No enviamos code_client: el Dolibarr local valida el formato del CIF y rechaza los que no cumplen
        };
        const resp = await dolibarrPost('thirdparties', payload);
        if (typeof resp === 'number') {
          dolibarrId = resp;
        } else if (typeof resp === 'string' && !isNaN(Number(resp))) {
          dolibarrId = Number(resp);
        } else if (resp && typeof resp === 'object') {
          dolibarrId = Number(resp.id ?? resp.rowid ?? resp.ref);
        }
        if (!dolibarrId || isNaN(dolibarrId)) {
          throw new Error(`Respuesta inesperada de Dolibarr: ${JSON.stringify(resp)}`);
        }
        creadas++;
        console.log(`  ✓  [${empresa.id}] ${empresa.nombre_oficial} → creada (id ${dolibarrId})`);
      }

      await pool.query('UPDATE empresas SET dolibarr_id = ? WHERE id = ?', [dolibarrId, empresa.id]);

    } catch (err) {
      errores++;
      fallidas.push({ nombre: empresa.nombre_oficial, error: err.message });
      console.error(`  ✗  [${empresa.id}] ${empresa.nombre_oficial}`);
      console.error(`       ${err.message}`);
    }
  }

  console.log(`\n──────────────────────────────────────`);
  console.log(`Creadas: ${creadas} | Ya existían: ${yaExistian} | Errores: ${errores}`);
  if (fallidas.length) {
    console.log(`\nEmpresas con error:`);
    fallidas.forEach(f => console.log(`  - ${f.nombre}: ${f.error}`));
  }
  console.log(`──────────────────────────────────────\n`);

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
