class ConsumoModel {
  constructor(pool) {
    this.pool = pool;
  }

  // Obtener consumos con filtros
  async findAll(filtros = {}) {
    let query = `
      SELECT c.*, i.serial_number, i.modelo, e.nombre_oficial 
      FROM consumos_mensuales c
      JOIN impresoras i ON c.impresora_id = i.id
      LEFT JOIN empresas e ON i.empresa_id = e.id
      WHERE 1=1
    `;
    const params = [];

    if (filtros.periodo) {
      query += " AND c.periodo = ?";
      params.push(filtros.periodo);
    }

    if (filtros.impresora_id) {
      query += " AND c.impresora_id = ?";
      params.push(filtros.impresora_id);
    }

    if (filtros.facturado !== undefined) {
      query += " AND c.facturado = ?";
      params.push(filtros.facturado);
    }

    query += " ORDER BY c.periodo DESC, e.nombre_oficial";

    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  // Obtener consumo por ID
  async findById(id) {
    const [rows] = await this.pool.query(
      "SELECT * FROM consumos_mensuales WHERE id = ?",
      [id],
    );
    return rows[0];
  }

  // Obtener consumo por impresora y período
  async findByImpresoraYPeriodo(impresora_id, periodo) {
    const [rows] = await this.pool.query(
      "SELECT * FROM consumos_mensuales WHERE impresora_id = ? AND periodo = ?",
      [impresora_id, periodo],
    );
    return rows[0];
  }

  // Crear o actualizar consumo
  async upsert(consumoData) {
    const {
      impresora_id,
      periodo,
      copias_bn_mes,
      copias_color_mes,
      importe_bn,
      importe_color,
      total_facturar,
      contador_bn_inicio,
      contador_bn_fin,
      contador_color_inicio,
      contador_color_fin,
    } = consumoData;

    const [result] = await this.pool.query(
      `
      INSERT INTO consumos_mensuales 
      (impresora_id, periodo, copias_bn_mes, copias_color_mes, 
       importe_bn, importe_color, total_facturar,
       contador_bn_inicio, contador_bn_fin, contador_color_inicio, contador_color_fin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        copias_bn_mes = VALUES(copias_bn_mes),
        copias_color_mes = VALUES(copias_color_mes),
        importe_bn = VALUES(importe_bn),
        importe_color = VALUES(importe_color),
        total_facturar = VALUES(total_facturar),
        contador_bn_inicio = VALUES(contador_bn_inicio),
        contador_bn_fin = VALUES(contador_bn_fin),
        contador_color_inicio = VALUES(contador_color_inicio),
        contador_color_fin = VALUES(contador_color_fin)
    `,
      [
        impresora_id,
        periodo,
        copias_bn_mes,
        copias_color_mes,
        importe_bn,
        importe_color,
        total_facturar,
        contador_bn_inicio,
        contador_bn_fin,
        contador_color_inicio,
        contador_color_fin,
      ],
    );

    return this.findByImpresoraYPeriodo(impresora_id, periodo);
  }

  // Marcar como facturado
  async marcarFacturado(id) {
    await this.pool.query(
      "UPDATE consumos_mensuales SET facturado = 1 WHERE id = ?",
      [id],
    );
    return this.findById(id);
  }

  // Obtener resumen de facturación
  async getResumenFacturacion(periodo = null) {
    let query = `
      SELECT 
        SUM(CASE WHEN facturado = 0 THEN total_facturar ELSE 0 END) as pendiente,
        SUM(CASE WHEN facturado = 1 THEN total_facturar ELSE 0 END) as facturado,
        COUNT(DISTINCT impresora_id) as impresoras_con_consumo,
        SUM(copias_bn_mes) as total_bn,
        SUM(copias_color_mes) as total_color
      FROM consumos_mensuales
    `;
    const params = [];

    if (periodo) {
      query += " WHERE periodo = ?";
      params.push(periodo);
    }

    const [rows] = await this.pool.query(query, params);
    return rows[0];
  }

  // Calcular consumos para un período
  async calcularConsumosPeriodo(periodo, impresoras, connection) {
    const conn = connection || this.pool;
    const [year, month] = periodo.split("-").map(Number);

    const fechaInicio = new Date(year, month - 1, 1);
    const fechaFin = new Date(year, month, 0);

    const resultados = [];

    for (const impresora of impresoras) {
      // Obtener primer y último registro del período
      const [registros] = await conn.query(
        `
        SELECT 
          MIN(copias_bn_total) as bn_inicio,
          MAX(copias_bn_total) as bn_fin,
          MIN(copias_color_total) as color_inicio,
          MAX(copias_color_total) as color_fin
        FROM registros_contadores 
        WHERE impresora_id = ? 
          AND fecha_lectura BETWEEN ? AND ?
      `,
        [impresora.id, fechaInicio, fechaFin],
      );

      if (registros.length > 0 && registros[0].bn_inicio !== null) {
        const bnMes = registros[0].bn_fin - registros[0].bn_inicio;
        const colorMes = registros[0].color_fin - registros[0].color_inicio;

        // Obtener contrato activo
        const [contratos] = await conn.query(
          "SELECT * FROM contratos_impresoras WHERE impresora_id = ? AND activo = 1 LIMIT 1",
          [impresora.id],
        );

        let importeBn = bnMes * impresora.precio_copia_bn;
        let importeColor = colorMes * impresora.precio_copia_color;
        let totalFacturar = importeBn + importeColor;

        if (contratos.length > 0) {
          const contrato = contratos[0];
          const bnFacturable = Math.max(
            0,
            bnMes - contrato.copias_bn_incluidas,
          );
          const colorFacturable = Math.max(
            0,
            colorMes - contrato.copias_color_incluidas,
          );

          importeBn = bnFacturable * impresora.precio_copia_bn;
          importeColor = colorFacturable * impresora.precio_copia_color;
          totalFacturar = Math.max(
            contrato.precio_minimo,
            importeBn + importeColor,
          );
        }

        resultados.push({
          impresora_id: impresora.id,
          periodo,
          copias_bn_mes: bnMes,
          copias_color_mes: colorMes,
          importe_bn: importeBn,
          importe_color: importeColor,
          total_facturar: totalFacturar,
          contador_bn_inicio: registros[0].bn_inicio,
          contador_bn_fin: registros[0].bn_fin,
          contador_color_inicio: registros[0].color_inicio,
          contador_color_fin: registros[0].color_fin,
        });
      }
    }

    return resultados;
  }
}

module.exports = ConsumoModel;
