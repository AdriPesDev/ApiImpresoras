const FacturacionService = require('../services/facturacion.service');
const DolibarrService = require('../services/dolibarr.service');

class FacturacionController {
  constructor(pool) {
    this.dolibarrService = new DolibarrService();
    this.facturacionService = new FacturacionService(pool, this.dolibarrService);
  }

  // POST /api/facturacion/preview
  // Body: { periodo, consumo_ids: [id, ...] }
  preview = async (req, res, next) => {
    try {
      const { periodo, consumo_ids } = req.body;
      if (!periodo) return res.status(400).json({ error: 'Falta el periodo.' });
      const resultado = await this.facturacionService.preview(periodo, consumo_ids);
      res.json(resultado);
    } catch (error) {
      next(error);
    }
  };

  // POST /api/facturacion/ejecutar
  // Body: { periodo, consumo_ids: [id, ...] }
  ejecutar = async (req, res, next) => {
    try {
      const { periodo, consumo_ids } = req.body;
      if (!periodo) return res.status(400).json({ error: 'Falta el periodo.' });
      if (!Array.isArray(consumo_ids) || consumo_ids.length === 0) {
        return res.status(400).json({ error: 'Selecciona al menos un consumo a facturar.' });
      }
      const resultado = await this.facturacionService.ejecutar(periodo, consumo_ids);
      res.json(resultado);
    } catch (error) {
      next(error);
    }
  };
}

module.exports = FacturacionController;
