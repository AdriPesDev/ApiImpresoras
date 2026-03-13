const express = require("express");
const router = express.Router();
const { pool } = require("../config/database");

// GET /api/consumos - Obtener consumos mensuales
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, i.serial_number, i.modelo, e.nombre_oficial 
      FROM consumos_mensuales c
      JOIN impresoras i ON c.impresora_id = i.id
      LEFT JOIN empresas e ON i.empresa_id = e.id
      ORDER BY c.periodo DESC, e.nombre_oficial
    `);
    res.json(rows);
  } catch (error) {
    console.error("Error en GET /consumos:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/consumos/pendientes - Consumos no facturados
router.get("/pendientes", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, i.serial_number, i.modelo, e.nombre_oficial 
      FROM consumos_mensuales c
      JOIN impresoras i ON c.impresora_id = i.id
      LEFT JOIN empresas e ON i.empresa_id = e.id
      WHERE c.facturado = 0
      ORDER BY c.periodo ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error("Error en GET /consumos/pendientes:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/consumos/:id/facturar - Marcar como facturado
router.put("/:id/facturar", async (req, res) => {
  try {
    const [result] = await pool.query(
      "UPDATE consumos_mensuales SET facturado = 1 WHERE id = ?",
      [req.params.id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Consumo no encontrado" });
    }

    res.json({ message: "Consumo marcado como facturado" });
  } catch (error) {
    console.error("Error en PUT /consumos/:id/facturar:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/consumos/calcular/:periodo - Calcular consumos para un período
router.post("/calcular/:periodo", async (req, res) => {
  const periodo = req.params.periodo;
  const [year, month] = periodo.split("-").map(Number);

  const fechaInicio = new Date(year, month - 1, 1);
  const fechaFin = new Date(year, month, 0);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Obtener todas las impresoras activas
    const [impresoras] = await connection.query(
      "SELECT * FROM impresoras WHERE activa = 1",
    );

    let calculados = 0;

    for (const impresora of impresoras) {
      // Obtener primer y último registro del período
      const [registros] = await connection.query(
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
        const [contratos] = await connection.query(
          "SELECT * FROM contratos_impresoras WHERE impresora_id = ? AND activo = 1 LIMIT 1",
          [impresora.id],
        );

        let importeBn = bnMes * impresora.precio_copia_bn;
        let importeColor = colorMes * impresora.precio_copia_color;
        let totalFacturar = importeBn + importeColor;

        // Aplicar contrato si existe
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

        // Insertar o actualizar consumo mensual
        await connection.query(
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
            impresora.id,
            periodo,
            bnMes,
            colorMes,
            importeBn,
            importeColor,
            totalFacturar,
            registros[0].bn_inicio,
            registros[0].bn_fin,
            registros[0].color_inicio,
            registros[0].color_fin,
          ],
        );

        calculados++;
      }
    }

    await connection.commit();
    res.json({
      message: `Consumos calculados para ${periodo}`,
      calculados: calculados,
      total: impresoras.length,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error en POST /consumos/calcular/:periodo:", error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
