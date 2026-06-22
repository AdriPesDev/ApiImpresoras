// models/contrato.model.js
class ContratoModel {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll(filtros = {}) {
    let query = `
      SELECT ci.*,
             con.id AS contrato_id,
             e.nombre_oficial AS empresa_nombre,
             i.serial_number AS impresora_serial,
             i.modelo AS impresora_modelo
      FROM contratos_impresoras ci
      LEFT JOIN contratos con ON con.numero_contrato = ci.numero_contrato
      LEFT JOIN empresas e ON ci.empresa_id = e.id
      LEFT JOIN impresoras i ON ci.impresora_id = i.id
      WHERE 1=1
    `;
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

    if (filtros.fecha) {
      query += " AND ci.fecha_inicio <= ? AND (ci.fecha_fin IS NULL OR ci.fecha_fin >= ?)";
      params.push(filtros.fecha, filtros.fecha);
    }

    if (filtros.buscar) {
      query += " AND (ci.numero_contrato LIKE ? OR e.nombre_oficial LIKE ?)";
      params.push(`%${filtros.buscar}%`, `%${filtros.buscar}%`);
    }

    query += " ORDER BY ci.created_at DESC";
    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  async findById(id) {
    const [rows] = await this.pool.query(
      `SELECT ci.*,
              con.id AS contrato_id,
              e.nombre_oficial AS empresa_nombre,
              i.serial_number AS impresora_serial,
              i.modelo AS impresora_modelo
       FROM contratos_impresoras ci
       LEFT JOIN contratos con ON con.numero_contrato = ci.numero_contrato
       LEFT JOIN empresas e ON ci.empresa_id = e.id
       LEFT JOIN impresoras i ON ci.impresora_id = i.id
       WHERE ci.id = ?`,
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
      "numero_contrato",
      "empresa_id",
      "factura_separada",
      "descuento_copias_fijo_bn",
      "descuento_copias_fijo_c1",
      "descuento_copias_fijo_c2",
      "descuento_copias_fijo_c3",
      "descuento_copias_pct_bn",
      "descuento_copias_pct_c1",
      "descuento_copias_pct_c2",
      "descuento_copias_pct_c3",
      "descuento_pct_confirmado",
      "fecha_inicio",
      "fecha_fin",
      "activo",
      "notas",
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
      await this.pool.query(
        `UPDATE contratos SET ${fields.join(", ")} WHERE id = ?`,
        params,
      );
    }

    if (data.impresoras !== undefined) {
      await this.pool.query(
        "DELETE FROM contrato_impresoras WHERE contrato_id = ?",
        [id],
      );
      if (data.impresoras.length) {
        await this._saveImpresoras(id, data.impresoras);
      }
    }

    if (data.lineas_fijas !== undefined) {
      await this.pool.query(
        "DELETE FROM contrato_lineas_fijas WHERE contrato_id = ?",
        [id],
      );
      if (data.lineas_fijas.length) {
        await this._saveLineasFijas(id, data.lineas_fijas);
      }
    }

    return this.findById(id);
  }

  async toggleActivo(id, activo) {
    await this.pool.query("UPDATE contratos SET activo = ? WHERE id = ?", [
      activo,
      id,
    ]);
    return this.findById(id);
  }

  async delete(id) {
    const [result] = await this.pool.query(
      "DELETE FROM contratos_impresoras WHERE id = ?",
      [id],
    );
    return result.affectedRows > 0;
  }

  // ── Sub-resource: impresoras ──────────────────────────────

  async addImpresora(contrato_id, data) {
    const insertId = await this._saveImpresoraRow(contrato_id, data);
    const [rows] = await this.pool.query(
      "SELECT * FROM contrato_impresoras WHERE id = ?",
      [insertId],
    );
    return rows[0];
  }

