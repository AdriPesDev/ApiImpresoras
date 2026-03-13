const express = require("express");
const router = express.Router();
const { impresoraValidations } = require("../middleware/validation.middleware");

module.exports = (controller) => {
  // GET /api/impresoras
  router.get("/", controller.getAll);

  // GET /api/impresoras/:id
  router.get("/:id", controller.getById);

  // GET /api/impresoras/:id/registros
  router.get("/:id/registros", controller.getRegistros);

  // GET /api/impresoras/:id/contrato
  router.get("/:id/contrato", controller.getContrato);

  // POST /api/impresoras
  router.post("/", impresoraValidations.create, controller.create);

  // PUT /api/impresoras/:id
  router.put("/:id", impresoraValidations.update, controller.update);

  // DELETE /api/impresoras/:id
  router.delete("/:id", controller.delete);

  return router;
};
