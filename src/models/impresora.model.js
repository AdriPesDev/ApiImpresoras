class ImpresoraModel {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll(filtros = {}) {
    let query = `
      SELECT i.*, e.nombre_oficial as empresa_nombre 
      FROM impresoras i
      LEFT JOIN empresas e ON i.empresa_id = e.id
      WHERE 1=1
    `;
    const params = [];

    if (filtros.activa !== undefined) {
      query += " AND i.activa = ?";
      params.push(filtros.activa);
    }

    if (filtros.empresa_id) {
      query += " AND i.empresa_id = ?";
      params.push(filtros.empresa_id);
    }

    if (filtros.modelo) {
      query += " AND i.modelo LIKE ?";
      params.push(`%${filtros.modelo}%`);
    }

    if (filtros.buscar) {
      query += " AND (i.serial_number LIKE ? OR i.modelo LIKE ? OR e.nombre_oficial LIKE ?)";
      params.push(`%${filtros.buscar}%`, `%${filtros.buscar}%`, `%${filtros.buscar}%`);
    }

    query += " ORDER BY i.serial_number";

    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  async findById(id) {
    const [rows] = await this.pool.query(
      `
      SELECT i.*, e.nombre_oficial as empresa_nombre 
      FROM impresoras i
      LEFT JOIN empresas e ON i.empresa_id = e.id
      WHERE i.id = ?
    `,
      [id],
    );
    return rows[0];
  }

  async findBySerial(serialNumber) {
    const [rows] = await this.pool.query(
      "SELECT * FROM impresoras WHERE serial_number = ?",
      [serialNumber],
    );
    return rows[0];
  }

  async create(impresoraData) {
    const {
      serial_number,
      modelo,
      empresa_id,
      precio_copia_bn,
      precio_copia_color1,
      precio_copia_color2,
      precio_copia_color3,
      tipo_facturacion,
      activa,
    } = impresoraData;

    const precioBn = this._toNumber(precio_copia_bn, 0.01);
    const precioC1 = this._toNumber(precio_copia_color1, 0.03);
    const precioC2 = this._toNumber(precio_copia_color2, 0.05);
    const precioC3 = this._toNumber(precio_copia_color3, 0.07);

    const [result] = await this.pool.query(
      `INSERT INTO impresoras 
       (serial_number, modelo, empresa_id, 
        precio_copia_bn, precio_copia_color1, precio_copia_color2, precio_copia_color3,
        tipo_facturacion, activa) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        serial_number,
        modelo || null,
        empresa_id === undefined ? null : empresa_id,
        precioBn,
        precioC1,
        precioC2,
        precioC3,
        tipo_facturacion || "BN_AND_COLOR",
        activa === undefined ? 1 : activa,
      ],
    );

    return this.findById(result.insertId);
  }

  async update(id, impresoraData) {
    const {
      serial_number,
      modelo,
      empresa_id,
      precio_copia_bn,
      precio_copia_color1,
      precio_copia_color2,
      precio_copia_color3,
      tipo_facturacion,
      activa,
    } = impresoraData;

    const precioBn = this._toNumber(precio_copia_bn);
    const precioC1 = this._toNumber(precio_copia_color1);
    const precioC2 = this._toNumber(precio_copia_color2);
    const precioC3 = this._toNumber(precio_copia_color3);

    await this.pool.query(
      `UPDATE impresoras SET 
       serial_number = ?, modelo = ?, empresa_id = ?, 
       precio_copia_bn = ?, precio_copia_color1 = ?, precio_copia_color2 = ?, precio_copia_color3 = ?,
       tipo_facturacion = ?, activa = ? 
       WHERE id = ?`,
      [
        serial_number,
        modelo,
        empresa_id === undefined ? null : empresa_id,
        precioBn,
        precioC1,
        precioC2,
        precioC3,
        tipo_facturacion,
        activa,
        id,
      ],
    );

    return this.findById(id);
  }

  async delete(id) {
    const [result] = await this.pool.query(
      "DELETE FROM impresoras WHERE id = ?",
      [id],
    );
    return result.affectedRows > 0;
  }

  async getUltimosRegistros(id, limite = 10) {
    const [rows] = await this.pool.query(
      `
      SELECT * FROM registros_contadores 
      WHERE impresora_id = ? 
      ORDER BY fecha_lectura DESC 
      LIMIT ?
    `,
      [id, limite],
    );
    return rows;
  }

  async getContratoActivo(id) {
    const [rows] = await this.pool.query(
      `SELECT c.*, ci.precio_bn, ci.precio_color1, ci.precio_color2, ci.precio_color3,
              ci.copias_bn_incluidas, ci.copias_c1_incluidas,
              ci.copias_c2_incluidas, ci.copias_c3_incluidas,
              ci.precio_minimo_mensual
       FROM contrato_impresoras ci
       INNER JOIN contratos c ON c.id = ci.contrato_id
       WHERE ci.impresora_id = ?
         AND ci.activo = TRUE
         AND c.activo = TRUE
         AND c.fecha_inicio <= CURDATE()
         AND (c.fecha_fin IS NULL OR c.fecha_fin >= CURDATE())
       ORDER BY c.fecha_inicio DESC
       LIMIT 1`,
      [id],
    );
    return rows[0];
  }

  _toNumber(value, defaultValue = 0) {
    if (value === null || value === undefined) return defaultValue;
    const num = Number.parseFloat(value);
    return Number.isNaN(num) ? defaultValue : num;
  }
}

module.exports = ImpresoraModel;
