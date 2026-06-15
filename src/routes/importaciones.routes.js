const express = require("express");

module.exports = function createImportacionesRoutes(controller) {
  const router = express.Router();

  router.get("/", controller.getHistorial);
  router.get("/verificar", controller.verificarImportacion);
  router.post("/", controller.registrarImportacion);
  router.get("/:id", controller.getImportacionById);
  router.put("/:id/estado", controller.actualizarEstado);

  return router;
};
