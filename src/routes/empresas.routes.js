const express = require("express");
const router = express.Router();
const { pool } = require("../config/database");

// GET /api/empresas - Obtener todas las empresas
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM empresas ORDER BY nombre_oficial",
    );
    res.json(rows);
  } catch (error) {
    console.error("Error en GET /empresas:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/empresas/:id - Obtener una empresa por ID
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM empresas WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Empresa no encontrada" });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error("Error en GET /empresas/:id:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/empresas - Crear nueva empresa
router.post("/", async (req, res) => {
  const { dolibarr_id, nombre_oficial, cif, activo } = req.body;

  // Validaciones básicas
  if (!dolibarr_id || !nombre_oficial) {
    return res.status(400).json({
      error:
        "Faltan campos requeridos: dolibarr_id y nombre_oficial son obligatorios",
    });
  }

  try {
    const [result] = await pool.query(
      "INSERT INTO empresas (dolibarr_id, nombre_oficial, cif, activo) VALUES (?, ?, ?, ?)",
      [
        dolibarr_id,
        nombre_oficial,
        cif || null,
        activo !== undefined ? activo : 1,
      ],
    );

    const [newEmpresa] = await pool.query(
      "SELECT * FROM empresas WHERE id = ?",
      [result.insertId],
    );

    res.status(201).json(newEmpresa[0]);
  } catch (error) {
    console.error("Error en POST /empresas:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({ error: "Ya existe una empresa con ese dolibarr_id" });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/empresas/:id - Actualizar empresa
router.put("/:id", async (req, res) => {
  const { dolibarr_id, nombre_oficial, cif, activo } = req.body;

  try {
    const [result] = await pool.query(
      "UPDATE empresas SET dolibarr_id = ?, nombre_oficial = ?, cif = ?, activo = ? WHERE id = ?",
      [dolibarr_id, nombre_oficial, cif, activo, req.params.id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Empresa no encontrada" });
    }

    const [updated] = await pool.query("SELECT * FROM empresas WHERE id = ?", [
      req.params.id,
    ]);

    res.json(updated[0]);
  } catch (error) {
    console.error("Error en PUT /empresas/:id:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/empresas/:id - Eliminar empresa
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM empresas WHERE id = ?", [
      req.params.id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Empresa no encontrada" });
    }

    res.json({ message: "Empresa eliminada correctamente" });
  } catch (error) {
    console.error("Error en DELETE /empresas/:id:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
