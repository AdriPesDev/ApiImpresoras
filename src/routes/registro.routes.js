const express = require("express");
const { registroValidations } = require("../middleware/validation.middleware");

module.exports = function createRegistroRoutes(controller) {
  const router = express.Router();

  router.get("/", controller.getAll);
  router.get("/estadisticas", controller.getStats);
  router.get("/por-mes", controller.getPorMes);
  router.get("/:id", controller.getById);
  router.post("/", registroValidations.create, controller.create);
  router.post("/bulk", registroValidations.bulkCreate, controller.createBulk);

  return router;
};
