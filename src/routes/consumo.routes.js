const express = require("express");
const router = express.Router();
const { consumoValidations } = require("../middleware/validation.middleware");

module.exports = (controller) => {
  // GET /api/consumos
  router.get("/", controller.getAll);

  // GET /api/consumos/pendientes
  router.get("/pendientes", controller.getPendientes);

  // GET /api/consumos/resumen
  router.get("/resumen", controller.getResumen);

  // GET /api/consumos/:id
  router.get("/:id", controller.getById);

  // PUT /api/consumos/:id/facturar
  router.put("/:id/facturar", controller.marcarFacturado);

  // POST /api/consumos/calcular/:periodo
  router.post(
    "/calcular/:periodo",
    consumoValidations.calcularPeriodo,
    controller.calcularPeriodo,
  );

  return router;
};
