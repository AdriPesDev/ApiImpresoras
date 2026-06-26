// El motor de cálculo por impresora vive ahora en un módulo puro y compartido
// (lo reutiliza también la importación de CSV para poblar consumos_mensuales).
const { procesarImpresora, nombreMes, timestampMesSiguiente } = require('./motorFacturacion');

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

  // Devuelve TODAS las líneas de contrato activas para esa impresora (una por
  // empresa participante). En un contrato compartido habrá varias líneas, cada
  // una con su `porcentaje_participacion` y sus copias incluidas; el motor reparte
  // el gasto entre ellas. Si no hay contrato, devuelve [].
  async _getContratoLineas(serial) {
    const [rows] = await this.pool.query(
      `SELECT ci.empresa_id, e.nombre_oficial AS empresa_nombre,
              ci.porcentaje_participacion,
              ci.precio_bn, ci.precio_color1, ci.precio_color2, ci.precio_color3,
              ci.copias_bn_incluidas, ci.copias_c1_incluidas,
              ci.copias_c2_incluidas, ci.copias_c3_incluidas,
              ci.precio_minimo_mensual, c.numero_contrato
       FROM contrato_impresoras ci
       INNER JOIN contratos c ON c.id = ci.contrato_id
       INNER JOIN impresoras i ON i.id = ci.impresora_id
       LEFT  JOIN empresas e ON e.id = ci.empresa_id
       WHERE i.serial_number = ?
         AND ci.activo = TRUE
         AND c.activo = TRUE
         AND c.fecha_inicio <= CURDATE()
         AND (c.fecha_fin IS NULL OR c.fecha_fin >= CURDATE())
       ORDER BY ci.id`,
      [serial],
    );
    return rows;
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
  // Resuelve los 3 datos de BD que necesita el motor y delega en el módulo
  // puro compartido `motorFacturacion`. La lógica de cálculo es idéntica a la
  // que se usa al importar el CSV (un único motor, sin duplicar reglas).

  async _procesarImpresora(fila, periodo) {
    const serial = fila.serial_number;
    const preciosImpresora = await this._getPreciosImpresora(serial);
    const ultimaLectura    = await this._getUltimaLectura(serial);
    const contratoLineas   = await this._getContratoLineas(serial);
    return procesarImpresora({ fila, periodo, preciosImpresora, ultimaLectura, contratoLineas });
  }

  // Resuelve el tercero (socid) de una empresa para emitir en Dolibarr.
  // Prioriza el dolibarr_id ya guardado en `empresas` (verificado fiable y que
  // coincide con la búsqueda por nombre); si no hay fila o el id no es válido,
  // cae a la búsqueda por nombre en Dolibarr.
  async _resolverTercero(empresaNombre) {
    const [rows] = await this.pool.query(
      'SELECT dolibarr_id, nombre_oficial FROM empresas WHERE nombre_oficial = ? LIMIT 1',
      [empresaNombre],
    );
    if (rows.length && Number(rows[0].dolibarr_id) > 0) {
      return { id: Number(rows[0].dolibarr_id), nom: rows[0].nombre_oficial, _source: 'empresas' };
    }
    return this.dolibarr.buscarTercero(empresaNombre);
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
      const tercero = await this._resolverTercero(empresaNombre);
      if (!tercero) {
        empresasNoEncontradas.push(empresaNombre);
        for (const imp of impresoras) {
          imp.estado = 'sin_empresa_dolibarr';
          imp.detalle.msg = 'no encontrada en Dolibarr.';
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

  // ── Reconstrucción desde consumos persistidos ──
  // El paso de emisión NO recibe lecturas del cliente: parte de los consumos ya
  // calculados y guardados al importar (lo que el usuario revisó). Para construir
  // las líneas (incl. reparto por empresa y mínimos) se recalcula con el MISMO
  // motor, alimentado con las lecturas REALES de BD (no con deltas) → sin la
  // doble resta del flujo anterior.

  async _cargarConsumos(periodo, consumoIds) {
    if (!Array.isArray(consumoIds) || !consumoIds.length) return [];
    const ids = consumoIds.map((n) => Number.parseInt(n, 10)).filter(Number.isFinite);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await this.pool.query(
      `SELECT cm.id, cm.impresora_id, cm.periodo,
              cm.copias_bn_mes, cm.copias_color1_mes, cm.copias_color2_mes, cm.copias_color3_mes,
              cm.importe_bn, cm.importe_color1, cm.importe_color2, cm.importe_color3, cm.total_facturar,
              cm.facturado, i.serial_number, i.modelo, e.nombre_oficial AS empresa_nombre
       FROM consumos_mensuales cm
       INNER JOIN impresoras i ON i.id = cm.impresora_id
       LEFT  JOIN empresas e ON e.id = i.empresa_id
       WHERE cm.id IN (${placeholders}) AND cm.periodo = ? AND cm.facturado = 0`,
      [...ids, periodo],
    );
    return rows;
  }

  // Reconstruye los resultados del motor (uno por empresa participante) para un
  // consumo, usando la última lectura del periodo como "actual" y la última
  // anterior al día 1 como "apertura".
  async _resultadosParaConsumo(consumo, periodo) {
    const { impresora_id, serial_number: serial, modelo, empresa_nombre: empresaNombre } = consumo;

    const [curRows] = await this.pool.query(
      `SELECT copias_bn_total, copias_color_total, copias_color1_total,
              copias_color2_total, copias_color3_total, fecha_lectura
       FROM registros_contadores
       WHERE impresora_id = ? AND DATE_FORMAT(fecha_lectura, '%Y-%m') = ?
       ORDER BY fecha_lectura DESC LIMIT 1`,
      [impresora_id, periodo],
    );
    if (!curRows.length) return [];
    const cur = curRows[0];

    const fila = {
      serial_number: serial,
      modelo,
      empresa_nombre: empresaNombre || '',
      bn_total: cur.copias_bn_total,
      color_total: cur.copias_color_total || 0,
      color1_total: cur.copias_color1_total,
      color2_total: cur.copias_color2_total,
      color3_total: cur.copias_color3_total,
      color_niv2_total: cur.copias_color2_total,
      color_niv3_total: cur.copias_color3_total,
      fecha_lectura: cur.fecha_lectura,
    };

    const preciosImpresora = await this._getPreciosImpresora(serial);
    const contratoLineas   = await this._getContratoLineas(serial);
    const [prevRows] = await this.pool.query(
      `SELECT copias_bn_total, copias_color1_total, copias_color2_total, copias_color3_total,
              fecha_lectura, contador_negativo
       FROM registros_contadores
       WHERE impresora_id = ? AND fecha_lectura < ?
       ORDER BY fecha_lectura DESC LIMIT 1`,
      [impresora_id, `${periodo}-01 00:00:00`],
    );
    const previa = prevRows[0] || null;

    const resultadosMotor = procesarImpresora({ fila, periodo, preciosImpresora, ultimaLectura: previa, contratoLineas });
    const fechaAnterior = previa?.fecha_lectura || null;
    resultadosMotor.forEach((r) => { r.fecha_anterior = fechaAnterior; });
    return resultadosMotor;
  }

  // ── Public API ────────────────────────────────

  // Vista previa de la emisión a partir de los consumos seleccionados.
  async preview(periodo, consumoIds) {
    this.dolibarr.clearCache();
    const consumos = await this._cargarConsumos(periodo, consumoIds);
    const resultados = (await Promise.all(
      consumos.map((c) => this._resultadosParaConsumo(c, periodo)),
    )).flat();

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

  // Emite a Dolibarr los consumos seleccionados (facturado=0) y, al crearse la
  // factura, marca cada consumo como facturado y registra logs_facturacion.
  async ejecutar(periodo, consumoIds) {
    this.dolibarr.clearCache();
    const consumos = await this._cargarConsumos(periodo, consumoIds);
    const serialToConsumo = new Map();
    for (const c of consumos) serialToConsumo.set(c.serial_number, c);

    const resultados = (await Promise.all(
      consumos.map((c) => this._resultadosParaConsumo(c, periodo)),
    )).flat();

    const { facturas, empresasNoEncontradas } = await this._agruparYConstruir(resultados, periodo);

    const consumosPersistidos = new Set();
    for (const factura of facturas) {
      let idFactura = null;
      // 1) Crear la factura en Dolibarr
      try {
        const resp = await this.dolibarr.crearFactura(factura.dolibarr_payload);
        idFactura = typeof resp === 'number' ? resp : resp?.id;
        factura.estado              = 'creada';
        factura.id_factura_dolibarr = idFactura;
      } catch (err) {
        factura.estado       = 'error_envio';
        factura.error_detalle = err.message;
        console.error(`[Dolibarr] Error creando factura para ${factura.empresa_csv} (socid ${factura.socid}):`, err.message);
        continue; // No se creó en Dolibarr → no hay nada que persistir.
      }

      // 2) Marcar los consumos de esta factura como facturados + log. La factura
      //    YA existe en Dolibarr; si la persistencia falla NO es 'error_envio':
      //    se marca aparte para poder reconciliar a mano sin perder el rastro.
      try {
        for (const serial of factura.seriales) {
          const consumo = serialToConsumo.get(serial);
          if (consumo && !consumosPersistidos.has(consumo.id)) {
            await this._persistirConsumoFacturado(consumo);
            consumosPersistidos.add(consumo.id);
          }
        }
      } catch (err) {
        factura.estado        = 'creada_sin_persistir';
        factura.error_detalle = `Factura creada en Dolibarr (id ${idFactura}) pero falló la persistencia local: ${err.message}`;
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

  // ── Análisis full-fleet (solo para el reporte Excel) ──────────
  // Foto del periodo de TODA la flota, independiente de la selección de consumos.
  // Población = impresoras con ≥1 lectura en el periodo (equivale al CSV importado).
  // Es read-only respecto a Dolibarr: resuelve terceros con GET cacheado para
  // detectar `sin_empresa_dolibarr`, pero NUNCA emite facturas (no llama a
  // crearFactura). Reutiliza el mismo motor y helpers que la emisión, así que
  // clasifica cada impresora en facturable / sin_consumo / sin_precio / etc.,
  // recuperando las categorías que el flujo consumo-driven no puede ver.
  async analizarFlota(periodo) {
    this.dolibarr.clearCache();
    const [printers] = await this.pool.query(
      `SELECT DISTINCT i.id AS impresora_id, i.serial_number, i.modelo,
              e.nombre_oficial AS empresa_nombre
       FROM registros_contadores rc
       INNER JOIN impresoras i ON i.id = rc.impresora_id
       LEFT  JOIN empresas e ON e.id = i.empresa_id
       WHERE DATE_FORMAT(rc.fecha_lectura, '%Y-%m') = ?
       ORDER BY e.nombre_oficial, i.serial_number`,
      [periodo],
    );

    // _resultadosParaConsumo destructura {impresora_id, serial_number, modelo,
    // empresa_nombre}: los `printers` ya traen esos campos → reutilización directa.
    const resultados = (await Promise.all(
      printers.map((p) => this._resultadosParaConsumo(p, periodo)),
    )).flat();

    const { facturas, empresasNoEncontradas } = await this._agruparYConstruir(resultados, periodo);
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
  // La lectura ya se guardó al importar y el consumo ya existe (facturado=0):
  // aquí solo se marca facturado=1 y se registra en logs_facturacion (columnas
  // reales del esquema; NO existe id_factura_dolibarr en esa tabla).

  async _persistirConsumoFacturado(consumo) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        'UPDATE consumos_mensuales SET facturado = 1 WHERE id = ?',
        [consumo.id],
      );

      await conn.query(
        `INSERT INTO logs_facturacion
           (consumo_id, impresora_id, periodo,
            copias_bn, copias_color1, copias_color2, copias_color3,
            importe_bn, importe_color1, importe_color2, importe_color3,
            total, fecha_factura, usuario)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'api')`,
        [
          consumo.id, consumo.impresora_id, consumo.periodo,
          consumo.copias_bn_mes ?? 0, consumo.copias_color1_mes ?? 0,
          consumo.copias_color2_mes ?? 0, consumo.copias_color3_mes ?? 0,
          consumo.importe_bn ?? 0, consumo.importe_color1 ?? 0,
          consumo.importe_color2 ?? 0, consumo.importe_color3 ?? 0,
          consumo.total_facturar ?? 0,
        ],
      );

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
    const creadasSinPersistir = facturas.filter((f) => f.estado === 'creada_sin_persistir').length;
    return {
      total_impresoras:         resultados.length,
      estados_impresoras:       estados,
      empresas_con_factura:     facturas.length,
      empresas_no_en_dolibarr:  noEncontradas.length,
      nombres_no_en_dolibarr:   noEncontradas,
      facturas_creadas:         creadas,
      facturas_error_envio:     errores,
      facturas_creadas_sin_persistir: creadasSinPersistir,
      importe_total_estimado:   Math.round(
        facturas.reduce((s, f) => s + f.importe_total, 0) * 100,
      ) / 100,
    };
  }
}

module.exports = FacturacionService;
