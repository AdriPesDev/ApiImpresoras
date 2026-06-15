const DolibarrService = require('../services/dolibarr.service');

class DolibarrController {
  constructor() {
    this.dolibarr = new DolibarrService();
  }

  // GET /api/dolibarr/terceros/buscar?nombre=ACME
  buscarTercero = async (req, res, next) => {
    try {
      const { nombre } = req.query;
      if (!nombre?.trim()) {
        return res.status(400).json({ error: 'El parámetro nombre es requerido' });
      }
      const tercero = await this.dolibarr.buscarTercero(nombre.trim());
      if (!tercero) {
        return res.status(404).json({ error: `Empresa '${nombre}' no encontrada en Dolibarr` });
      }
      res.json(tercero);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/dolibarr/terceros?limit=50&page=0&sqlfilters=...
  listarTerceros = async (req, res, next) => {
    try {
      const { limit = 100, page = 0, sqlfilters } = req.query;
      const params = { limit, page };
      if (sqlfilters) params.sqlfilters = sqlfilters;
      const terceros = await this.dolibarr.listarTerceros(params);
      res.json(terceros);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/dolibarr/health
  health = async (req, res, next) => {
    try {
      const terceros = await this.dolibarr.listarTerceros({ limit: 1 });
      res.json({ status: 'OK', dolibarr_url: process.env.DOLIBARR_URL });
    } catch (error) {
      res.status(502).json({ status: 'ERROR', error: error.message });
    }
  };
}

module.exports = DolibarrController;
