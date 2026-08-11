/**
 * Carga masiva de un CSV Kyofleet para pruebas de facturación a gran escala:
 * da de alta las impresoras nuevas con un precio pequeño aleatorio (para
 * poder comprobar que cada una factura distinto), importa las lecturas de
 * verdad, intenta vincular las empresas locales sin dolibarr_id con el
 * Dolibarr configurado (búsqueda por nombre) y factura el periodo detectado.
 *
 * Pensado para correr DENTRO del contenedor "api" del docker-compose.dev.yml
 * (usa la API propia en localhost:4000 y las mismas env vars DB_*/DOLIBARR_*
 * que ya tiene el contenedor — no hace falta configurar nada aparte).
 *
 * Uso:
 *   docker exec proyectoimpresoras-api-1 node src/scripts/carga-prueba-masiva.js /tmp/mi_csv.csv 2026-06
 *
 * El segundo argumento (periodo esperado) es solo informativo/validación —
 * el periodo real lo decide motorFacturacion/importacion.service igual que
 * en un import normal (el mes más frecuente del lote).
 */
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');

const API = `http://localhost:${process.env.PORT || 4000}/api`;
const API_KEY = process.env.API_KEY;
const DOLI_URL = (process.env.DOLIBARR_URL || '').replace(/\/api\/index\.php\/?$/, '') + '/api/index.php';
const DOLI_KEY = process.env.DOLIBARR_API_KEY;

