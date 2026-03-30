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
        empresa_id !== undefined ? empresa_id : null,
        precioBn,
        precioC1,
        precioC2,
        precioC3,
        tipo_facturacion || "BN_AND_COLOR",
        activa !== undefined ? activa : 1,
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
        empresa_id !== undefined ? empresa_id : null,
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
      `
      SELECT * FROM contratos_impresoras 
      WHERE impresora_id = ? AND activo = 1 
      LIMIT 1
    `,
      [id],
    );
    return rows[0];
  }

  _toNumber(value, defaultValue = 0) {
    if (value === null || value === undefined) return defaultValue;
    const num = parseFloat(value);
    return isNaN(num) ? defaultValue : num;
  }
}

module.exports = ImpresoraModel;
