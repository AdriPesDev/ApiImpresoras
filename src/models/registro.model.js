class RegistroModel {
  constructor(pool) {
    this.pool = pool;
  }

  // Obtener registros con filtros
  async findAll(filtros = {}) {
    let query = `
      SELECT r.*, i.serial_number, i.modelo, e.nombre_oficial as empresa_nombre
      FROM registros_contadores r
      JOIN impresoras i ON r.impresora_id = i.id
      LEFT JOIN empresas e ON i.empresa_id = e.id
      WHERE 1=1
    `;
    const params = [];

    if (filtros.impresora_id) {
      query += " AND r.impresora_id = ?";
      params.push(filtros.impresora_id);
    }

    if (filtros.desde) {
      query += " AND r.fecha_lectura >= ?";
      params.push(filtros.desde);
    }

    if (filtros.hasta) {
      query += " AND r.fecha_lectura <= ?";
      params.push(filtros.hasta);
    }

    query += " ORDER BY r.fecha_lectura DESC";

    if (filtros.limite) {
      query += " LIMIT ?";
      params.push(filtros.limite);
    }

    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  // Obtener registro por ID
  async findById(id) {
    const [rows] = await this.pool.query(
      "SELECT * FROM registros_contadores WHERE id = ?",
      [id],
    );
    return rows[0];
  }

  // Crear registro
  async create(registroData) {
    const { impresora_id, copias_bn_total, copias_color_total, fecha_lectura } =
      registroData;

    const [result] = await this.pool.query(
      `INSERT INTO registros_contadores 
       (impresora_id, copias_bn_total, copias_color_total, fecha_lectura) 
       VALUES (?, ?, ?, ?)`,
      [
        impresora_id,
        copias_bn_total,
        copias_color_total,
        fecha_lectura || new Date(),
      ],
    );

    return this.findById(result.insertId);
  }

  // Crear múltiples registros (bulk insert)
  async createBulk(registros) {
    if (!registros.length) return { count: 0 };

    const values = registros.map((r) => [
      r.impresora_id,
      r.copias_bn_total,
      r.copias_color_total,
      r.fecha_lectura || new Date(),
    ]);

    const placeholders = values.map(() => "(?, ?, ?, ?)").join(",");
    const flatValues = values.flat();

    const [result] = await this.pool.query(
      `INSERT INTO registros_contadores 
       (impresora_id, copias_bn_total, copias_color_total, fecha_lectura) 
       VALUES ${placeholders}`,
      flatValues,
    );

    return { count: result.affectedRows };
  }

  // Obtener estadísticas de lecturas
  async getStats(impresora_id = null, periodo = null) {
    let query = `
      SELECT 
        COUNT(*) as total_lecturas,
        AVG(copias_bn_total + copias_color_total) as promedio_copias,
        MAX(copias_bn_total + copias_color_total) as max_copias,
        MIN(copias_bn_total + copias_color_total) as min_copias,
        SUM(copias_bn_total) as total_bn,
        SUM(copias_color_total) as total_color
      FROM registros_contadores
      WHERE 1=1
    `;
    const params = [];

    if (impresora_id) {
      query += " AND impresora_id = ?";
      params.push(impresora_id);
    }

    if (periodo) {
      query += ' AND DATE_FORMAT(fecha_lectura, "%Y-%m") = ?';
      params.push(periodo);
    }

    const [rows] = await this.pool.query(query, params);
    return rows[0];
  }

  // Obtener lecturas agrupadas por mes
  async getLecturasPorMes(impresora_id = null, year = null) {
    let query = `
      SELECT 
        DATE_FORMAT(fecha_lectura, '%Y-%m') as mes,
        COUNT(*) as total_lecturas,
        SUM(copias_bn_total) as total_bn,
        SUM(copias_color_total) as total_color
      FROM registros_contadores
      WHERE 1=1
    `;
    const params = [];

    if (impresora_id) {
      query += " AND impresora_id = ?";
      params.push(impresora_id);
    }

    if (year) {
      query += " AND YEAR(fecha_lectura) = ?";
      params.push(year);
    }

    query += ' GROUP BY DATE_FORMAT(fecha_lectura, "%Y-%m") ORDER BY mes DESC';

    const [rows] = await this.pool.query(query, params);
    return rows;
  }
}

module.exports = RegistroModel;