function parseCSV(path) {
  const raw = fs.readFileSync(path, 'utf-8').replace(/^﻿/, '');
  const lineas = raw.split(/\r?\n/).filter((l) => l.trim());
  const sep = lineas[0].includes(';') ? ';' : ',';
  const headers = lineas[0].split(sep).map((h) => h.replace(/^"|"$/g, '').trim());
  const findCol = (aliases) => {
    for (const a of aliases) {
      const idx = headers.findIndex((h) => h.toLowerCase() === a.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const col = {
    serie: findCol(['Número de serie', 'Numero de serie', 'Serial']),
    modelo: findCol(['Nombre del modelo', 'Modelo']),
    grupo: findCol(['Grupo', 'Group']),
    fecha: findCol(['Fecha/hora (obtener datos)', 'Fecha/hora', 'Date']),
    bn: findCol(['Blanco y negro total', 'B/N total', 'BN total']),
    color: findCol(['Color total']),
    color1: findCol(['A todo color (nivel 1) total', 'Full color (level 1) total']),
    color2: findCol(['A todo color (nivel 2) total', 'Full color (level 2) total']),
    color3: findCol(['A todo color (nivel 3) total', 'Full color (level 3) total']),
  };
  function parseLinea(linea) {
    const celdas = [];
    let actual = '';
    let enComillas = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (c === '"') enComillas = !enComillas;
      else if (c === sep && !enComillas) { celdas.push(actual); actual = ''; }
      else actual += c;
    }
    celdas.push(actual);
    return celdas;
  }
  const limpiar = (v) => (v == null ? '' : String(v).replace(/^"|"$/g, '').trim());
  const toInt = (v) => { const n = parseInt(limpiar(v).replace(/[.,]/g, ''), 10); return Number.isFinite(n) ? n : 0; };
  const rows = [];
  for (let i = 1; i < lineas.length; i++) {
    const celdas = parseLinea(lineas[i]);
    if (celdas.length < 3) continue;
    const serie = limpiar(celdas[col.serie]);
    if (!serie) continue;
    rows.push({
      serial_number: serie,
      empresa_nombre: limpiar(celdas[col.grupo]),
      modelo: limpiar(celdas[col.modelo]) || '',
      bn_total: toInt(celdas[col.bn]),
      color_total: col.color !== -1 ? toInt(celdas[col.color]) : 0,
      color1_total: col.color1 !== -1 ? toInt(celdas[col.color1]) : 0,
      color2_total: col.color2 !== -1 ? toInt(celdas[col.color2]) : 0,
      color3_total: col.color3 !== -1 ? toInt(celdas[col.color3]) : 0,
      fecha_lectura: limpiar(celdas[col.fecha]) || '',
    });
  }
  return rows;
}

async function apiCall(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

function randPrecio(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 100000) / 100000;
}

async function darDeAltaNuevas(rows, pool) {
  const preview = await apiCall('POST', '/registros/importar', {
    impresoras: rows, nombre_archivo: 'bulk_preview.csv', contenido_csv: 'bulk_preview_' + Date.now(), dry_run: true,
  });
  const nuevas = preview.impresoras_nuevas || [];
  console.log(`Impresoras nuevas a dar de alta: ${nuevas.length}`);
  if (!nuevas.length) return;

  const [empresasRows] = await pool.query('SELECT id, nombre_oficial FROM empresas');
  const porNombre = new Map(empresasRows.map((e) => [e.nombre_oficial.trim().toLowerCase(), e.id]));

  let creadas = 0, errores = 0;
  for (const n of nuevas) {
    const tipo = (n.ultima_lectura?.c2 > 0 || n.ultima_lectura?.c3 > 0) ? 'MULTICOLOR'
      : (n.ultima_lectura?.c1 > 0) ? 'COLOR' : 'BN';
    const precio_copia_bn = randPrecio(0.004, 0.015);
    const precio_copia_color1 = tipo !== 'BN' ? randPrecio(0.02, 0.05) : 0;
    const precio_copia_color2 = tipo === 'MULTICOLOR' ? randPrecio(0.02, 0.05) : 0;
    const precio_copia_color3 = tipo === 'MULTICOLOR' ? randPrecio(0.02, 0.05) : 0;
    const empresaId = porNombre.get((n.empresa_csv || '').trim().toLowerCase()) || null;
    try {
      await apiCall('POST', '/impresoras', {
        serial_number: n.serial_number, modelo: n.modelo, empresa_id: empresaId,
        precio_copia_bn, precio_copia_color1, precio_copia_color2, precio_copia_color3,
      });
      creadas++;
    } catch (e) {
      errores++;
      console.error(`  ✗ ${n.serial_number}: ${e.message}`);
    }
  }
  console.log(`Creadas: ${creadas} | Errores: ${errores}`);
}

async function importarReal(rows, nombreArchivo) {
  const res = await apiCall('POST', '/registros/importar', {
    impresoras: rows, nombre_archivo: nombreArchivo, contenido_csv: nombreArchivo + '_' + Date.now(), dry_run: false,
  });
  console.log(`Import real (${nombreArchivo}):`, res.resumen);
  return res;
}

async function linkEmpresasDolibarr(pool) {
  if (!DOLI_KEY) { console.log('DOLIBARR_API_KEY no configurada — se omite la vinculación.'); return; }
  const [empresasRows] = await pool.query('SELECT id, nombre_oficial FROM empresas WHERE dolibarr_id IS NULL AND excluir_facturacion = 0');
  let vinculadas = 0;
  for (const e of empresasRows) {
    try {
      const url = new URL(`${DOLI_URL}/thirdparties`);
      url.searchParams.set('sqlfilters', `(t.nom:like:'%${e.nombre_oficial.replace(/'/g, "\\'")}%')`);
      url.searchParams.set('limit', '1');
      const res = await fetch(url, { headers: { DOLAPIKEY: DOLI_KEY, Accept: 'application/json' } });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        const id = Number(data[0].id ?? data[0].rowid);
        if (id) {
          await pool.query('UPDATE empresas SET dolibarr_id = ? WHERE id = ?', [id, e.id]);
          vinculadas++;
          console.log(`  ✓ ${e.nombre_oficial} -> Dolibarr id ${id}`);
        }
      }
    } catch (err) {
      console.error(`  ✗ ${e.nombre_oficial}: ${err.message}`);
    }
  }
  console.log(`Empresas vinculadas a Dolibarr real: ${vinculadas}`);
}

async function facturarPeriodo(periodo) {
  const consumos = await apiCall('GET', `/consumos?periodo=${periodo}`);
  const pendientesIds = consumos.filter((c) => !c.facturado).map((c) => c.id);
  console.log(`Periodo ${periodo}: ${pendientesIds.length} consumo(s) pendiente(s) a facturar`);
  if (!pendientesIds.length) return null;
  const res = await apiCall('POST', '/facturacion/ejecutar', { periodo, consumo_ids: pendientesIds });
  console.log(`Resultado facturación ${periodo}:`, res.resumen);
  return res;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Uso: node carga-prueba-masiva.js <ruta_csv> [periodo_yyyy-mm]');
    process.exit(1);
  }
  const periodoEsperado = process.argv[3];

  const pool = await mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  console.log(`=== 1) Parseando ${csvPath} ===`);
  const rows = parseCSV(csvPath);
  console.log(`Filas leídas: ${rows.length}`);

  console.log('\n=== 2) Dando de alta impresoras nuevas (precio pequeño aleatorio) ===');
  await darDeAltaNuevas(rows, pool);

  console.log('\n=== 3) Importando lecturas reales ===');
  await importarReal(rows, require('path').basename(csvPath));

  console.log('\n=== 4) Vinculando empresas locales con Dolibarr ===');
  await linkEmpresasDolibarr(pool);

  if (periodoEsperado) {
    console.log(`\n=== 5) Facturando periodo ${periodoEsperado} ===`);
    await facturarPeriodo(periodoEsperado);
  } else {
    console.log('\n(Sin periodo indicado como 2º argumento: no se factura automáticamente.)');
  }

  await pool.end();
}

if (require.main === module) {
  main().catch((e) => { console.error('FALLO:', e); process.exit(1); });
}

module.exports = { parseCSV, darDeAltaNuevas, importarReal, linkEmpresasDolibarr, facturarPeriodo };
