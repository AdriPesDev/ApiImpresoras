const express = require('express');
const { facturacionValidations } = require('../middleware/validation.middleware');

module.exports = function createFacturacionRoutes(controller) {
  const router = express.Router();

  // POST /api/facturacion/preview
  router.post('/preview', facturacionValidations.procesar, controller.preview);

  // POST /api/facturacion/ejecutar
  router.post('/ejecutar', facturacionValidations.procesar, controller.ejecutar);

  return router;
};
