const express = require("express");
const router = express.Router();
const { pool } = require("../config/database");

// GET /api/dashboard/stats - Estadísticas para el dashboard
router.get("/stats", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM empresas WHERE activo = 1) as empresas_activas,
        (SELECT COUNT(*) FROM empresas) as total_empresas,
        (SELECT COUNT(*) FROM impresoras WHERE activa = 1) as impresoras_activas,
        (SELECT COUNT(*) FROM impresoras) as total_impresoras,
        (SELECT COUNT(*) FROM registros_contadores WHERE fecha_lectura >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as lecturas_30dias,
        (SELECT SUM(total_facturar) FROM consumos_mensuales WHERE facturado = 0) as pendiente_facturar,
        (SELECT SUM(total_facturar) FROM consumos_mensuales 
         WHERE periodo = DATE_FORMAT(NOW(), '%Y-%m') AND facturado = 1) as facturado_mes,
        (SELECT SUM(copias_bn_mes + copias_color_mes) FROM consumos_mensuales 
         WHERE periodo = DATE_FORMAT(NOW(), '%Y-%m')) as copias_mes
    `);

    res.json(
      rows[0] || {
        empresas_activas: 0,
        total_empresas: 0,
        impresoras_activas: 0,
        total_impresoras: 0,
        lecturas_30dias: 0,
        pendiente_facturar: 0,
        facturado_mes: 0,
        copias_mes: 0,
      },
    );
  } catch (error) {
    console.error("Error en GET /dashboard/stats:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/dashboard/actividad-reciente - Actividad reciente para el dashboard
router.get("/actividad-reciente", async (req, res) => {
  try {
    const [registros] = await pool.query(`
      SELECT 
        CONCAT('Nueva lectura: ', i.serial_number) as descripcion,
        DATE_FORMAT(r.fecha_lectura, '%d/%m/%Y %H:%i') as fecha,
        CONCAT(r.copias_bn_total + r.copias_color_total, ' copias') as valor
      FROM registros_contadores r
      JOIN impresoras i ON r.impresora_id = i.id
      ORDER BY r.fecha_lectura DESC
      LIMIT 5
    `);

    const [facturas] = await pool.query(`
      SELECT 
        CONCAT('Factura generada: ', e.nombre_oficial) as descripcion,
        DATE_FORMAT(c.created_at, '%d/%m/%Y') as fecha,
        CONCAT(ROUND(c.total_facturar, 2), ' €') as valor
      FROM consumos_mensuales c
      JOIN impresoras i ON c.impresora_id = i.id
      JOIN empresas e ON i.empresa_id = e.id
      WHERE c.facturado = 1
      ORDER BY c.created_at DESC
      LIMIT 3
    `);

    const actividad = [...registros, ...facturas]
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, 10);

    res.json(actividad);
  } catch (error) {
    console.error("Error en GET /dashboard/actividad-reciente:", error);
    res.json([]); // Devolver array vacío en caso de error
  }
});

module.exports = router;
