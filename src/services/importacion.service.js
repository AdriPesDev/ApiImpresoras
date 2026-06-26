const crypto = require('crypto');
// Motor de cálculo de facturación compartido (mismo que usa la emisión de
// facturas). El puente lecturas → consumos_mensuales lo reutiliza para que el
// consumo se calcule con UNA sola lógica, idéntica a la app de Python.
const { procesarImpresora } = require('./motorFacturacion');

// Umbral de delta de copias para marcar una lectura como anómala (configurable).
const ANOMALY_THRESHOLD = parseInt(process.env.ANOMALY_THRESHOLD, 10) || 10000;

function parsearFecha(valor) {
  if (!valor) return null;
  let v = String(valor).trim();
  if (v.includes('/') && v.includes('-')) v = v.replace('-', ' ');
  const m1 = v.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (m1) return new Date(`${m1[3]}-${m1[2]}-${m1[1]}T${m1[4]}:${m1[5]}:${m1[6]}`);
  const m2 = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return new Date(v);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function toInt(v) {
  const n = parseInt(String(v ?? 0).replace(/[.,]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function formatMySQL(d) {
  if (!d) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 19).replace('T', ' ');
}

// Periodo 'YYYY-MM' a partir de la fecha de lectura del CSV.
function periodoDe(valor) {
  const d = parsearFecha(valor);
  if (!d || isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodoActual() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

class ImportacionService {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Importa contadores desde datos parseados del CSV.
   * NO factura, solo guarda lecturas en registros_contadores.
   *
   * La importación real (dry_run=false) se ejecuta dentro de UNA transacción:
   * si falla cualquier fila, se hace rollback completo y no queda estado parcial
   * (ni lecturas sueltas, ni empresas reasignadas, ni historial inconsistente).
   *
   * @param {Object} params
   * @param {Array}  params.impresoras - Array de { serial_number, empresa_nombre, modelo, bn_total, color_total, color1_total, color2_total, color3_total, fecha_lectura }
   * @param {string} params.nombre_archivo - Nombre del CSV original
   * @param {string} params.hash_archivo - Hash MD5/SHA del contenido (para detectar duplicados)
   * @param {string} params.usuario - Username del usuario que importa
   * @param {boolean} params.dry_run - Si true, no graba nada, solo devuelve preview
   * @returns {Object} Resultado detallado por impresora
   */
  async importar({ impresoras, nombre_archivo, hash_archivo, usuario, dry_run = false }) {
    // 1. Verificar si este archivo ya fue importado
    const [existentes] = await this.pool.query(
      'SELECT id, fecha_importacion, estado FROM historial_importaciones WHERE hash_archivo = ?',
      [hash_archivo],
    );
    const yaImportado = existentes.length > 0 ? existentes[0] : null;

    // 2a. Preview (dry_run): solo lecturas, sin transacción
    if (dry_run) {
      const agg = await this._procesarTodas(this.pool, impresoras, true);
      return this._resultado(true, yaImportado, null, impresoras.length, agg);
    }

    // 2b. Importación real: transacción todo-o-nada
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const agg = await this._procesarTodas(conn, impresoras, false);

      // 3. Registrar en historial (solo si hay datos guardados y el hash no existe ya)
      let importacion_id = null;
      if (agg.guardados > 0 && !yaImportado) {
        const [ins] = await conn.query(
          `INSERT INTO historial_importaciones
             (nombre_archivo, hash_archivo, total_registros, estado, detalles, usuario)
           VALUES (?, ?, ?, 'completada', ?, ?)`,
          [
            nombre_archivo,
            hash_archivo,
            agg.guardados,
            JSON.stringify({
              guardados: agg.guardados,
              duplicados: agg.duplicados,
              no_encontrados: agg.noEncontrados,
              empresas_actualizadas: agg.empresasActualizadas,
              anomalias: agg.anomalias,
              consumos_calculados: agg.consumosCalculados,
              importe_estimado: agg.importeEstimado,
            }),
            usuario || 'api',
          ],
        );
        importacion_id = ins.insertId;
      }

      await conn.commit();
      return this._resultado(false, yaImportado, importacion_id, impresoras.length, agg);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // Procesa todas las filas con el "querier" dado (pool en preview, conn en importación).
  async _procesarTodas(querier, impresoras, dry_run) {
    const resultados = [];
    let guardados = 0;
    let duplicados = 0;
    let noEncontrados = 0;
    let empresasActualizadas = 0;
    let anomalias = 0;
    let consumosCalculados = 0;
    let importeEstimado = 0;

    // Periodo de respaldo para filas sin fecha legible (se usa el del primer
    // CSV con fecha; si ninguna tiene, el mes actual).
    let periodoFallback = null;
    for (const f of impresoras) {
      const p = periodoDe(f.fecha_lectura);
      if (p) { periodoFallback = p; break; }
    }
    if (!periodoFallback) periodoFallback = periodoActual();

    for (const fila of impresoras) {
      const resultado = await this._procesarFila(querier, fila, dry_run, periodoFallback);
      resultados.push(resultado);

      if (resultado.estado === 'guardado') guardados++;
      else if (resultado.estado === 'duplicado') duplicados++;
      else if (resultado.estado === 'no_encontrada') noEncontrados++;

      if (resultado.empresa_actualizada) empresasActualizadas++;
      if (resultado.anomalia) anomalias++;
      if (resultado.consumo && resultado.consumo.facturable && !resultado.consumo.omitido_facturado) {
        consumosCalculados++;
        importeEstimado += resultado.consumo.total_facturar || 0;
      }
    }

    return {
      resultados, guardados, duplicados, noEncontrados, empresasActualizadas, anomalias,
      consumosCalculados, importeEstimado: Math.round(importeEstimado * 100) / 100,
    };
  }

  _resultado(dry_run, yaImportado, importacion_id, total, agg) {
    return {
      modo: dry_run ? 'preview' : 'importacion',
      ya_importado: yaImportado,
      importacion_id,
      resumen: {
        total,
        guardados: agg.guardados,
        duplicados: agg.duplicados,
        no_encontrados: agg.noEncontrados,
        empresas_actualizadas: agg.empresasActualizadas,
        anomalias: agg.anomalias,
        consumos_calculados: agg.consumosCalculados,
        importe_estimado: agg.importeEstimado,
      },
      resultados: agg.resultados,
    };
  }

  // querier: pool (preview) o conexión de transacción (importación real).
  async _procesarFila(querier, fila, dry_run, periodoFallback) {
    let esDuplicado = false;
    const serial = String(fila.serial_number || '').trim();
    const fechaCSV = parsearFecha(fila.fecha_lectura);
    const bnTotal = toInt(fila.bn_total);
    const colorTotal = toInt(fila.color_total);
    const c1Total = toInt(fila.color1_total) || colorTotal;
    const c2Total = toInt(fila.color2_total);
    const c3Total = toInt(fila.color3_total);
    const empresaNombre = String(fila.empresa_nombre || '').trim();
    const modelo = String(fila.modelo || '').trim();

    const resultado = {
      serial_number: serial,
      empresa_csv: empresaNombre,
      modelo,
      estado: null,
      lectura_anterior: null,
      lectura_nueva: { bn: bnTotal, c1: c1Total, c2: c2Total, c3: c3Total, fecha: fila.fecha_lectura },
      delta: null,
      anomalia: false,
      empresa_actualizada: false,
      detalle: null,
      consumo: null,
    };

    // Buscar impresora por número de serie
    const [impRows] = await querier.query(
      'SELECT id, empresa_id, modelo FROM impresoras WHERE serial_number = ?',
      [serial],
    );

    if (!impRows.length) {
      resultado.estado = 'no_encontrada';
      resultado.detalle = `Serie ${serial} no existe en la BD.`;
      return resultado;
    }

    const impresora = impRows[0];
    const impresora_id = impresora.id;

    // Buscar última lectura existente
    const [lastRows] = await querier.query(
      `SELECT copias_bn_total, copias_color1_total, copias_color2_total, copias_color3_total,
              fecha_lectura
       FROM registros_contadores
       WHERE impresora_id = ?
       ORDER BY fecha_lectura DESC LIMIT 1`,
      [impresora_id],
    );

    if (lastRows.length) {
      const last = lastRows[0];
      resultado.lectura_anterior = {
        bn: toInt(last.copias_bn_total),
        c1: toInt(last.copias_color1_total),
        c2: toInt(last.copias_color2_total),
        c3: toInt(last.copias_color3_total),
        fecha: last.fecha_lectura,
      };

      // Calcular delta
      const deltaBN = bnTotal - resultado.lectura_anterior.bn;
      const deltaC1 = c1Total - resultado.lectura_anterior.c1;
      resultado.delta = {
        bn: deltaBN,
        c1: deltaC1,
        c2: c2Total - resultado.lectura_anterior.c2,
        c3: c3Total - resultado.lectura_anterior.c3,
        total: deltaBN + deltaC1,
      };

      // Detectar anomalía (delta de copias por encima del umbral configurable)
      if (resultado.delta.total > ANOMALY_THRESHOLD) {
        resultado.anomalia = true;
      }

      // Detectar duplicado: misma fecha de lectura (margen de 1 minuto)
      // NOTA: detección a nivel de aplicación. Para blindar contra carreras entre
      // dos importaciones simultáneas conviene un índice UNIQUE (impresora_id,
      // fecha_lectura) en registros_contadores + INSERT IGNORE.
      if (fechaCSV) {
        const lastFecha = new Date(last.fecha_lectura);
        const diffMs = Math.abs(fechaCSV.getTime() - lastFecha.getTime());
        if (diffMs < 60000) { // menos de 1 minuto de diferencia
          // La lectura ya existe: no se reinserta, pero el consumo del periodo
          // SÍ se (re)calcula más abajo a partir de las lecturas ya en BD.
          esDuplicado = true;
          resultado.detalle = 'Ya existe una lectura con esta fecha.';
        }
      }

      // Detectar contador negativo (lecturas desordenadas o reset)
      if (!esDuplicado && (resultado.delta.bn < 0 || resultado.delta.c1 < 0)) {
        resultado.detalle = `Contador negativo: B/N ${resultado.delta.bn}, C1 ${resultado.delta.c1}. Posible reset o lectura desordenada.`;
      }
    } else {
      resultado.detalle = 'Primera lectura para esta impresora.';
    }

    // Verificar si la empresa cambió; si no existe en BD, crearla para que
    // el nombre quede vinculado a la impresora y aparezca en los informes.
    if (!esDuplicado && empresaNombre) {
      const [empRows] = await querier.query(
        'SELECT id FROM empresas WHERE nombre_oficial = ?',
        [empresaNombre],
      );

      let targetEmpresaId = empRows.length ? empRows[0].id : null;

      if (!targetEmpresaId && !dry_run) {
        const [ins] = await querier.query(
          'INSERT INTO empresas (dolibarr_id, nombre_oficial, activo) VALUES (0, ?, 1)',
          [empresaNombre],
        );
        targetEmpresaId = ins.insertId;
      }

      if (targetEmpresaId !== null && targetEmpresaId !== impresora.empresa_id) {
        resultado.empresa_actualizada = true;
        resultado.empresa_anterior_id = impresora.empresa_id;
        resultado.empresa_nueva_id = targetEmpresaId;

        if (!dry_run) {
          await querier.query(
            'UPDATE impresoras SET empresa_id = ? WHERE id = ?',
            [targetEmpresaId, impresora_id],
          );
        }
      }
    }

    // Guardar lectura (no en duplicados: ya existe)
    if (!dry_run && !esDuplicado) {
      await querier.query(
        `INSERT INTO registros_contadores
           (impresora_id, copias_bn_total, copias_color_total, copias_color1_total, copias_color2_total, copias_color3_total, fecha_lectura)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [impresora_id, bnTotal, colorTotal, c1Total, c2Total, c3Total, formatMySQL(fechaCSV)],
      );
    }

    // ── Puente lecturas → consumos_mensuales ──────────────────────────────
    // Calcula y persiste el consumo del periodo (facturado=0) con el MISMO
    // motor que la emisión. Vale para filas nuevas y duplicadas. Si falla, la
    // lectura NO se pierde: se reporta el error y la importación continúa.
    if (!dry_run) {
      const periodo = periodoDe(fila.fecha_lectura) || periodoFallback;
      try {
        resultado.consumo = await this._calcularYPersistirConsumo(
          querier, impresora_id, serial, fila, fechaCSV, periodo,
        );
      } catch (e) {
        resultado.consumo = null;
        resultado.consumo_error = e.message;
      }
    }

    resultado.estado = esDuplicado ? 'duplicado' : (dry_run ? 'preview' : 'guardado');
    return resultado;
  }

  // Calcula el consumo del periodo para una impresora y lo upserta en
  // consumos_mensuales con facturado=0 (la emisión a Dolibarr es un paso aparte).
  // Devuelve un resumen { periodo, facturable, total_facturar, ... } o null.
  async _calcularYPersistirConsumo(querier, impresora_id, serial, fila, fechaCSV, periodo) {
    if (!fechaCSV) return null; // sin fecha fiable no se ubica el periodo

    const [precRows] = await querier.query(
      `SELECT precio_copia_bn, precio_copia_color1, precio_copia_color2, precio_copia_color3,
              tipo_facturacion, activa
       FROM impresoras WHERE serial_number = ? AND activa = TRUE`,
      [serial],
    );
    const preciosImpresora = precRows[0] || null;
    if (!preciosImpresora) return { periodo, facturable: false, estado: 'sin_precio', total_facturar: 0 };

    // Líneas de contrato activas (tabla canónica singular contrato_impresoras).
    const [contRows] = await querier.query(
      `SELECT ci.empresa_id, e.nombre_oficial AS empresa_nombre, ci.porcentaje_participacion,
              ci.precio_bn, ci.precio_color1, ci.precio_color2, ci.precio_color3,
              ci.copias_bn_incluidas, ci.copias_c1_incluidas,
              ci.copias_c2_incluidas, ci.copias_c3_incluidas,
              ci.precio_minimo_mensual, c.numero_contrato
       FROM contrato_impresoras ci
       INNER JOIN contratos c ON c.id = ci.contrato_id
       INNER JOIN impresoras i ON i.id = ci.impresora_id
       LEFT  JOIN empresas e ON e.id = ci.empresa_id
       WHERE i.serial_number = ?
         AND ci.activo = TRUE AND c.activo = TRUE
         AND c.fecha_inicio <= CURDATE()
         AND (c.fecha_fin IS NULL OR c.fecha_fin >= CURDATE())
       ORDER BY ci.id`,
      [serial],
    );

    // Lectura de apertura del periodo: la última anterior al día 1 del periodo.
    // Usar la frontera del mes lo hace robusto frente a lecturas duplicadas
    // dentro del propio periodo (re-importar el mismo CSV no descuadra el diff).
    const [prevRows] = await querier.query(
      `SELECT copias_bn_total, copias_color1_total, copias_color2_total, copias_color3_total,
              fecha_lectura, contador_negativo
       FROM registros_contadores
       WHERE impresora_id = ? AND fecha_lectura < ?
       ORDER BY fecha_lectura DESC LIMIT 1`,
      [impresora_id, `${periodo}-01 00:00:00`],
    );
    const previa = prevRows[0] || null;

    const resultados = procesarImpresora({
      fila, periodo, preciosImpresora, ultimaLectura: previa, contratoLineas: contRows,
    });

    // Un consumo por impresora = suma de las partes por empresa (contrato compartido).
    const facturables = resultados.filter((r) => r.estado === 'facturable');
    if (!facturables.length) {
      const estado = resultados.length ? resultados[0].estado : 'sin_consumo';
      return { periodo, facturable: false, estado, total_facturar: 0 };
    }

    let copiasBN = 0; let copiasC1 = 0; let copiasC2 = 0; let copiasC3 = 0;
    let impBN = 0; let impC1 = 0; let impC2 = 0; let impC3 = 0; let total = 0;
    let bnIni = null; let bnFin = null; let c1Ini = null; let c1Fin = null;
    for (const r of facturables) {
      const d = r.detalle;
      copiasBN += toInt(d.copias_bn); copiasC1 += toInt(d.copias_c1);
      copiasC2 += toInt(d.copias_c2); copiasC3 += toInt(d.copias_c3);
      impBN += Number(d.importe_bn) || 0; impC1 += Number(d.importe_c1) || 0;
      impC2 += Number(d.importe_c2) || 0; impC3 += Number(d.importe_c3) || 0;
      total += Number(d.importe_total) || 0;
      bnIni = toInt(d.bn_anterior); bnFin = toInt(d.bn_actual);
      c1Ini = toInt(d.c1_anterior); c1Fin = toInt(d.c1_actual);
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    const totalRound = r2(total);

    // No pisar un consumo de un periodo ya facturado.
    const [exist] = await querier.query(
      'SELECT facturado FROM consumos_mensuales WHERE impresora_id = ? AND periodo = ?',
      [impresora_id, periodo],
    );
    if (exist.length && exist[0].facturado) {
      return { periodo, facturable: true, omitido_facturado: true, total_facturar: totalRound };
    }

    // copias/importe "color" (legacy) == color1, igual que la app de Python.
    await querier.query(
      `INSERT INTO consumos_mensuales
         (impresora_id, periodo,
          copias_bn_mes, copias_color_mes, copias_color1_mes, copias_color2_mes, copias_color3_mes,
          importe_bn, importe_color, importe_color1, importe_color2, importe_color3,
          total_facturar, facturado,
          contador_bn_inicio, contador_bn_fin, contador_color1_inicio, contador_color1_fin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         copias_bn_mes = VALUES(copias_bn_mes),
         copias_color_mes = VALUES(copias_color_mes),
         copias_color1_mes = VALUES(copias_color1_mes),
         copias_color2_mes = VALUES(copias_color2_mes),
         copias_color3_mes = VALUES(copias_color3_mes),
         importe_bn = VALUES(importe_bn),
         importe_color = VALUES(importe_color),
         importe_color1 = VALUES(importe_color1),
         importe_color2 = VALUES(importe_color2),
         importe_color3 = VALUES(importe_color3),
         total_facturar = VALUES(total_facturar),
         contador_bn_inicio = VALUES(contador_bn_inicio),
         contador_bn_fin = VALUES(contador_bn_fin),
         contador_color1_inicio = VALUES(contador_color1_inicio),
         contador_color1_fin = VALUES(contador_color1_fin)`,
      [
        impresora_id, periodo,
        copiasBN, copiasC1, copiasC1, copiasC2, copiasC3,
        r2(impBN), r2(impC1), r2(impC1), r2(impC2), r2(impC3),
        totalRound,
        bnIni, bnFin, c1Ini, c1Fin,
      ],
    );

    return {
      periodo, facturable: true,
      copias_bn: copiasBN, copias_color: copiasC1, total_facturar: totalRound,
    };
  }

  /**
   * Genera hash SHA-256 del contenido del CSV.
   */
  static hash(contenido) {
    return crypto.createHash('sha256').update(contenido).digest('hex');
  }
}

module.exports = ImportacionService;
