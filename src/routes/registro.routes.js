const express = require("express");
const router = express.Router();
const { registroValidations } = require("../middleware/validation.middleware");

module.exports = (controller) => {
  // GET /api/registros
  router.get("/", controller.getAll); // ← controller.getAll debe ser una función

  // GET /api/registros/estadisticas
  router.get("/estadisticas", controller.getStats);

  // GET /api/registros/por-mes
  router.get("/por-mes", controller.getPorMes);

  // GET /api/registros/:id
  router.get("/:id", controller.getById);

  // POST /api/registros
  router.post("/", registroValidations.create, controller.create);

  // POST /api/registros/bulk
  router.post("/bulk", registroValidations.bulkCreate, controller.createBulk);

  return router;
};
