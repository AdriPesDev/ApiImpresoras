const express = require("express");
const { impresoraValidations } = require("../middleware/validation.middleware");

module.exports = function createImpresoraRoutes(controller) {
  const router = express.Router();

  router.get("/", controller.getAll);
  router.get("/:id", controller.getById);
  router.get("/:id/registros", controller.getRegistros);
  router.get("/:id/contrato", controller.getContrato);
  router.post("/", impresoraValidations.create, controller.create);
  router.put("/:id", impresoraValidations.update, controller.update);
  router.delete("/:id", controller.delete);

  return router;
};
