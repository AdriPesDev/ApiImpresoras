const express = require('express');

module.exports = function createConsumoRoutes(controller) {
  const router = express.Router();


  router.get('/', controller.getAll);
  router.get('/pendientes', controller.getPendientes);
  router.get('/resumen', controller.getResumen);
  router.patch('/cerrar-periodo', controller.cerrarPeriodo);
  router.get('/:id', controller.getById);
  router.put('/:id/facturar', controller.marcarFacturado);
  router.put('/:id/desfacturar', controller.desmarcarFacturado);
  router.put('/:id/confirmar-primera-lectura', controller.confirmarPrimeraLectura);

  return router;
};
