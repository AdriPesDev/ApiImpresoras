const express = require('express');

module.exports = function createDolibarrRoutes(controller) {
  const router = express.Router();

  // GET /api/dolibarr/health
  router.get('/health', controller.health);

  // GET /api/dolibarr/terceros
  router.get('/terceros', controller.listarTerceros);

  // GET /api/dolibarr/terceros/buscar?nombre=...
  router.get('/terceros/buscar', controller.buscarTercero);

  return router;
};
