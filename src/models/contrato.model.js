// models/contrato.model.js
class ContratoModel {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll(filtros = {}) {
    let query = `
      SELECT c.*, 
             e.nombre_oficial as empresa_nombre,
             i.serial_number as impresora_serial,
             i.modelo as impresora_modelo
      FROM contratos_impresoras c
      LEFT JOIN empresas e ON c.empresa_id = e.id
      LEFT JOIN impresoras i ON c.impresora_id = i.id
      WHERE 1=1
    `;
    const params = [];

    if (filtros.impresora_id) {
      query += " AND c.impresora_id = ?";
      params.push(filtros.impresora_id);
    }

    if (filtros.empresa_id) {
      query += " AND c.empresa_id = ?";
      params.push(filtros.empresa_id);
    }

    if (filtros.activo !== undefined) {
      query += " AND c.activo = ?";
      params.push(filtros.activo ? 1 : 0);
    }

    if (filtros.fecha) {
      query +=
        " AND c.fecha_inicio <= ? AND (c.fecha_fin IS NULL OR c.fecha_fin >= ?)";
      params.push(filtros.fecha, filtros.fecha);
    }

    query += " ORDER BY c.created_at DESC";
    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  async findById(id) {
    const [rows] = await this.pool.query(
      `SELECT c.*, 
              e.nombre_oficial as empresa_nombre,
              i.serial_number as impresora_serial,
              i.modelo as impresora_modelo
       FROM contratos_impresoras c
       LEFT JOIN empresas e ON c.empresa_id = e.id
       LEFT JOIN impresoras i ON c.impresora_id = i.id
       WHERE c.id = ?`,
      [id],
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
      `SELECT * FROM contratos_impresoras 
       WHERE impresora_id = ? AND activo = 1 
       ORDER BY created_at DESC LIMIT 1`,
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

  async delete(id) {
    const [result] = await this.pool.query(
      "DELETE FROM contratos_impresoras WHERE id = ?",
      [id],
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
