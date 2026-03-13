const express = require("express");
const router = express.Router();
const { pool } = require("../config/database");

// GET /api/registros - Obtener registros recientes
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.*, i.serial_number, i.modelo, e.nombre_oficial as empresa_nombre
      FROM registros_contadores r
      JOIN impresoras i ON r.impresora_id = i.id
      LEFT JOIN empresas e ON i.empresa_id = e.id
      ORDER BY r.fecha_lectura DESC
      LIMIT 1000
    `);
    res.json(rows);
  } catch (error) {
    console.error("Error en GET /registros:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/registros/impresora/:impresoraId - Registros por impresora
router.get("/impresora/:impresoraId", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM registros_contadores WHERE impresora_id = ? ORDER BY fecha_lectura DESC",
      [req.params.impresoraId],
    );
    res.json(rows);
  } catch (error) {
    console.error("Error en GET /registros/impresora/:id:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/registros - Crear un registro
router.post("/", async (req, res) => {
  const { impresora_id, copias_bn_total, copias_color_total, fecha_lectura } =
    req.body;

  if (
    !impresora_id ||
    copias_bn_total === undefined ||
    copias_color_total === undefined
  ) {
    return res.status(400).json({ error: "Faltan campos requeridos" });
  }

  try {
    const [result] = await pool.query(
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

    res.status(201).json({
      id: result.insertId,
      message: "Registro creado correctamente",
    });
  } catch (error) {
    console.error("Error en POST /registros:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/registros/bulk - Crear múltiples registros (para CSV)
router.post("/bulk", async (req, res) => {
  const registros = req.body;

  if (!Array.isArray(registros) || registros.length === 0) {
    return res.status(400).json({ error: "Se requiere un array de registros" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (const registro of registros) {
      await connection.query(
        `INSERT INTO registros_contadores 
         (impresora_id, copias_bn_total, copias_color_total, fecha_lectura) 
         VALUES (?, ?, ?, ?)`,
        [
          registro.impresora_id,
          registro.copias_bn_total,
          registro.copias_color_total,
          registro.fecha_lectura,
        ],
      );
    }

    await connection.commit();
    res.status(201).json({
      message: `${registros.length} registros creados correctamente`,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error en POST /registros/bulk:", error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
