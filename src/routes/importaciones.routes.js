// src/routes/importaciones.routes.js
const express = require("express");
const router = express.Router();

module.exports = (controller) => {
  // GET /api/importaciones - Obtener historial
  router.get("/", controller.getHistorial);

  // GET /api/importaciones/verificar - Verificar si ya fue importado
  router.get("/verificar", controller.verificarImportacion);

  // POST /api/importaciones - Registrar nueva importación
  router.post("/", controller.registrarImportacion);

  // GET /api/importaciones/:id - Obtener una importación específica
  router.get("/:id", controller.getImportacionById);

  // PUT /api/importaciones/:id/estado - Actualizar estado
  router.put("/:id/estado", controller.actualizarEstado);

  return router;
};
