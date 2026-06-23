// models/contrato.model.js
// ─────────────────────────────────────────────────────────────────────────────
// Esquema CANÓNICO ( vía SHOW TABLES / DESCRIBE /
// SHOW CREATE VIEW v_contratos):
//   contratos             → cabecera del contrato (numero_contrato, empresa_id,
//                           fecha_inicio/fin, descuentos, activo, notas)
//   contrato_impresoras   → líneas por impresora/empresa (FK contrato_id;
//                           naming de copias: copias_c1/c2/c3_incluidas)
//   contrato_lineas_fijas → líneas fijas del contrato (FK contrato_id)
//
// La tabla plural `contratos_impresoras` (y `contratos_impresoras_old`) está VACÍA
// y obsoleta: NO se usa. La vista `v_contratos` y el motor de facturación
// (facturacion.service.js::_getContrato) ya operan sobre el esquema singular.
//
// La API de contratos expone una "línea plana" (cabecera + línea en una sola fila)
// porque es lo que consume el frontend (Contratos.jsx agrupa por numero_contrato).
// El `id` de cada elemento es el id de la fila de `contrato_impresoras` (ci.id).
// Internamente se mapea el naming del frontend (copias_colorN_incluidas) al de la
// tabla (copias_cN_incluidas).
// ─────────────────────────────────────────────────────────────────────────────

class ContratoModel {
  constructor(pool) {
    this.pool = pool;
  }

  // SELECT base que aplana cabecera + línea con el naming que espera el frontend.
  _selectBase() {
    return `
      SELECT ci.id,
             ci.contrato_id,
             c.numero_contrato,
             ci.impresora_id,
             ci.empresa_id,
             ci.porcentaje_participacion,
             ci.copias_bn_incluidas,
             ci.copias_c1_incluidas AS copias_color1_incluidas,
             ci.copias_c2_incluidas AS copias_color2_incluidas,
             ci.copias_c3_incluidas AS copias_color3_incluidas,
             ci.precio_bn, ci.precio_color1, ci.precio_color2, ci.precio_color3,
             ci.precio_minimo_mensual,
             ci.tipo_copias_incluidas,
             ci.activo,
             c.fecha_inicio, c.fecha_fin,
             e.nombre_oficial AS empresa_nombre,
             i.serial_number  AS impresora_serial,
             i.modelo         AS impresora_modelo
      FROM contrato_impresoras ci
      INNER JOIN contratos  c ON c.id = ci.contrato_id
      LEFT  JOIN empresas   e ON e.id = ci.empresa_id
      LEFT  JOIN impresoras i ON i.id = ci.impresora_id
    `;
  }

  // Normaliza los campos de una línea desde el payload del frontend a columnas reales.
  _lineColumns(data) {
    return {
      impresora_id: data.impresora_id,
      empresa_id: data.empresa_id ?? null,
      porcentaje_participacion: data.porcentaje_participacion ?? 100,
      copias_bn_incluidas: data.copias_bn_incluidas ?? 0,
      copias_c1_incluidas: data.copias_color1_incluidas ?? data.copias_c1_incluidas ?? 0,
      copias_c2_incluidas: data.copias_color2_incluidas ?? data.copias_c2_incluidas ?? 0,
      copias_c3_incluidas: data.copias_color3_incluidas ?? data.copias_c3_incluidas ?? 0,
      precio_bn: data.precio_bn ?? null,
      precio_color1: data.precio_color1 ?? null,
      precio_color2: data.precio_color2 ?? null,
      precio_color3: data.precio_color3 ?? null,
      precio_minimo_mensual: data.precio_minimo_mensual ?? 0,
      activo: data.activo ?? 1,
    };
  }

  // ── Lectura ───────────────────────────────────────────────────────────────

