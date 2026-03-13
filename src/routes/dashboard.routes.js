const express = require("express");
const router = express.Router();

module.exports = (controller) => {
  // GET /api/dashboard/stats
  router.get("/stats", controller.getStats);

  // GET /api/dashboard/actividad-reciente
  router.get("/actividad-reciente", controller.getActividadReciente);

  // GET /api/dashboard/grafico-mensual
  router.get("/grafico-mensual", controller.getGraficoMensual);

  // GET /api/dashboard/top-impresoras
  router.get("/top-impresoras", controller.getTopImpresoras);

  return router;
};
