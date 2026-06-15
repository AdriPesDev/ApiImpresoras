const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function nombreMes(periodo) {
  const [anio, mes] = periodo.split('-');
  return `${MESES[parseInt(mes, 10) - 1]} ${anio}`;
}

function timestampMesSiguiente(periodo) {
  let [anio, mes] = periodo.split('-').map(Number);
  if (mes === 12) { anio += 1; mes = 1; } else { mes += 1; }
  return Math.floor(new Date(anio, mes - 1, 1).getTime() / 1000);
}

function toInt(v) {
  const n = parseInt(String(v ?? 0).replace(/[.,]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function toFloat(v, def = 0) {
  const n = parseFloat(v ?? def);
  return Number.isFinite(n) ? n : def;
}

function parsearFecha(valor) {
  if (!valor) return null;
  // Kyofleet format: '22/04/2026-10:51:39' (dash between date and time)
  let v = String(valor).trim();
  if (v.includes('/') && v.includes('-')) v = v.replace('-', ' ');
  for (const fmt of [
    /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  ]) {
    const m = v.match(fmt);
    if (m) {
      // dd/mm/yyyy hh:mm:ss
      if (m[3].length === 4) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`);
      // yyyy-mm-dd hh:mm:ss
      return new Date(v);
    }
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

class FacturacionService {
  constructor(pool, dolibarrService) {
    this.pool = pool;
    this.dolibarr = dolibarrService;
  }

  // ── DB helpers ───────────────────────────────

  async _getUltimaLectura(serial) {
    const [rows] = await this.pool.query(
      `SELECT rc.copias_bn_total, rc.copias_color_total,
              rc.copias_color1_total, rc.copias_color2_total, rc.copias_color3_total,
              rc.fecha_lectura,
              COALESCE(rc.contador_negativo, FALSE) AS contador_negativo
       FROM registros_contadores rc
       INNER JOIN impresoras i ON i.id = rc.impresora_id
       WHERE i.serial_number = ?
       ORDER BY rc.fecha_lectura DESC
       LIMIT 1`,
      [serial],
    );
    return rows[0] || null;
  }

  async _getContrato(serial) {
    const [rows] = await this.pool.query(
      `SELECT ci.precio_bn, ci.precio_color1, ci.precio_color2, ci.precio_color3,
              ci.copias_bn_incluidas, ci.copias_c1_incluidas,
              ci.copias_c2_incluidas, ci.copias_c3_incluidas,
              ci.precio_minimo_mensual, c.numero_contrato
       FROM contrato_impresoras ci
       INNER JOIN contratos c ON c.id = ci.contrato_id
       INNER JOIN impresoras i ON i.id = ci.impresora_id
       WHERE i.serial_number = ?
         AND ci.activo = TRUE
         AND c.activo = TRUE
         AND c.fecha_inicio <= CURDATE()
         AND (c.fecha_fin IS NULL OR c.fecha_fin >= CURDATE())
       ORDER BY c.fecha_inicio DESC
       LIMIT 1`,
      [serial],
    );
    return rows[0] || null;
  }

  async _getPreciosImpresora(serial) {
    const [rows] = await this.pool.query(
      `SELECT precio_copia_bn, precio_copia_color1, precio_copia_color2, precio_copia_color3,
              tipo_facturacion, activa
       FROM impresoras
       WHERE serial_number = ? AND activa = TRUE`,
      [serial],
    );
    return rows[0] || null;
  }

  async _getImpresoraId(serial) {
    const [rows] = await this.pool.query(
      'SELECT id FROM impresoras WHERE serial_number = ?',
      [serial],
    );
    return rows[0]?.id || null;
  }

  // ── Core billing engine: process one printer ─

  async _procesarImpresora(fila, periodo) {
    const serial  = fila.serial_number;
    const modelo  = fila.modelo || serial;
    const empresa = fila.empresa_nombre;

    const bnActual     = toInt(fila.bn_total);
    const colorActual  = toInt(fila.color_total);
    const c1Actual     = toInt(fila.color1_total);
    const c2Actual     = toInt(fila.color2_total);
    const c3Actual     = toInt(fila.color3_total);
    const niv2Actual   = toInt(fila.color_niv2_total);
    const niv3Actual   = toInt(fila.color_niv3_total);
    const fechaLecturaCSV = parsearFecha(fila.fecha_lectura);

    // Detect billing type from what's populated in the CSV
    const tieneColor = colorActual > 0;
    const esMulticolor = tieneColor && (niv2Actual > 0 || niv3Actual > 0);

    let tipoDetectado, c1Eff, c2Eff, c3Eff;
    if (esMulticolor) {
      tipoDetectado = 'BN_MULTICOLOR';
      c1Eff = c1Actual || colorActual;
      c2Eff = niv2Actual;
      c3Eff = niv3Actual;
    } else if (tieneColor) {
      tipoDetectado = 'BN_AND_COLOR';
      c1Eff = colorActual;
      c2Eff = 0;
      c3Eff = 0;
    } else {
      tipoDetectado = 'BN_ONLY';
      c1Eff = 0;
      c2Eff = 0;
      c3Eff = 0;
    }

    const resultado = {
      serial_number: serial,
      modelo,
      empresa,
      periodo,
      fecha_lectura: fila.fecha_lectura || null,
      estado: null,
      detalle: {},
      lineas_factura: [],
    };

    // Get prices: contract takes priority over printer-level prices
    const contrato         = await this._getContrato(serial);
    const preciosImpresora = await this._getPreciosImpresora(serial);

    let precioBN, precioC1, precioC2, precioC3, copiasBNIncl, copiasC1Incl, precioMinimo;

    if (contrato) {
      precioBN    = toFloat(contrato.precio_bn);
      precioC1    = toFloat(contrato.precio_color1);
      precioC2    = toFloat(contrato.precio_color2) || precioC1;
      precioC3    = toFloat(contrato.precio_color3) || precioC1;
      copiasBNIncl = toInt(contrato.copias_bn_incluidas);
      copiasC1Incl = toInt(contrato.copias_c1_incluidas);
      precioMinimo = toFloat(contrato.precio_minimo_mensual);
      resultado.detalle.contrato        = true;
      resultado.detalle.numero_contrato = contrato.numero_contrato;
      resultado.detalle.precio_minimo   = precioMinimo;
    } else if (preciosImpresora) {
      precioBN    = toFloat(preciosImpresora.precio_copia_bn);
      precioC1    = toFloat(preciosImpresora.precio_copia_color1);
      precioC2    = toFloat(preciosImpresora.precio_copia_color2) || precioC1;
      precioC3    = toFloat(preciosImpresora.precio_copia_color3) || precioC1;
      copiasBNIncl  = 0;
      copiasC1Incl  = 0;
      precioMinimo  = 0;
      resultado.detalle.contrato               = false;
      resultado.detalle.tipo_facturacion_bd    = preciosImpresora.tipo_facturacion;
    } else {
      resultado.estado = 'sin_precio';
      resultado.detalle.msg = 'Sin precio en BD para esta impresora.';
      return resultado;
    }

    // Get last DB reading
    const ultima = await this._getUltimaLectura(serial);
    const esPrimeraLectura = !ultima;

    let bnAnterior, c1Anterior, c2Anterior, c3Anterior, contadorNegativoAnterior;
    let copiasBNBruto, copiasC1Bruto;

    if (esPrimeraLectura) {
      bnAnterior  = 0;
      c1Anterior  = 0;
      c2Anterior  = 0;
      c3Anterior  = 0;
      contadorNegativoAnterior = false;
      copiasBNBruto  = bnActual;
      copiasC1Bruto  = c1Eff;
      resultado.detalle.primera_lectura = true;
    } else {
      bnAnterior  = toInt(ultima.copias_bn_total);
      c1Anterior  = toInt(ultima.copias_color1_total);
      c2Anterior  = toInt(ultima.copias_color2_total);
      c3Anterior  = toInt(ultima.copias_color3_total);
      contadorNegativoAnterior = Boolean(ultima.contador_negativo);

      // Skip out-of-order readings (CSV date older than last DB reading)
      const fechaUltimaBD = ultima.fecha_lectura instanceof Date
        ? ultima.fecha_lectura
        : parsearFecha(ultima.fecha_lectura);

      if (fechaLecturaCSV && fechaUltimaBD && fechaLecturaCSV < fechaUltimaBD) {
        resultado.estado = 'lectura_desordenada';
        resultado.detalle.msg = `Fecha CSV (${fila.fecha_lectura}) anterior a última BD (${fechaUltimaBD.toISOString()}).`;
        return resultado;
      }

      copiasBNBruto  = bnActual  - bnAnterior;
      copiasC1Bruto  = c1Eff - c1Anterior;
    }

    // Handle negative counters
    if (copiasBNBruto < 0 && copiasC1Bruto < 0) {
      resultado.estado = 'contador_negativo';
      resultado.detalle = {
        ...resultado.detalle,
        msg: 'Reset total de contadores. 0 copias este mes.',
        bn_anterior: bnAnterior, bn_actual: bnActual, copias_bn_bruto: copiasBNBruto,
        c1_anterior: c1Anterior, c1_actual: c1Eff,    copias_c1_bruto: copiasC1Bruto,
      };
      return resultado;
    }

    if (copiasBNBruto < 0) {
      resultado.detalle.aviso_bn_negativo = copiasBNBruto;
      copiasBNBruto = 0;
    }
    if (copiasC1Bruto < 0) {
      resultado.detalle.aviso_color_negativo = copiasC1Bruto;
      copiasC1Bruto = 0;
    }

    // Absorb previous negative month
    if (contadorNegativoAnterior) {
      copiasBNBruto  = 0;
      copiasC1Bruto  = 0;
      resultado.detalle.absorbe_negativo = true;
    }

    // Subtract included copies (from contract)
    const copiasBN = Math.max(0, copiasBNBruto - copiasBNIncl);
    const copiasC1 = Math.max(0, copiasC1Bruto - copiasC1Incl);

    // Zero consumption (not first reading)
    if (copiasBN === 0 && copiasC1 === 0 && !esPrimeraLectura) {
      resultado.estado = 'sin_consumo';
      resultado.detalle.msg = 'Diferencia 0 copias.';
      return resultado;
    }

    // Calculate amounts
    const importeBN    = Math.round(copiasBN * precioBN * 10000) / 10000;
    const importeC1    = Math.round(copiasC1 * precioC1 * 10000) / 10000;
    let importeTotal   = Math.round((importeBN + importeC1) * 100) / 100;

    if (precioMinimo && importeTotal < precioMinimo) {
      importeTotal = precioMinimo;
      resultado.detalle.precio_minimo_aplicado = true;
    }

    resultado.detalle = {
      ...resultado.detalle,
      tipo_facturacion_detectado: tipoDetectado,
      bn_anterior:  bnAnterior,  bn_actual:  bnActual,  copias_bn: copiasBN,  precio_bn: precioBN,
      c1_anterior:  c1Anterior,  c1_actual:  c1Eff,     copias_c1: copiasC1,  precio_c1: precioC1,
      importe_bn:   importeBN,   importe_c1: importeC1, importe_total: importeTotal,
    };

    // Build invoice lines
    const mesTxt = nombreMes(periodo);

    const _linea = (tipo, ant, act, qty, precio) => ({
      tipo,
      desc: `Periodo: ${mesTxt}<br>\nCopias ${tipo} - ${modelo} (SN: ${serial})<br>\nLectura anterior: ${ant.toLocaleString('es-ES')} ${tipo}<br>\nLectura actual: ${act.toLocaleString('es-ES')} ${tipo}`,
      qty,
      subprice: Math.round(precio * 1000000) / 1000000,
      product_type: 1,
      tva_tx: 21.0,
      remise_percent: 0,
    });

    if (copiasBN > 0) {
      resultado.lineas_factura.push(_linea('BN', bnAnterior, bnActual, copiasBN, precioBN));
    }

    if (tipoDetectado === 'BN_MULTICOLOR') {
      const copC2 = Math.max(0, c2Eff - c2Anterior);
      const copC3 = Math.max(0, c3Eff - c3Anterior);
      if (copiasC1 > 0) resultado.lineas_factura.push(_linea('COLOR1', c1Anterior, c1Eff, copiasC1, precioC1));
      if (copC2 > 0)    resultado.lineas_factura.push(_linea('COLOR2', c2Anterior, c2Eff, copC2, precioC2));
      if (copC3 > 0)    resultado.lineas_factura.push(_linea('COLOR3', c3Anterior, c3Eff, copC3, precioC3));
    } else if (tipoDetectado === 'BN_AND_COLOR') {
      if (copiasC1 > 0) resultado.lineas_factura.push(_linea('COLOR', c1Anterior, c1Eff, copiasC1, precioC1));
    }

    resultado.estado = 'facturable';
    return resultado;
  }

  // ── Group by company and build invoice payloads ──

  async _agruparYConstruir(resultados, periodo) {
    const grupos = new Map();
    for (const r of resultados) {
      if (r.estado === 'facturable') {
        if (!grupos.has(r.empresa)) grupos.set(r.empresa, []);
        grupos.get(r.empresa).push(r);
      }
    }

    const facturas = [];
    const empresasNoEncontradas = [];

    for (const [empresaNombre, impresoras] of grupos) {
      const tercero = await this.dolibarr.buscarTercero(empresaNombre);
      if (!tercero) {
        empresasNoEncontradas.push(empresaNombre);
        for (const imp of impresoras) {
          imp.estado = 'sin_empresa_dolibarr';
          imp.detalle.msg = `'${empresaNombre}' no encontrada en Dolibarr.`;
        }
        continue;
      }

      const todasLineas = impresoras.flatMap((i) => i.lineas_factura);
      if (!todasLineas.length) continue;

      const importeTotal = impresoras.reduce(
        (sum, i) => sum + (i.detalle.importe_total || 0),
        0,
      );

      const payload = {
        socid: parseInt(tercero.id, 10),
        type: 0,
        date: timestampMesSiguiente(periodo),
        note_public: `Facturacion automatica - ${nombreMes(periodo)} - ${empresaNombre}`,
        cond_reglement_id: tercero.cond_reglement_id || '',
        mode_reglement_id: tercero.mode_reglement_id || '',
        lines: todasLineas.map((l) => ({
          desc: l.desc,
          qty: l.qty,
          subprice: l.subprice,
          product_type: l.product_type,
          tva_tx: l.tva_tx,
          remise_percent: l.remise_percent,
        })),
      };

      facturas.push({
        empresa_csv:         empresaNombre,
        empresa_dolibarr:    tercero.nom,
        socid:               parseInt(tercero.id, 10),
        periodo,
        num_impresoras:      impresoras.length,
        seriales:            impresoras.map((i) => i.serial_number),
        num_lineas:          todasLineas.length,
        importe_total:       Math.round(importeTotal * 100) / 100,
        estado:              'pendiente',
        id_factura_dolibarr: null,
        dolibarr_payload:    payload,
        impresoras,
      });
    }

    return { facturas, empresasNoEncontradas };
  }

  // ── Public API ────────────────────────────────

  async preview(periodo, impresoras) {
    this.dolibarr.clearCache();
    const resultados = await Promise.all(
      impresoras.map((fila) => this._procesarImpresora(fila, periodo)),
    );

    const { facturas, empresasNoEncontradas } = await this._agruparYConstruir(resultados, periodo);
    const excluidas = resultados.filter((r) => r.estado !== 'facturable');

    return {
      periodo,
      modo: 'preview',
      resumen: this._resumen(resultados, facturas, empresasNoEncontradas),
      facturas_por_empresa: facturas,
      impresoras_excluidas: excluidas,
    };
  }

  async ejecutar(periodo, impresoras) {
    this.dolibarr.clearCache();
    const resultados = await Promise.all(
      impresoras.map((fila) => this._procesarImpresora(fila, periodo)),
    );

    const { facturas, empresasNoEncontradas } = await this._agruparYConstruir(resultados, periodo);

    for (const factura of facturas) {
      try {
        const resp = await this.dolibarr.crearFactura(factura.dolibarr_payload);
        const idFactura = typeof resp === 'number' ? resp : resp?.id;
        factura.estado              = 'creada';
        factura.id_factura_dolibarr = idFactura;

        for (const imp of factura.impresoras) {
          await this._persistirImpresora(imp, periodo, idFactura);
        }
      } catch (err) {
        factura.estado       = 'error_envio';
        factura.error_detalle = err.message;
      }
    }

    const excluidas = resultados.filter((r) => r.estado !== 'facturable');
    return {
      periodo,
      modo: 'produccion',
      resumen: this._resumen(resultados, facturas, empresasNoEncontradas),
      facturas_por_empresa: facturas,
      impresoras_excluidas: excluidas,
    };
  }

  // ── Persist after billing ─────────────────────

  async _persistirImpresora(imp, periodo, idFactura) {
    const impresora_id = await this._getImpresoraId(imp.serial_number);
    if (!impresora_id) return;

    const d = imp.detalle;
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO registros_contadores
           (impresora_id, copias_bn_total, copias_color_total,
            copias_color1_total, copias_color2_total, copias_color3_total,
            fecha_lectura, contador_negativo)
         VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)`,
        [
          impresora_id,
          d.bn_actual  ?? 0,
          d.c1_actual  ?? 0,
          d.c1_actual  ?? 0,
          0,
          0,
          imp.fecha_lectura || new Date().toISOString().slice(0, 19).replace('T', ' '),
        ],
      );

      const [upsert] = await conn.query(
        `INSERT INTO consumos_mensuales
           (impresora_id, periodo, copias_bn_mes, copias_color1_mes,
            importe_bn, importe_color1, total_facturar, facturado)
         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE
           copias_bn_mes    = VALUES(copias_bn_mes),
           copias_color1_mes = VALUES(copias_color1_mes),
           importe_bn       = VALUES(importe_bn),
           importe_color1   = VALUES(importe_color1),
           total_facturar   = VALUES(total_facturar),
           facturado        = TRUE`,
        [
          impresora_id, periodo,
          d.copias_bn ?? 0, d.copias_c1 ?? 0,
          d.importe_bn ?? 0, d.importe_c1 ?? 0,
          d.importe_total ?? 0,
        ],
      );

      const consumoId = upsert.insertId;

      if (consumoId) {
        await conn.query(
          `INSERT INTO logs_facturacion
             (consumo_id, impresora_id, periodo,
              copias_bn, copias_color1, importe_bn, importe_color1, total,
              id_factura_dolibarr, fecha_factura, usuario)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'api')`,
          [
            consumoId, impresora_id, periodo,
            d.copias_bn ?? 0, d.copias_c1 ?? 0,
            d.importe_bn ?? 0, d.importe_c1 ?? 0,
            d.importe_total ?? 0,
            idFactura ?? null,
          ],
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // ── Summary builder ───────────────────────────

  _resumen(resultados, facturas, noEncontradas) {
    const estados = {};
    for (const r of resultados) {
      estados[r.estado] = (estados[r.estado] || 0) + 1;
    }
    const creadas = facturas.filter((f) => f.estado === 'creada').length;
    const errores = facturas.filter((f) => f.estado === 'error_envio').length;
    return {
      total_impresoras:         resultados.length,
      estados_impresoras:       estados,
      empresas_con_factura:     facturas.length,
      empresas_no_en_dolibarr:  noEncontradas.length,
      nombres_no_en_dolibarr:   noEncontradas,
      facturas_creadas:         creadas,
      facturas_error_envio:     errores,
      importe_total_estimado:   Math.round(
        facturas.reduce((s, f) => s + f.importe_total, 0) * 100,
      ) / 100,
    };
  }
}

module.exports = FacturacionService;