  async findAll(filtros = {}) {
    let query = this._selectBase() + " WHERE 1=1";
    const params = [];

    if (filtros.impresora_id) {
      query += " AND ci.impresora_id = ?";
      params.push(filtros.impresora_id);
    }
    if (filtros.empresa_id) {
      query += " AND ci.empresa_id = ?";
      params.push(filtros.empresa_id);
    }
    if (filtros.activo !== undefined) {
      query += " AND ci.activo = ?";
      params.push(filtros.activo ? 1 : 0);
    }
    if (filtros.buscar) {
      query += " AND (c.numero_contrato LIKE ? OR e.nombre_oficial LIKE ? OR i.serial_number LIKE ?)";
      const like = `%${filtros.buscar}%`;
      params.push(like, like, like);
    }

    query += " ORDER BY c.numero_contrato, ci.id";
    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  // Devuelve la línea plana por su id (ci.id). El controlador la usa como
  // comprobación de existencia y como valor de retorno de create/update.
  async findById(id) {
    const [rows] = await this.pool.query(
      this._selectBase() + " WHERE ci.id = ?",
      [id],
    );
    return rows[0] || null;
  }

  // ── Escritura: contrato (línea) ───────────────────────────────────────────

  // find-or-create de la cabecera por numero_contrato dentro de la transacción.
  async _ensureContrato(conn, data) {
    const [existing] = await conn.query(
      "SELECT id FROM contratos WHERE numero_contrato = ? LIMIT 1",
      [data.numero_contrato],
    );
    if (existing.length) return existing[0].id;

    const [ins] = await conn.query(
      `INSERT INTO contratos (numero_contrato, empresa_id, fecha_inicio, fecha_fin, activo)
       VALUES (?, ?, ?, ?, ?)`,
      [
        data.numero_contrato,
        data.empresa_id ?? null,
        data.fecha_inicio,
        data.fecha_fin ?? null,
        data.activo ?? 1,
      ],
    );
    return ins.insertId;
  }

  async create(data) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const contratoId = await this._ensureContrato(conn, data);
      const col = this._lineColumns(data);

      const [ins] = await conn.query(
        `INSERT INTO contrato_impresoras
           (contrato_id, impresora_id, empresa_id, porcentaje_participacion,
            copias_bn_incluidas, copias_c1_incluidas, copias_c2_incluidas, copias_c3_incluidas,
            precio_bn, precio_color1, precio_color2, precio_color3,
            precio_minimo_mensual, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          contratoId, col.impresora_id, col.empresa_id, col.porcentaje_participacion,
          col.copias_bn_incluidas, col.copias_c1_incluidas, col.copias_c2_incluidas, col.copias_c3_incluidas,
          col.precio_bn, col.precio_color1, col.precio_color2, col.precio_color3,
          col.precio_minimo_mensual, col.activo,
        ],
      );

      await conn.commit();
      return this.findById(ins.insertId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async update(id, data) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [lineRows] = await conn.query(
        "SELECT contrato_id FROM contrato_impresoras WHERE id = ?",
        [id],
      );
      if (!lineRows.length) {
        await conn.rollback();
        return null;
      }
      const contratoId = lineRows[0].contrato_id;

      // Campos de la línea (solo los presentes en el payload)
      const lineMap = {
        impresora_id: data.impresora_id,
        empresa_id: data.empresa_id,
        porcentaje_participacion: data.porcentaje_participacion,
        copias_bn_incluidas: data.copias_bn_incluidas,
        copias_c1_incluidas: data.copias_color1_incluidas ?? data.copias_c1_incluidas,
        copias_c2_incluidas: data.copias_color2_incluidas ?? data.copias_c2_incluidas,
        copias_c3_incluidas: data.copias_color3_incluidas ?? data.copias_c3_incluidas,
        precio_bn: data.precio_bn,
        precio_color1: data.precio_color1,
        precio_color2: data.precio_color2,
        precio_color3: data.precio_color3,
        precio_minimo_mensual: data.precio_minimo_mensual,
        activo: data.activo,
      };
      const fields = [];
      const params = [];
      for (const [k, v] of Object.entries(lineMap)) {
        if (v !== undefined) {
          fields.push(`${k} = ?`);
          params.push(v);
        }
      }
      if (fields.length) {
        params.push(id);
        await conn.query(
          `UPDATE contrato_impresoras SET ${fields.join(", ")} WHERE id = ?`,
          params,
        );
      }

      // Campos de la cabecera (numero_contrato / fechas) si vienen en el payload
      const headMap = {
        numero_contrato: data.numero_contrato,
        fecha_inicio: data.fecha_inicio,
        fecha_fin: data.fecha_fin,
      };
      const hFields = [];
      const hParams = [];
      for (const [k, v] of Object.entries(headMap)) {
        if (v !== undefined) {
          hFields.push(`${k} = ?`);
          hParams.push(v);
        }
      }
      if (hFields.length) {
        hParams.push(contratoId);
        await conn.query(
          `UPDATE contratos SET ${hFields.join(", ")} WHERE id = ?`,
          hParams,
        );
      }

      await conn.commit();
      return this.findById(id);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // Activa/desactiva la línea (la página muestra el estado por línea).
  async toggleActivo(id, activo) {
    await this.pool.query(
      "UPDATE contrato_impresoras SET activo = ? WHERE id = ?",
      [activo ? 1 : 0, id],
    );
    return this.findById(id);
  }

  // Borra la línea; si era la última de su contrato, borra también la cabecera
  // y sus líneas fijas. Transaccional.
  async delete(id) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [lineRows] = await conn.query(
        "SELECT contrato_id FROM contrato_impresoras WHERE id = ?",
        [id],
      );
      if (!lineRows.length) {
        await conn.rollback();
        return false;
      }
      const contratoId = lineRows[0].contrato_id;

      await conn.query("DELETE FROM contrato_impresoras WHERE id = ?", [id]);

      const [rest] = await conn.query(
        "SELECT COUNT(*) AS n FROM contrato_impresoras WHERE contrato_id = ?",
        [contratoId],
      );
      if (rest[0].n === 0) {
        await conn.query("DELETE FROM contrato_lineas_fijas WHERE contrato_id = ?", [contratoId]);
        await conn.query("DELETE FROM contratos WHERE id = ?", [contratoId]);
      }

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // ── Sub-recurso: impresoras del contrato (param :id = contrato_id cabecera) ──

  async getImpresoras(contrato_id) {
    const [rows] = await this.pool.query(
      this._selectBase() + " WHERE ci.contrato_id = ? ORDER BY ci.id",
      [contrato_id],
    );
    return rows;
  }

  async addImpresora(contrato_id, data) {
    const col = this._lineColumns(data);
    const [ins] = await this.pool.query(
      `INSERT INTO contrato_impresoras
         (contrato_id, impresora_id, empresa_id, porcentaje_participacion,
          copias_bn_incluidas, copias_c1_incluidas, copias_c2_incluidas, copias_c3_incluidas,
          precio_bn, precio_color1, precio_color2, precio_color3,
          precio_minimo_mensual, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contrato_id, col.impresora_id, col.empresa_id, col.porcentaje_participacion,
        col.copias_bn_incluidas, col.copias_c1_incluidas, col.copias_c2_incluidas, col.copias_c3_incluidas,
        col.precio_bn, col.precio_color1, col.precio_color2, col.precio_color3,
        col.precio_minimo_mensual, col.activo,
      ],
    );
    return this.findById(ins.insertId);
  }

