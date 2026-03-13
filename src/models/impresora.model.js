class ImpresoraModel {
  constructor(pool) {
    this.pool = pool;
  }

  // Obtener todas las impresoras
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

  // Obtener impresora por ID
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

  // Obtener impresora por serial number
  async findBySerial(serialNumber) {
    const [rows] = await this.pool.query(
      "SELECT * FROM impresoras WHERE serial_number = ?",
      [serialNumber],
    );
    return rows[0];
  }

  // Crear impresora
  async create(impresoraData) {
    const {
      serial_number,
      modelo,
      empresa_id,
      precio_copia_bn,
      precio_copia_color,
      activa,
    } = impresoraData;

    const [result] = await this.pool.query(
      `INSERT INTO impresoras 
       (serial_number, modelo, empresa_id, precio_copia_bn, precio_copia_color, activa) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        serial_number,
        modelo || null,
        empresa_id || null,
        precio_copia_bn,
        precio_copia_color,
        activa !== undefined ? activa : 1,
      ],
    );

    return this.findById(result.insertId);
  }

  // Actualizar impresora
  async update(id, impresoraData) {
    const {
      serial_number,
      modelo,
      empresa_id,
      precio_copia_bn,
      precio_copia_color,
      activa,
    } = impresoraData;

    await this.pool.query(
      `UPDATE impresoras SET 
       serial_number = ?, modelo = ?, empresa_id = ?, 
       precio_copia_bn = ?, precio_copia_color = ?, activa = ? 
       WHERE id = ?`,
      [
        serial_number,
        modelo,
        empresa_id,
        precio_copia_bn,
        precio_copia_color,
        activa,
        id,
      ],
    );

    return this.findById(id);
  }

  // Eliminar impresora
  async delete(id) {
    const [result] = await this.pool.query(
      "DELETE FROM impresoras WHERE id = ?",
      [id],
    );
    return result.affectedRows > 0;
  }

  // Obtener últimos registros de contador
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

  // Obtener contrato activo
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
}

module.exports = ImpresoraModel;
