function formatMySQLDate(date) {
  if (!date) return null;
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

class RegistroModel {
  constructor(pool) {
    this.pool = pool;
  }

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

  async findById(id) {
    const [rows] = await this.pool.query(
      "SELECT * FROM registros_contadores WHERE id = ?",
      [id],
    );
    return rows[0];
  }

  async create(registroData) {
    const {
      impresora_id,
      copias_bn_total,
      copias_color1_total,
      copias_color2_total,
      copias_color3_total,
      copias_color_total, // legacy
      fecha_lectura,
    } = registroData;

    // Usar color1 si viene color_total legacy
    const finalColor1 =
      copias_color1_total !== undefined
        ? copias_color1_total
        : copias_color_total || 0;

    // Formatear fecha
    const fechaFormateada = formatMySQLDate(fecha_lectura || new Date());

    const [result] = await this.pool.query(
      `INSERT INTO registros_contadores 
     (impresora_id, copias_bn_total, copias_color1_total, copias_color2_total, copias_color3_total, fecha_lectura) 
     VALUES (?, ?, ?, ?, ?, ?)`,
      [
        impresora_id,
        copias_bn_total || 0,
        finalColor1,
        copias_color2_total || 0,
        copias_color3_total || 0,
        fechaFormateada,
      ],
    );

    return this.findById(result.insertId);
  }

  async createBulk(registros) {
    if (!registros.length) return { count: 0 };

    const values = registros.map((r) => {
      // Normalizar campos de color
      const color1 =
        r.copias_color1_total !== undefined
          ? r.copias_color1_total
          : r.copias_color_total || 0;
      // Formatear fecha
      const fechaFormateada = formatMySQLDate(r.fecha_lectura || new Date());

      return [
        r.impresora_id,
        r.copias_bn_total || 0,
        color1,
        r.copias_color2_total || 0,
        r.copias_color3_total || 0,
        fechaFormateada,
      ];
    });

    const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?)").join(",");
    const flatValues = values.flat();

    const [result] = await this.pool.query(
      `INSERT INTO registros_contadores 
     (impresora_id, copias_bn_total, copias_color1_total, copias_color2_total, copias_color3_total, fecha_lectura) 
     VALUES ${placeholders}`,
      flatValues,
    );

    return { count: result.affectedRows };
  }

  async createBulk(registros) {
    if (!registros.length) return { count: 0 };

    const values = registros.map((r) => {
      // Normalizar campos de color
      const color1 =
        r.copias_color1_total !== undefined
          ? r.copias_color1_total
          : r.copias_color_total || 0;
      return [
        r.impresora_id,
        r.copias_bn_total || 0,
        color1,
        r.copias_color2_total || 0,
        r.copias_color3_total || 0,
        r.fecha_lectura || new Date(),
      ];
    });

    const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?)").join(",");
    const flatValues = values.flat();

    const [result] = await this.pool.query(
      `INSERT INTO registros_contadores 
     (impresora_id, copias_bn_total, copias_color1_total, copias_color2_total, copias_color3_total, fecha_lectura) 
     VALUES ${placeholders}`,
      flatValues,
    );

    return { count: result.affectedRows };
  }

  async getStats(impresora_id = null, periodo = null) {
    let query = `
      SELECT 
        COUNT(*) as total_lecturas,
        AVG(copias_bn_total + copias_color1_total + copias_color2_total + copias_color3_total) as promedio_copias,
        MAX(copias_bn_total + copias_color1_total + copias_color2_total + copias_color3_total) as max_copias,
        MIN(copias_bn_total + copias_color1_total + copias_color2_total + copias_color3_total) as min_copias,
        SUM(copias_bn_total) as total_bn,
        SUM(copias_color1_total) as total_color1,
        SUM(copias_color2_total) as total_color2,
        SUM(copias_color3_total) as total_color3
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

  async getLecturasPorMes(impresora_id = null, year = null) {
    let query = `
      SELECT 
        DATE_FORMAT(fecha_lectura, '%Y-%m') as mes,
        COUNT(*) as total_lecturas,
        SUM(copias_bn_total) as total_bn,
        SUM(copias_color1_total) as total_color1,
        SUM(copias_color2_total) as total_color2,
        SUM(copias_color3_total) as total_color3
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
