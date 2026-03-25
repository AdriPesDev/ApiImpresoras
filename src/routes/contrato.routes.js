const express = require("express");
const router = express.Router();

module.exports = (controller) => {
  // GET /api/contratos
  router.get("/", controller.getAll);

  // GET /api/contratos/:id
  router.get("/:id", controller.getById);

  // GET /api/contratos/impresora/:impresoraId/activo
  router.get("/impresora/:impresoraId/activo", controller.getActivoByImpresora);

  // POST /api/contratos
  router.post("/", controller.create);

  // PUT /api/contratos/:id
  router.put("/:id", controller.update);

  // DELETE /api/contratos/:id
  router.delete("/:id", controller.delete);

  return router;
};
