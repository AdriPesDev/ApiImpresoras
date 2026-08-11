const express = require('express');
const { facturacionValidations } = require('../middleware/validation.middleware');

module.exports = function createFacturacionRoutes(controller) {
  const router = express.Router();

  // POST /api/facturacion/preview
  router.post('/preview', facturacionValidations.procesar, controller.preview);

  // POST /api/facturacion/ejecutar
  router.post('/ejecutar', facturacionValidations.procesar, controller.ejecutar);

  // GET /api/facturacion/informe?periodo=YYYY-MM — Excel de solo lectura, no factura nada
  router.get('/informe', controller.informe);

  // GET /api/facturacion/reportes — histórico de Excel ya generados
  router.get('/reportes', controller.reportes);

  return router;
};
