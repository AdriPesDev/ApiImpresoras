// routes/contrato.routes.js
const express = require("express");
const router = express.Router();

module.exports = (controller) => {
  // GET /api/contratos
  router.get("/", controller.getAll);

  // GET /api/contratos/:id
  router.get("/:id", controller.getById);

  // GET /api/contratos/impresora/:impresoraId/activos
  router.get(
    "/impresora/:impresoraId/activos",
    controller.getActivosByImpresora,
  );

  // GET /api/contratos/impresora/:impresoraId/activo
  router.get("/impresora/:impresoraId/activo", controller.getActivoByImpresora);

  // GET /api/contratos/impresora/:impresoraId/distribucion/:periodo
  router.get(
    "/impresora/:impresoraId/distribucion/:periodo",
    controller.getDistribucionCopias,
  );

  // POST /api/contratos
  router.post("/", controller.create);

  // PUT /api/contratos/:id
  router.put("/:id", controller.update);

  // DELETE /api/contratos/:id (soft delete)
  router.delete("/:id", controller.delete);

  // DELETE /api/contratos/:id/permanent (hard delete)
  router.delete("/:id/permanent", controller.hardDelete);

  return router;
};
