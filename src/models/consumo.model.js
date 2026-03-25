class ConsumoModel {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll(filtros = {}) {
    let query = `
      SELECT c.*, i.serial_number, i.modelo, e.nombre_oficial,
             i.tipo_facturacion, i.precio_copia_bn, i.precio_copia_color1, 
             i.precio_copia_color2, i.precio_copia_color3
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

  async findById(id) {
    const [rows] = await this.pool.query(
      "SELECT * FROM consumos_mensuales WHERE id = ?",
      [id],
    );
    return rows[0];
  }

  async findByImpresoraYPeriodo(impresora_id, periodo) {
    const [rows] = await this.pool.query(
      "SELECT * FROM consumos_mensuales WHERE impresora_id = ? AND periodo = ?",
      [impresora_id, periodo],
    );
    return rows[0];
  }

  async upsert(consumoData) {
    const {
      impresora_id,
      periodo,
      copias_bn_mes,
      copias_color1_mes,
      copias_color2_mes,
      copias_color3_mes,
      importe_bn,
      importe_color1,
      importe_color2,
      importe_color3,
      total_facturar,
      contador_bn_inicio,
      contador_bn_fin,
      contador_color1_inicio,
      contador_color1_fin,
      contador_color2_inicio,
      contador_color2_fin,
      contador_color3_inicio,
      contador_color3_fin,
    } = consumoData;

    const [result] = await this.pool.query(
      `
      INSERT INTO consumos_mensuales 
      (impresora_id, periodo, 
       copias_bn_mes, copias_color1_mes, copias_color2_mes, copias_color3_mes,
       importe_bn, importe_color1, importe_color2, importe_color3, total_facturar,
       contador_bn_inicio, contador_bn_fin,
       contador_color1_inicio, contador_color1_fin,
       contador_color2_inicio, contador_color2_fin,
       contador_color3_inicio, contador_color3_fin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        copias_bn_mes = VALUES(copias_bn_mes),
        copias_color1_mes = VALUES(copias_color1_mes),
        copias_color2_mes = VALUES(copias_color2_mes),
        copias_color3_mes = VALUES(copias_color3_mes),
        importe_bn = VALUES(importe_bn),
        importe_color1 = VALUES(importe_color1),
        importe_color2 = VALUES(importe_color2),
        importe_color3 = VALUES(importe_color3),
        total_facturar = VALUES(total_facturar),
        contador_bn_inicio = VALUES(contador_bn_inicio),
        contador_bn_fin = VALUES(contador_bn_fin),
        contador_color1_inicio = VALUES(contador_color1_inicio),
        contador_color1_fin = VALUES(contador_color1_fin),
        contador_color2_inicio = VALUES(contador_color2_inicio),
        contador_color2_fin = VALUES(contador_color2_fin),
        contador_color3_inicio = VALUES(contador_color3_inicio),
        contador_color3_fin = VALUES(contador_color3_fin)
    `,
      [
        impresora_id,
        periodo,
        copias_bn_mes,
        copias_color1_mes,
        copias_color2_mes,
        copias_color3_mes,
        importe_bn,
        importe_color1,
        importe_color2,
        importe_color3,
        total_facturar,
        contador_bn_inicio,
        contador_bn_fin,
        contador_color1_inicio,
        contador_color1_fin,
        contador_color2_inicio,
        contador_color2_fin,
        contador_color3_inicio,
        contador_color3_fin,
      ],
    );

    return this.findByImpresoraYPeriodo(impresora_id, periodo);
  }

  async marcarFacturado(id) {
    await this.pool.query(
      "UPDATE consumos_mensuales SET facturado = 1 WHERE id = ?",
      [id],
    );
    return this.findById(id);
  }

  async getResumenFacturacion(periodo = null) {
    let query = `
      SELECT 
        SUM(CASE WHEN facturado = 0 THEN total_facturar ELSE 0 END) as pendiente,
        SUM(CASE WHEN facturado = 1 THEN total_facturar ELSE 0 END) as facturado,
        COUNT(DISTINCT impresora_id) as impresoras_con_consumo,
        SUM(copias_bn_mes) as total_bn,
        SUM(copias_color1_mes) as total_color1,
        SUM(copias_color2_mes) as total_color2,
        SUM(copias_color3_mes) as total_color3
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

  async calcularConsumosPeriodo(periodo, impresoras, connection) {
    const conn = connection || this.pool;
    const [year, month] = periodo.split("-").map(Number);

    const fechaInicio = new Date(year, month - 1, 1);
    const fechaFin = new Date(year, month, 0);

    const resultados = [];

    for (const impresora of impresoras) {
      const [registros] = await conn.query(
        `
        SELECT 
          MIN(copias_bn_total) as bn_inicio,
          MAX(copias_bn_total) as bn_fin,
          MIN(copias_color1_total) as color1_inicio,
          MAX(copias_color1_total) as color1_fin,
          MIN(copias_color2_total) as color2_inicio,
          MAX(copias_color2_total) as color2_fin,
          MIN(copias_color3_total) as color3_inicio,
          MAX(copias_color3_total) as color3_fin
        FROM registros_contadores 
        WHERE impresora_id = ? 
          AND fecha_lectura BETWEEN ? AND ?
      `,
        [impresora.id, fechaInicio, fechaFin],
      );

      if (registros.length > 0 && registros[0].bn_inicio !== null) {
        // Calcular copias del período
        const bnMes = registros[0].bn_fin - registros[0].bn_inicio;
        const color1Mes = registros[0].color1_fin - registros[0].color1_inicio;
        const color2Mes = registros[0].color2_fin - registros[0].color2_inicio;
        const color3Mes = registros[0].color3_fin - registros[0].color3_inicio;

        // Obtener contrato activo
        const [contratos] = await conn.query(
          "SELECT * FROM contratos_impresoras WHERE impresora_id = ? AND activo = 1 LIMIT 1",
          [impresora.id],
        );

        // Calcular importes según tipo de facturación
        let importeBn = 0;
        let importeColor1 = 0;
        let importeColor2 = 0;
        let importeColor3 = 0;
        let totalFacturar = 0;

        const tipoFacturacion = impresora.tipo_facturacion || "BN_AND_COLOR";

        if (
          tipoFacturacion === "BN_ONLY" ||
          tipoFacturacion === "BN_AND_COLOR" ||
          tipoFacturacion === "MULTICOLOR"
        ) {
          importeBn = bnMes * (impresora.precio_copia_bn || 0);
        }

        if (
          tipoFacturacion === "COLOR_ONLY" ||
          tipoFacturacion === "BN_AND_COLOR"
        ) {
          importeColor1 = color1Mes * (impresora.precio_copia_color1 || 0);
        }

        if (tipoFacturacion === "MULTICOLOR") {
          importeColor2 = color2Mes * (impresora.precio_copia_color2 || 0);
          importeColor3 = color3Mes * (impresora.precio_copia_color3 || 0);
        }

        totalFacturar =
          importeBn + importeColor1 + importeColor2 + importeColor3;

        // Aplicar contrato si existe
        if (contratos.length > 0) {
          const contrato = contratos[0];

          if (
            tipoFacturacion === "BN_ONLY" ||
            tipoFacturacion === "BN_AND_COLOR" ||
            tipoFacturacion === "MULTICOLOR"
          ) {
            const bnFacturable = Math.max(
              0,
              bnMes - (contrato.copias_bn_incluidas || 0),
            );
            importeBn = bnFacturable * (impresora.precio_copia_bn || 0);
          }

          if (
            tipoFacturacion === "COLOR_ONLY" ||
            tipoFacturacion === "BN_AND_COLOR"
          ) {
            const color1Facturable = Math.max(
              0,
              color1Mes - (contrato.copias_color1_incluidas || 0),
            );
            importeColor1 =
              color1Facturable * (impresora.precio_copia_color1 || 0);
          }

          if (tipoFacturacion === "MULTICOLOR") {
            const color2Facturable = Math.max(
              0,
              color2Mes - (contrato.copias_color2_incluidas || 0),
            );
            const color3Facturable = Math.max(
              0,
              color3Mes - (contrato.copias_color3_incluidas || 0),
            );
            importeColor2 =
              color2Facturable * (impresora.precio_copia_color2 || 0);
            importeColor3 =
              color3Facturable * (impresora.precio_copia_color3 || 0);
          }

          totalFacturar = Math.max(
            contrato.precio_minimo || 0,
            importeBn + importeColor1 + importeColor2 + importeColor3,
          );
        }

        resultados.push({
          impresora_id: impresora.id,
          periodo,
          copias_bn_mes: bnMes,
          copias_color1_mes: color1Mes,
          copias_color2_mes: color2Mes,
          copias_color3_mes: color3Mes,
          importe_bn: importeBn,
          importe_color1: importeColor1,
          importe_color2: importeColor2,
          importe_color3: importeColor3,
          total_facturar: totalFacturar,
          contador_bn_inicio: registros[0].bn_inicio,
          contador_bn_fin: registros[0].bn_fin,
          contador_color1_inicio: registros[0].color1_inicio,
          contador_color1_fin: registros[0].color1_fin,
          contador_color2_inicio: registros[0].color2_inicio,
          contador_color2_fin: registros[0].color2_fin,
          contador_color3_inicio: registros[0].color3_inicio,
          contador_color3_fin: registros[0].color3_fin,
        });
      }
    }

    return resultados;
  }
}

module.exports = ConsumoModel;
