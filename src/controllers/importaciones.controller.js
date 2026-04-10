// src/controllers/importaciones.controller.js
const ImportacionModel = require("../models/importaciones.model");

class ImportacionesController {
  constructor(pool) {
    this.importacionModel = new ImportacionModel(pool);
  }

  // GET /api/importaciones - Obtener historial de importaciones
  getHistorial = async (req, res, next) => {
    try {
      const limit = req.query.limit || 50;
      const offset = req.query.offset || 0;

      const historial = await this.importacionModel.getHistorial(limit, offset);
      const total = await this.importacionModel.contarImportaciones();

      res.json({
        data: historial,
        total: total,
        limit: parseInt(limit),
        offset: parseInt(offset),
      });
    } catch (error) {
      console.error("Error en getHistorial:", error);
      next(error);
    }
  };

  // GET /api/importaciones/verificar - Verificar si ya fue importado
  verificarImportacion = async (req, res, next) => {
    try {
      const { nombre, hash } = req.query;

      if (!nombre) {
        return res
          .status(400)
          .json({ error: "Se requiere el nombre del archivo" });
      }

      const existente = await this.importacionModel.yaFueImportado(
        nombre,
        hash,
      );

      res.json({
        importado: existente !== null,
        importacion: existente,
      });
    } catch (error) {
      console.error("Error en verificarImportacion:", error);
      next(error);
    }
  };

  // POST /api/importaciones - Registrar nueva importación
  registrarImportacion = async (req, res, next) => {
    try {
      const {
        nombre_archivo,
        total_registros,
        hash_archivo,
        estado,
        detalles,
        usuario,
      } = req.body;

      if (!nombre_archivo) {
        return res.status(400).json({ error: "nombre_archivo es requerido" });
      }

      // Verificar si ya existe (opcional, prevenir duplicados)
      const existente = await this.importacionModel.yaFueImportado(
        nombre_archivo,
        hash_archivo,
      );
      if (existente) {
        return res.status(409).json({
          error: "Este archivo ya fue importado anteriormente",
          importacion_id: existente.id,
        });
      }

      const id = await this.importacionModel.registrarImportacion({
        nombre_archivo,
        total_registros: total_registros || 0,
        hash_archivo,
        estado: estado || "completada",
        detalles,
        usuario,
      });

      const nuevaImportacion =
        await this.importacionModel.getImportacionById(id);

      res.status(201).json({
        message: "Importación registrada correctamente",
        importacion: nuevaImportacion,
      });
    } catch (error) {
      console.error("Error en registrarImportacion:", error);
      next(error);
    }
  };

  // GET /api/importaciones/:id - Obtener una importación específica
  getImportacionById = async (req, res, next) => {
    try {
      const { id } = req.params;
      const importacion = await this.importacionModel.getImportacionById(id);

      if (!importacion) {
        return res.status(404).json({ error: "Importación no encontrada" });
      }

      res.json(importacion);
    } catch (error) {
      console.error("Error en getImportacionById:", error);
      next(error);
    }
  };

  // PUT /api/importaciones/:id/estado - Actualizar estado
  actualizarEstado = async (req, res, next) => {
    try {
      const { id } = req.params;
      const { estado, detalles } = req.body;

      const importacion = await this.importacionModel.getImportacionById(id);
      if (!importacion) {
        return res.status(404).json({ error: "Importación no encontrada" });
      }

      const actualizada = await this.importacionModel.actualizarEstado(
        id,
        estado,
        detalles,
      );

      res.json({
        message: "Estado actualizado correctamente",
        importacion: actualizada,
      });
    } catch (error) {
      console.error("Error en actualizarEstado:", error);
      next(error);
    }
  };
}

module.exports = ImportacionesController;
