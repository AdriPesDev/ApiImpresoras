const crypto = require('crypto');

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

class ImportacionService {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Importa contadores desde datos parseados del CSV.
   * NO factura, solo guarda lecturas en registros_contadores.
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

    // 2. Procesar cada impresora
    const resultados = [];
    let guardados = 0;
    let duplicados = 0;
    let noEncontrados = 0;
    let empresasActualizadas = 0;
    let anomalias = 0;

    for (const fila of impresoras) {
      const resultado = await this._procesarFila(fila, dry_run);
      resultados.push(resultado);

      if (resultado.estado === 'guardado') guardados++;
      else if (resultado.estado === 'duplicado') duplicados++;
      else if (resultado.estado === 'no_encontrada') noEncontrados++;

      if (resultado.empresa_actualizada) empresasActualizadas++;
      if (resultado.anomalia) anomalias++;
    }

    // 3. Registrar en historial (solo si no es dry_run y hay datos guardados)
    let importacion_id = null;
    if (!dry_run && guardados > 0) {
      const [ins] = await this.pool.query(
        `INSERT INTO historial_importaciones
           (nombre_archivo, hash_archivo, total_registros, estado, detalles, usuario)
         VALUES (?, ?, ?, 'completada', ?, ?)`,
        [
          nombre_archivo,
          hash_archivo,
          guardados,
          JSON.stringify({
            guardados, duplicados, no_encontrados: noEncontrados,
            empresas_actualizadas: empresasActualizadas, anomalias,
          }),
          usuario || 'api',
        ],
      );
      importacion_id = ins.insertId;
    }

    return {
      modo: dry_run ? 'preview' : 'importacion',
      ya_importado: yaImportado,
      importacion_id,
      resumen: {
        total: impresoras.length,
        guardados,
        duplicados,
        no_encontrados: noEncontrados,
        empresas_actualizadas: empresasActualizadas,
        anomalias,
      },
      resultados,
    };
  }

  async _procesarFila(fila, dry_run) {
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
    };

    // Buscar impresora por número de serie
    const [impRows] = await this.pool.query(
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
    const [lastRows] = await this.pool.query(
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

      // Detectar anomalía (>10000 copias en el delta)
      if (resultado.delta.total > 10000) {
        resultado.anomalia = true;
      }

      // Detectar duplicado: misma fecha de lectura (margen de 1 minuto)
      if (fechaCSV) {
        const lastFecha = new Date(last.fecha_lectura);
        const diffMs = Math.abs(fechaCSV.getTime() - lastFecha.getTime());
        if (diffMs < 60000) { // menos de 1 minuto de diferencia
          resultado.estado = 'duplicado';
          resultado.detalle = 'Ya existe una lectura con esta fecha.';
          return resultado;
        }
      }

      // Detectar contador negativo (lecturas desordenadas o reset)
      if (resultado.delta.bn < 0 || resultado.delta.c1 < 0) {
        resultado.detalle = `Contador negativo: B/N ${resultado.delta.bn}, C1 ${resultado.delta.c1}. Posible reset o lectura desordenada.`;
      }
    } else {
      resultado.detalle = 'Primera lectura para esta impresora.';
    }

    // Verificar si la empresa cambió
    if (empresaNombre) {
      const [empRows] = await this.pool.query(
        'SELECT id FROM empresas WHERE nombre_oficial = ?',
        [empresaNombre],
      );
      if (empRows.length && empRows[0].id !== impresora.empresa_id) {
        resultado.empresa_actualizada = true;
        resultado.empresa_anterior_id = impresora.empresa_id;
        resultado.empresa_nueva_id = empRows[0].id;

        if (!dry_run) {
          await this.pool.query(
            'UPDATE impresoras SET empresa_id = ? WHERE id = ?',
            [empRows[0].id, impresora_id],
          );
        }
      }
    }

    // Guardar lectura
    if (!dry_run) {
      await this.pool.query(
        `INSERT INTO registros_contadores
           (impresora_id, copias_bn_total, copias_color_total, copias_color1_total, copias_color2_total, copias_color3_total, fecha_lectura)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [impresora_id, bnTotal, colorTotal, c1Total, c2Total, c3Total, formatMySQL(fechaCSV)],
      );
    }

    resultado.estado = dry_run ? 'preview' : 'guardado';
    return resultado;
  }

  /**
   * Genera hash SHA-256 del contenido del CSV.
   */
  static hash(contenido) {
    return crypto.createHash('sha256').update(contenido).digest('hex');
  }
}

module.exports = ImportacionService;