  // Actualiza una línea por su id (ci_id), sin tocar la cabecera.
  async updateImpresora(ci_id, data) {
    const lineMap = {
      impresora_id: data.impresora_id,
      empresa_id: data.empresa_id,
      porcentaje_participacion: data.porcentaje_participacion,
      copias_bn_incluidas: data.copias_bn_incluidas,
      copias_c1_incluidas: data.copias_color1_incluidas ?? data.copias_c1_incluidas,
      copias_c2_incluidas: data.copias_color2_incluidas ?? data.copias_c2_incluidas,
      copias_c3_incluidas: data.copias_color3_incluidas ?? data.copias_c3_incluidas,
      precio_bn: data.precio_bn,
      precio_color1: data.precio_color1,
      precio_color2: data.precio_color2,
      precio_color3: data.precio_color3,
      precio_minimo_mensual: data.precio_minimo_mensual,
      activo: data.activo,
    };
    const fields = [];
    const params = [];
    for (const [k, v] of Object.entries(lineMap)) {
      if (v !== undefined) {
        fields.push(`${k} = ?`);
        params.push(v);
      }
    }
    if (!fields.length) return this.findById(ci_id);

    params.push(ci_id);
    const [result] = await this.pool.query(
      `UPDATE contrato_impresoras SET ${fields.join(", ")} WHERE id = ?`,
      params,
    );
    if (result.affectedRows === 0) return null;
    return this.findById(ci_id);
  }

  async removeImpresora(ci_id) {
    const [result] = await this.pool.query(
      "DELETE FROM contrato_impresoras WHERE id = ?",
      [ci_id],
    );
    return result.affectedRows > 0;
  }

  // ── Sub-recurso: líneas fijas del contrato ────────────────────────────────

  async getLineasFijas(contrato_id) {
    const [rows] = await this.pool.query(
      `SELECT * FROM contrato_lineas_fijas
       WHERE contrato_id = ? AND activo = TRUE
       ORDER BY orden, id`,
      [contrato_id],
    );
    return rows;
  }

