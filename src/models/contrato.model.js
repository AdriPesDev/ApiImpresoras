class ContratoModel {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll(filtros = {}) {
    let query = `
      SELECT c.*, i.serial_number, i.modelo, e.nombre_oficial as empresa_nombre
      FROM contratos_impresoras c
      JOIN impresoras i ON c.impresora_id = i.id
      LEFT JOIN empresas e ON i.empresa_id = e.id
      WHERE 1=1
    `;
    const params = [];

    if (filtros.impresora_id) {
      query += " AND c.impresora_id = ?";
      params.push(filtros.impresora_id);
    }

    if (filtros.activo !== undefined) {
      query += " AND c.activo = ?";
      params.push(filtros.activo);
    }

    query += " ORDER BY c.created_at DESC";

    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  async findById(id) {
    const [rows] = await this.pool.query(
      "SELECT * FROM contratos_impresoras WHERE id = ?",
      [id],
    );
    return rows[0];
  }

  async findActivoByImpresora(impresora_id) {
    const [rows] = await this.pool.query(
      `SELECT * FROM contratos_impresoras 
       WHERE impresora_id = ? AND activo = 1 
       ORDER BY created_at DESC LIMIT 1`,
      [impresora_id],
    );
    return rows[0];
  }

  async create(contratoData) {
    const {
      impresora_id,
      copias_bn_incluidas,
      copias_color1_incluidas,
      copias_color2_incluidas,
      copias_color3_incluidas,
      precio_minimo,
      tipo_contrato,
      activo,
    } = contratoData;

    // Desactivar contratos anteriores
    await this.pool.query(
      "UPDATE contratos_impresoras SET activo = 0 WHERE impresora_id = ?",
      [impresora_id],
    );

    const [result] = await this.pool.query(
      `INSERT INTO contratos_impresoras 
       (impresora_id, copias_bn_incluidas, copias_color1_incluidas, 
        copias_color2_incluidas, copias_color3_incluidas, precio_minimo, tipo_contrato, activo) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        impresora_id,
        copias_bn_incluidas || 0,
        copias_color1_incluidas || 0,
        copias_color2_incluidas || 0,
        copias_color3_incluidas || 0,
        precio_minimo || 0,
        tipo_contrato || "GLOBAL",
        activo !== undefined ? activo : 1,
      ],
    );

    return this.findById(result.insertId);
  }

  async update(id, contratoData) {
    const {
      copias_bn_incluidas,
      copias_color1_incluidas,
      copias_color2_incluidas,
      copias_color3_incluidas,
      precio_minimo,
      tipo_contrato,
      activo,
    } = contratoData;

    await this.pool.query(
      `UPDATE contratos_impresoras SET 
       copias_bn_incluidas = ?, copias_color1_incluidas = ?,
       copias_color2_incluidas = ?, copias_color3_incluidas = ?,
       precio_minimo = ?, tipo_contrato = ?, activo = ?
       WHERE id = ?`,
      [
        copias_bn_incluidas,
        copias_color1_incluidas,
        copias_color2_incluidas,
        copias_color3_incluidas,
        precio_minimo,
        tipo_contrato,
        activo,
        id,
      ],
    );

    return this.findById(id);
  }

  async delete(id) {
    const [result] = await this.pool.query(
      "DELETE FROM contratos_impresoras WHERE id = ?",
      [id],
    );
    return result.affectedRows > 0;
  }
}

module.exports = ContratoModel;
