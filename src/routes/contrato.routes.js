const express = require('express');

module.exports = function createContratoRoutes(controller) {
  const router = express.Router();

  // Collection
  router.get('/',    controller.getAll);
  router.post('/',   controller.create);

  // Single contract
  router.get('/:id',           controller.getById);
  router.put('/:id',           controller.update);
  router.patch('/:id/activo',  controller.toggleActivo);
  router.delete('/:id',        controller.delete);

  // Sub-resource: impresoras
  router.post('/:id/impresoras',              controller.addImpresora);
  router.put('/:id/impresoras/:ci_id',        controller.updateImpresora);
  router.delete('/:id/impresoras/:ci_id',     controller.removeImpresora);

  // Sub-resource: lineas-fijas
  router.post('/:id/lineas-fijas',            controller.addLineaFija);
  router.put('/:id/lineas-fijas/:lf_id',      controller.updateLineaFija);
  router.delete('/:id/lineas-fijas/:lf_id',   controller.removeLineaFija);

  return router;
};
