const express = require("express");
const router = express.Router();
const { pool } = require("../config/database");

// GET /api/impresoras - Obtener todas las impresoras
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT i.*, e.nombre_oficial as empresa_nombre 
      FROM impresoras i
      LEFT JOIN empresas e ON i.empresa_id = e.id
      ORDER BY i.serial_number
    `);
    res.json(rows);
  } catch (error) {
    console.error("Error en GET /impresoras:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/impresoras/:id - Obtener una impresora por ID
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT i.*, e.nombre_oficial as empresa_nombre 
      FROM impresoras i
      LEFT JOIN empresas e ON i.empresa_id = e.id
      WHERE i.id = ?
    `,
      [req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Impresora no encontrada" });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error("Error en GET /impresoras/:id:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/impresoras - Crear nueva impresora
router.post("/", async (req, res) => {
  const {
    serial_number,
    modelo,
    empresa_id,
    precio_copia_bn,
    precio_copia_color,
    activa,
  } = req.body;

  if (
    !serial_number ||
    precio_copia_bn === undefined ||
    precio_copia_color === undefined
  ) {
    return res.status(400).json({
      error:
        "Faltan campos requeridos: serial_number, precio_copia_bn, precio_copia_color",
    });
  }

  try {
    const [result] = await pool.query(
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

    const [newImpresora] = await pool.query(
      "SELECT * FROM impresoras WHERE id = ?",
      [result.insertId],
    );

    res.status(201).json(newImpresora[0]);
  } catch (error) {
    console.error("Error en POST /impresoras:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({ error: "Ya existe una impresora con ese serial_number" });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/impresoras/:id - Actualizar impresora
router.put("/:id", async (req, res) => {
  const {
    serial_number,
    modelo,
    empresa_id,
    precio_copia_bn,
    precio_copia_color,
    activa,
  } = req.body;

  try {
    const [result] = await pool.query(
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
        req.params.id,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Impresora no encontrada" });
    }

    const [updated] = await pool.query(
      "SELECT * FROM impresoras WHERE id = ?",
      [req.params.id],
    );

    res.json(updated[0]);
  } catch (error) {
    console.error("Error en PUT /impresoras/:id:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/impresoras/:id - Eliminar impresora
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM impresoras WHERE id = ?", [
      req.params.id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Impresora no encontrada" });
    }

    res.json({ message: "Impresora eliminada correctamente" });
  } catch (error) {
    console.error("Error en DELETE /impresoras/:id:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
