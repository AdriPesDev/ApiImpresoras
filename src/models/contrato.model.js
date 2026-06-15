class ContratoModel {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll(filtros = {}) {
    let query = `
      SELECT c.*, e.nombre_oficial AS empresa_nombre,
             COUNT(DISTINCT ci.id) AS num_impresoras
      FROM contratos c
      LEFT JOIN empresas e ON e.id = c.empresa_id
      LEFT JOIN contrato_impresoras ci ON ci.contrato_id = c.id AND ci.activo = TRUE
      WHERE 1=1
    `;
    const params = [];

    if (filtros.activo !== undefined) {
      query += ' AND c.activo = ?';
      params.push(filtros.activo);
    }
    if (filtros.empresa_id) {
      query += ' AND c.empresa_id = ?';
      params.push(filtros.empresa_id);
    }
    if (filtros.buscar) {
      query += ' AND (c.numero_contrato LIKE ? OR e.nombre_oficial LIKE ?)';
      params.push(`%${filtros.buscar}%`, `%${filtros.buscar}%`);
    }

    query += ' GROUP BY c.id ORDER BY c.activo DESC, e.nombre_oficial, c.numero_contrato';
    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  async findById(id) {
    const [rows] = await this.pool.query(
      `SELECT c.*, e.nombre_oficial AS empresa_nombre
       FROM contratos c
       LEFT JOIN empresas e ON e.id = c.empresa_id
       WHERE c.id = ?`,
      [id],
    );
    if (!rows[0]) return null;

    const contrato = rows[0];
    contrato.impresoras = await this.getImpresoras(id);
    contrato.lineas_fijas = await this.getLineasFijas(id);
    return contrato;
  }

  async getImpresoras(contrato_id) {
    const [rows] = await this.pool.query(
      `SELECT ci.*, i.serial_number, i.modelo,
              COALESCE(ei.nombre_oficial, ec.nombre_oficial) AS empresa_nombre
       FROM contrato_impresoras ci
       INNER JOIN impresoras i ON i.id = ci.impresora_id
       LEFT JOIN empresas ei ON ei.id = ci.empresa_id
       LEFT JOIN contratos c ON c.id = ci.contrato_id
       LEFT JOIN empresas ec ON ec.id = c.empresa_id
       WHERE ci.contrato_id = ?
       ORDER BY ci.id`,
      [contrato_id],
    );
    return rows;
  }

  async getLineasFijas(contrato_id) {
    const [rows] = await this.pool.query(
      `SELECT * FROM contrato_lineas_fijas
       WHERE contrato_id = ? AND activo = TRUE
       ORDER BY orden, id`,
      [contrato_id],
    );
    return rows;
  }

  // Used by the billing engine to get active contract prices for a serial
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

  async create(data) {
    const [result] = await this.pool.query(
      `INSERT INTO contratos
         (numero_contrato, empresa_id, factura_separada,
          descuento_copias_fijo_bn, descuento_copias_fijo_c1,
          descuento_copias_fijo_c2, descuento_copias_fijo_c3,
          descuento_copias_pct_bn, descuento_copias_pct_c1,
          descuento_copias_pct_c2, descuento_copias_pct_c3,
          descuento_pct_confirmado,
          fecha_inicio, fecha_fin, activo, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.numero_contrato,
        data.empresa_id,
        data.factura_separada ?? false,
        data.descuento_copias_fijo_bn ?? 0,
        data.descuento_copias_fijo_c1 ?? 0,
        data.descuento_copias_fijo_c2 ?? 0,
        data.descuento_copias_fijo_c3 ?? 0,
        data.descuento_copias_pct_bn ?? 0,
        data.descuento_copias_pct_c1 ?? 0,
        data.descuento_copias_pct_c2 ?? 0,
        data.descuento_copias_pct_c3 ?? 0,
        data.descuento_pct_confirmado ?? false,
        data.fecha_inicio,
        data.fecha_fin ?? null,
        data.activo ?? true,
        data.notas ?? null,
      ],
    );

    const contratoId = result.insertId;

    if (data.impresoras?.length) {
      await this._saveImpresoras(contratoId, data.impresoras);
    }
    if (data.lineas_fijas?.length) {
      await this._saveLineasFijas(contratoId, data.lineas_fijas);
    }

    return this.findById(contratoId);
  }

  async update(id, data) {
    const allowed = [
      'numero_contrato', 'empresa_id', 'factura_separada',
      'descuento_copias_fijo_bn', 'descuento_copias_fijo_c1',
      'descuento_copias_fijo_c2', 'descuento_copias_fijo_c3',
      'descuento_copias_pct_bn', 'descuento_copias_pct_c1',
      'descuento_copias_pct_c2', 'descuento_copias_pct_c3',
      'descuento_pct_confirmado', 'fecha_inicio', 'fecha_fin', 'activo', 'notas',
    ];
    const fields = [];
    const params = [];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(data[key]);
      }
    }

    if (fields.length) {
      params.push(id);
      await this.pool.query(`UPDATE contratos SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    if (data.impresoras !== undefined) {
      await this.pool.query('DELETE FROM contrato_impresoras WHERE contrato_id = ?', [id]);
      if (data.impresoras.length) {
        await this._saveImpresoras(id, data.impresoras);
      }
    }

    if (data.lineas_fijas !== undefined) {
      await this.pool.query('DELETE FROM contrato_lineas_fijas WHERE contrato_id = ?', [id]);
      if (data.lineas_fijas.length) {
        await this._saveLineasFijas(id, data.lineas_fijas);
      }
    }

    return this.findById(id);
  }

  async toggleActivo(id, activo) {
    await this.pool.query('UPDATE contratos SET activo = ? WHERE id = ?', [activo, id]);
    return this.findById(id);
  }

  async delete(id) {
    const [result] = await this.pool.query('DELETE FROM contratos WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  // ── Sub-resource: impresoras ──────────────────────────────

  async addImpresora(contrato_id, data) {
    const insertId = await this._saveImpresoraRow(contrato_id, data);
    const [rows] = await this.pool.query(
      'SELECT * FROM contrato_impresoras WHERE id = ?',
      [insertId],
    );
    return rows[0];
  }

  async updateImpresora(ci_id, data) {
    const allowed = [
      'precio_bn', 'precio_color1', 'precio_color2', 'precio_color3',
      'copias_bn_incluidas', 'copias_c1_incluidas', 'copias_c2_incluidas', 'copias_c3_incluidas',
      'precio_minimo_mensual', 'porcentaje_participacion', 'empresa_id', 'activo',
    ];
    const fields = [];
    const params = [];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(data[key]);
      }
    }

    if (fields.length) {
      params.push(ci_id);
      await this.pool.query(
        `UPDATE contrato_impresoras SET ${fields.join(', ')} WHERE id = ?`,
        params,
      );
    }

    const [rows] = await this.pool.query(
      'SELECT * FROM contrato_impresoras WHERE id = ?',
      [ci_id],
    );
    return rows[0];
  }

  async removeImpresora(ci_id) {
    const [result] = await this.pool.query(
      'DELETE FROM contrato_impresoras WHERE id = ?',
      [ci_id],
    );
    return result.affectedRows > 0;
  }

  // ── Sub-resource: lineas_fijas ────────────────────────────

  async addLineaFija(contrato_id, data) {
    const [result] = await this.pool.query(
      `INSERT INTO contrato_lineas_fijas
         (contrato_id, descripcion, precio_unitario, cantidad, tva_tx, orden)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        contrato_id,
        data.descripcion,
        data.precio_unitario ?? 0,
        data.cantidad ?? 1,
        data.tva_tx ?? 21,
        data.orden ?? 0,
      ],
    );
    const [rows] = await this.pool.query(
      'SELECT * FROM contrato_lineas_fijas WHERE id = ?',
      [result.insertId],
    );
    return rows[0];
  }

  async updateLineaFija(lf_id, data) {
    const allowed = ['descripcion', 'precio_unitario', 'cantidad', 'tva_tx', 'orden', 'activo'];
    const fields = [];
    const params = [];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(data[key]);
      }
    }

    if (fields.length) {
      params.push(lf_id);
      await this.pool.query(
        `UPDATE contrato_lineas_fijas SET ${fields.join(', ')} WHERE id = ?`,
        params,
      );
    }

    const [rows] = await this.pool.query(
      'SELECT * FROM contrato_lineas_fijas WHERE id = ?',
      [lf_id],
    );
    return rows[0];
  }

  async removeLineaFija(lf_id) {
    const [result] = await this.pool.query(
      'DELETE FROM contrato_lineas_fijas WHERE id = ?',
      [lf_id],
    );
    return result.affectedRows > 0;
  }

  // ── Private helpers ───────────────────────────────────────

  async _saveImpresoras(contrato_id, impresoras) {
    for (const imp of impresoras) {
      await this._saveImpresoraRow(contrato_id, imp);
    }
  }

  async _saveImpresoraRow(contrato_id, imp) {
    const [result] = await this.pool.query(
      `INSERT INTO contrato_impresoras
         (contrato_id, impresora_id, empresa_id, porcentaje_participacion,
          precio_bn, precio_color1, precio_color2, precio_color3,
          copias_bn_incluidas, copias_c1_incluidas, copias_c2_incluidas, copias_c3_incluidas,
          precio_minimo_mensual, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contrato_id,
        imp.impresora_id,
        imp.empresa_id ?? null,
        imp.porcentaje_participacion ?? 100,
        imp.precio_bn ?? null,
        imp.precio_color1 ?? null,
        imp.precio_color2 ?? null,
        imp.precio_color3 ?? null,
        imp.copias_bn_incluidas ?? 0,
        imp.copias_c1_incluidas ?? 0,
        imp.copias_c2_incluidas ?? 0,
        imp.copias_c3_incluidas ?? 0,
        imp.precio_minimo_mensual ?? 0,
        imp.activo ?? true,
      ],
    );
    return result.insertId;
  }

  async _saveLineasFijas(contrato_id, lineas) {
    for (let i = 0; i < lineas.length; i++) {
      const lf = lineas[i];
      await this.pool.query(
        `INSERT INTO contrato_lineas_fijas
           (contrato_id, descripcion, precio_unitario, cantidad, tva_tx, orden)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          contrato_id,
          lf.descripcion,
          lf.precio_unitario ?? 0,
          lf.cantidad ?? 1,
          lf.tva_tx ?? 21,
          lf.orden ?? i,
        ],
      );
    }
  }
}

module.exports = ContratoModel;