  async findActivosByImpresora(impresora_id, fecha = null) {
    let query = `
      SELECT c.*, e.nombre_oficial as empresa_nombre, e.cif as empresa_cif
      FROM contratos_impresoras c
      LEFT JOIN empresas e ON c.empresa_id = e.id
      WHERE c.impresora_id = ? AND c.activo = 1
    `;
    const params = [impresora_id];

    if (fecha) {
      query += ` AND c.fecha_inicio <= ? AND (c.fecha_fin IS NULL OR c.fecha_fin >= ?)`;
      params.push(fecha, fecha);
    }

    query += ` ORDER BY c.porcentaje_participacion DESC`;
    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  async findActivoByImpresora(impresora_id) {
    const [rows] = await this.pool.query(
      "SELECT * FROM contratos_impresoras WHERE impresora_id = ? AND activo = 1",
      [impresora_id],
    );
    return rows[0];
  }

  async create(contratoData) {
    const {
      numero_contrato,
      impresora_id,
      empresa_id,
      porcentaje_participacion = 100,
      copias_bn_incluidas = 0,
      copias_color1_incluidas = 0,
      copias_color2_incluidas = 0,
      copias_color3_incluidas = 0,
      precio_bn = null,
      precio_color1 = null,
      precio_color2 = null,
      precio_color3 = null,
      precio_minimo_mensual = 0,
      fecha_inicio,
      fecha_fin = null,
      activo = 1,
    } = contratoData;

    // Garantizar que existe un registro en `contratos` para este numero_contrato
    const [existing] = await this.pool.query(
      "SELECT id FROM contratos WHERE numero_contrato = ?",
      [numero_contrato],
    );
    if (existing.length === 0) {
      await this.pool.query(
        `INSERT INTO contratos (numero_contrato, empresa_id, fecha_inicio, fecha_fin, activo)
         VALUES (?, ?, ?, ?, ?)`,
        [numero_contrato, empresa_id, fecha_inicio, fecha_fin ?? null, activo],
      );
    }

    const [result] = await this.pool.query(
      `INSERT INTO contratos_impresoras (
        numero_contrato, impresora_id, empresa_id, porcentaje_participacion,
        copias_bn_incluidas, copias_color1_incluidas, copias_color2_incluidas,
        copias_color3_incluidas, precio_bn, precio_color1, precio_color2,
        precio_color3, precio_minimo_mensual, fecha_inicio, fecha_fin, activo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numero_contrato,
        impresora_id,
        empresa_id,
        porcentaje_participacion,
        copias_bn_incluidas,
        copias_color1_incluidas,
        copias_color2_incluidas,
        copias_color3_incluidas,
        precio_bn,
        precio_color1,
        precio_color2,
        precio_color3,
        precio_minimo_mensual,
        fecha_inicio,
        fecha_fin,
        activo,
      ],
    );
    return this.findById(result.insertId);
  }

  async update(id, contratoData) {
    const updates = [];
    const params = [];

    const fields = [
      "numero_contrato",
      "impresora_id",
      "empresa_id",
      "porcentaje_participacion",
      "copias_bn_incluidas",
      "copias_color1_incluidas",
      "copias_color2_incluidas",
      "copias_color3_incluidas",
      "precio_bn",
      "precio_color1",
      "precio_color2",
      "precio_color3",
      "precio_minimo_mensual",
      "fecha_inicio",
      "fecha_fin",
      "activo",
    ];

    for (const field of fields) {
      if (contratoData[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(contratoData[field]);
      }
    }

    if (updates.length === 0) return this.findById(id);

    params.push(id);
    await this.pool.query(
      `UPDATE contratos_impresoras SET ${updates.join(", ")} WHERE id = ?`,
      params,
    );
    return this.findById(id);
  }

  async removeLineaFija(lf_id) {
    const [result] = await this.pool.query(
      "DELETE FROM contrato_lineas_fijas WHERE id = ?",
      [lf_id],
    );
    return result.affectedRows > 0;
  }

  async softDelete(id) {
    const [result] = await this.pool.query(
      "UPDATE contratos_impresoras SET activo = 0 WHERE id = ?",
      [id],
    );
    return result.affectedRows > 0;
  }

  async getDistribucionCopias(impresora_id, periodo) {
    // Obtener contratos activos
    const contratos = await this.findActivosByImpresora(impresora_id, periodo);

    // Obtener consumo del período
    const [consumo] = await this.pool.query(
      `SELECT copias_bn_mes, copias_color1_mes, copias_color2_mes, copias_color3_mes
       FROM consumos_mensuales
       WHERE impresora_id = ? AND periodo = ?`,
      [impresora_id, periodo],
    );

    if (!consumo[0]) return [];

    const totalCopias = {
      bn: consumo[0].copias_bn_mes || 0,
      color1: consumo[0].copias_color1_mes || 0,
      color2: consumo[0].copias_color2_mes || 0,
      color3: consumo[0].copias_color3_mes || 0,
    };

    const distribucion = contratos.map((contrato) => ({
      contrato_id: contrato.id,
      numero_contrato: contrato.numero_contrato,
      empresa_id: contrato.empresa_id,
      empresa_nombre: contrato.empresa_nombre,
      porcentaje: contrato.porcentaje_participacion,
      copias_bn: Math.round(
        totalCopias.bn * (contrato.porcentaje_participacion / 100),
      ),
      copias_color1: Math.round(
        totalCopias.color1 * (contrato.porcentaje_participacion / 100),
      ),
      copias_color2: Math.round(
        totalCopias.color2 * (contrato.porcentaje_participacion / 100),
      ),
      copias_color3: Math.round(
        totalCopias.color3 * (contrato.porcentaje_participacion / 100),
      ),
    }));

    return distribucion;
  }
}

module.exports = ContratoModel;
