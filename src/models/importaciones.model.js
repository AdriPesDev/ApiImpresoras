// src/models/importacion.model.js
class ImportacionModel {
  constructor(pool) {
    this.pool = pool;
  }

  // Registrar una nueva importación
  async registrarImportacion(importacionData) {
    const {
      nombre_archivo,
      total_registros,
      hash_archivo,
      estado,
      detalles,
      usuario,
    } = importacionData;

    const [result] = await this.pool.query(
      `INSERT INTO historial_importaciones 
       (nombre_archivo, total_registros, hash_archivo, estado, detalles, usuario) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        nombre_archivo,
        total_registros || 0,
        hash_archivo || null,
        estado || "completada",
        detalles || null,
        usuario || null,
      ],
    );

    return result.insertId;
  }

  // Verificar si un archivo ya fue importado
  async yaFueImportado(nombreArchivo, hashArchivo = null) {
    let query =
      "SELECT id, nombre_archivo, fecha_importacion FROM historial_importaciones WHERE nombre_archivo = ?";
    let params = [nombreArchivo];

    if (hashArchivo) {
      query += " OR hash_archivo = ?";
      params.push(hashArchivo);
    }

    const [rows] = await this.pool.query(query, params);
    return rows.length > 0 ? rows[0] : null;
  }

  // Obtener historial de importaciones
  async getHistorial(limit = 50, offset = 0) {
    const [rows] = await this.pool.query(
      `SELECT * FROM historial_importaciones 
       ORDER BY fecha_importacion DESC 
       LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)],
    );
    return rows;
  }

  // Obtener una importación por ID
  async getImportacionById(id) {
    const [rows] = await this.pool.query(
      "SELECT * FROM historial_importaciones WHERE id = ?",
      [id],
    );
    return rows[0];
  }

  // Actualizar estado de una importación
  async actualizarEstado(id, estado, detalles = null) {
    await this.pool.query(
      "UPDATE historial_importaciones SET estado = ?, detalles = ? WHERE id = ?",
      [estado, detalles, id],
    );
    return this.getImportacionById(id);
  }

  // Contar total de importaciones
  async contarImportaciones() {
    const [rows] = await this.pool.query(
      "SELECT COUNT(*) as total FROM historial_importaciones",
    );
    return rows[0].total;
  }
}

module.exports = ImportacionModel;
