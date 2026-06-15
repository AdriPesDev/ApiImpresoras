const FacturacionService = require('../services/facturacion.service');
const DolibarrService = require('../services/dolibarr.service');

class FacturacionController {
  constructor(pool) {
    this.dolibarrService = new DolibarrService();
    this.facturacionService = new FacturacionService(pool, this.dolibarrService);
  }

  // POST /api/facturacion/preview
  preview = async (req, res, next) => {
    try {
      const { periodo, impresoras } = req.body;
      const resultado = await this.facturacionService.preview(periodo, impresoras);
      res.json(resultado);
    } catch (error) {
      next(error);
    }
  };

  // POST /api/facturacion/ejecutar
  ejecutar = async (req, res, next) => {
    try {
      const { periodo, impresoras } = req.body;
      const resultado = await this.facturacionService.ejecutar(periodo, impresoras);
      res.json(resultado);
    } catch (error) {
      next(error);
    }
  };
}

module.exports = FacturacionController;
