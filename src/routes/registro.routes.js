const express = require("express");
const router = express.Router();
const { registroValidations } = require("../middleware/validation.middleware");

module.exports = (controller) => {
  // Verificar que controller existe y tiene los métodos necesarios
  if (!controller) {
    throw new Error("RegistroController no proporcionado");
  }

  // GET /api/registros
  if (typeof controller.getAll === "function") {
    router.get("/", controller.getAll);
  } else {
    console.error("❌ controller.getAll no es una función");
  }

  // GET /api/registros/estadisticas
  if (typeof controller.getStats === "function") {
    router.get("/estadisticas", controller.getStats);
  } else {
    console.error("❌ controller.getStats no es una función");
  }

  // GET /api/registros/por-mes
  if (typeof controller.getPorMes === "function") {
    router.get("/por-mes", controller.getPorMes);
  } else {
    console.error("❌ controller.getPorMes no es una función");
  }

  // GET /api/registros/:id
  if (typeof controller.getById === "function") {
    router.get("/:id", controller.getById);
  } else {
    console.error("❌ controller.getById no es una función");
  }

  // POST /api/registros
  if (typeof controller.create === "function") {
    router.post("/", registroValidations.create, controller.create);
  } else {
    console.error("❌ controller.create no es una función");
  }

  // POST /api/registros/bulk
  if (typeof controller.createBulk === "function") {
    router.post("/bulk", registroValidations.bulkCreate, controller.createBulk);
  } else {
    console.error("❌ controller.createBulk no es una función");
  }

  return router;
};