  // Alta de línea fija. Columnas reales: descripcion (req), precio_unitario,
  // cantidad, tva_tx (IVA %), orden, activo.
  async addLineaFija(contrato_id, data = {}) {
    if (!data.descripcion || !String(data.descripcion).trim()) {
      const err = new Error("descripcion es requerida para la línea fija.");
      err.status = 400;
      throw err;
    }
    const [ins] = await this.pool.query(
      `INSERT INTO contrato_lineas_fijas
         (contrato_id, descripcion, precio_unitario, cantidad, tva_tx, orden, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        contrato_id,
        String(data.descripcion).trim(),
        data.precio_unitario ?? 0,
        data.cantidad ?? 1,
        data.tva_tx ?? 21,
        data.orden ?? 0,
        data.activo ?? 1,
      ],
    );
    const [rows] = await this.pool.query(
      "SELECT * FROM contrato_lineas_fijas WHERE id = ?",
      [ins.insertId],
    );
    return rows[0] || null;
  }

  async updateLineaFija(lf_id, data = {}) {
    const allowed = ["descripcion", "precio_unitario", "cantidad", "tva_tx", "orden", "activo"];
    const fields = [];
    const params = [];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(data[key]);
      }
    }
    if (!fields.length) {
      const [rows] = await this.pool.query(
        "SELECT * FROM contrato_lineas_fijas WHERE id = ?",
        [lf_id],
      );
      return rows[0] || null;
    }
    params.push(lf_id);
    const [result] = await this.pool.query(
      `UPDATE contrato_lineas_fijas SET ${fields.join(", ")} WHERE id = ?`,
      params,
    );
    if (result.affectedRows === 0) return null;
    const [rows] = await this.pool.query(
      "SELECT * FROM contrato_lineas_fijas WHERE id = ?",
      [lf_id],
    );
    return rows[0] || null;
  }

  async removeLineaFija(lf_id) {
    const [result] = await this.pool.query(
      "DELETE FROM contrato_lineas_fijas WHERE id = ?",
      [lf_id],
    );
    return result.affectedRows > 0;
  }

  // ── Utilidades para otros módulos (esquema singular) ──────────────────────
  // Actualmente sin consumidores externos (la facturación usa su propio
  // _getContrato). Se mantienen coherentes con el esquema canónico por si se
  // reutilizan en el futuro.

  async findActivoPorSerial(serial) {
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

  async findActivosByImpresora(impresora_id, fecha = null) {
    let query =
      this._selectBase() + " WHERE ci.impresora_id = ? AND ci.activo = 1 AND c.activo = 1";
    const params = [impresora_id];
    if (fecha) {
      query += " AND c.fecha_inicio <= ? AND (c.fecha_fin IS NULL OR c.fecha_fin >= ?)";
      params.push(fecha, fecha);
    }
    query += " ORDER BY ci.porcentaje_participacion DESC";
    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  async findActivoByImpresora(impresora_id) {
    const [rows] = await this.pool.query(
      this._selectBase() + " WHERE ci.impresora_id = ? AND ci.activo = 1 LIMIT 1",
      [impresora_id],
    );
    return rows[0] || null;
  }

  async getDistribucionCopias(impresora_id, periodo) {
    const contratos = await this.findActivosByImpresora(impresora_id, periodo);

    const [consumo] = await this.pool.query(
      `SELECT copias_bn_mes, copias_color1_mes, copias_color2_mes, copias_color3_mes
       FROM consumos_mensuales
       WHERE impresora_id = ? AND periodo = ?`,
      [impresora_id, periodo],
    );
    if (!consumo[0]) return [];

    const total = {
      bn: consumo[0].copias_bn_mes || 0,
      color1: consumo[0].copias_color1_mes || 0,
      color2: consumo[0].copias_color2_mes || 0,
      color3: consumo[0].copias_color3_mes || 0,
    };

    return contratos.map((contrato) => {
      const pct = (contrato.porcentaje_participacion || 0) / 100;
      return {
        contrato_id: contrato.contrato_id,
        numero_contrato: contrato.numero_contrato,
        empresa_id: contrato.empresa_id,
        empresa_nombre: contrato.empresa_nombre,
        porcentaje: contrato.porcentaje_participacion,
        copias_bn: Math.round(total.bn * pct),
        copias_color1: Math.round(total.color1 * pct),
        copias_color2: Math.round(total.color2 * pct),
        copias_color3: Math.round(total.color3 * pct),
      };
    });
  }
}

module.exports = ContratoModel;
