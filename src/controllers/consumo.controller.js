const ConsumoModel = require("../models/consumo.model");
const ImpresoraModel = require("../models/impresora.model");

class ConsumoController {
  constructor(pool) {
    this.consumoModel = new ConsumoModel(pool);
    this.impresoraModel = new ImpresoraModel(pool);
  }

  // GET /api/consumos
  getAll = async (req, res, next) => {
    try {
      const filtros = {
        periodo: req.query.periodo,
        impresora_id: req.query.impresora_id
          ? Number.parseInt(req.query.impresora_id, 10)
          : undefined,
        facturado:
          req.query.facturado === undefined
            ? undefined
            : req.query.facturado === "true",
      };

      const consumos = await this.consumoModel.findAll(filtros);
      res.json(consumos);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/consumos/pendientes
  getPendientes = async (req, res, next) => {
    try {
      const consumos = await this.consumoModel.findAll({ facturado: false });
      res.json(consumos);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/consumos/resumen
  getResumen = async (req, res, next) => {
    try {
      const { periodo } = req.query;
      const resumen = await this.consumoModel.getResumenFacturacion(periodo);
      res.json(resumen);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/consumos/:id
  getById = async (req, res, next) => {
    try {
      const { id } = req.params;
      const consumo = await this.consumoModel.findById(id);

      if (!consumo) {
        return res.status(404).json({ error: "Consumo no encontrado" });
      }

      res.json(consumo);
    } catch (error) {
      next(error);
    }
  };

  // PATCH /api/consumos/cerrar-periodo
  cerrarPeriodo = async (req, res, next) => {
    try {
      const { periodo } = req.body;
      if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
        return res.status(400).json({ error: 'Formato de periodo inválido (YYYY-MM).' });
      }
      const resultado = await this.consumoModel.cerrarPeriodo(periodo);
      res.json(resultado);
    } catch (error) {
      next(error);
    }
  };

  // PUT /api/consumos/:id/facturar
  marcarFacturado = async (req, res, next) => {
    try {
      const { id } = req.params;

      const consumo = await this.consumoModel.findById(id);
      if (!consumo) {
        return res.status(404).json({ error: "Consumo no encontrado" });
      }

      if (consumo.facturado) {
        return res.status(400).json({ error: "El consumo ya está facturado" });
      }

      const consumoActualizado = await this.consumoModel.marcarFacturado(id);
      res.json(consumoActualizado);
    } catch (error) {
      next(error);
    }
  };

}

module.exports = ConsumoController;
