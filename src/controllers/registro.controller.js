const RegistroModel = require("../models/registro.model");
const ImpresoraModel = require("../models/impresora.model");

class RegistroController {
  constructor(pool) {
    this.registroModel = new RegistroModel(pool);
    this.impresoraModel = new ImpresoraModel(pool);
  }

  // GET /api/registros
  getAll = async (req, res, next) => {
    try {
      const filtros = {
        impresora_id: req.query.impresora_id
          ? parseInt(req.query.impresora_id)
          : undefined,
        desde: req.query.desde,
        hasta: req.query.hasta,
        limite: req.query.limite ? parseInt(req.query.limite) : 1000,
      };
      const registros = await this.registroModel.findAll(filtros);
      res.json(registros);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/registros/estadisticas
  getStats = async (req, res, next) => {
    try {
      const { impresora_id, periodo } = req.query;
      const stats = await this.registroModel.getStats(
        impresora_id ? parseInt(impresora_id) : null,
        periodo,
      );
      res.json(stats);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/registros/por-mes
  getPorMes = async (req, res, next) => {
    try {
      const { impresora_id, year } = req.query;
      const lecturas = await this.registroModel.getLecturasPorMes(
        impresora_id ? parseInt(impresora_id) : null,
        year ? parseInt(year) : null,
      );
      res.json(lecturas);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/registros/:id
  getById = async (req, res, next) => {
    try {
      const { id } = req.params;
      const registro = await this.registroModel.findById(id);
      if (!registro) {
        return res.status(404).json({ error: "Registro no encontrado" });
      }
      res.json(registro);
    } catch (error) {
      next(error);
    }
  };

  // POST /api/registros
  create = async (req, res, next) => {
    try {
      const registroData = req.body;
      if (!registroData.impresora_id) {
        return res.status(400).json({
          error: "Faltan campos requeridos: impresora_id",
        });
      }
      const nuevoRegistro = await this.registroModel.create(registroData);
      res.status(201).json(nuevoRegistro);
    } catch (error) {
      next(error);
    }
  };

  // POST /api/registros/bulk
  createBulk = async (req, res, next) => {
    try {
      const registros = req.body;
      if (!Array.isArray(registros) || registros.length === 0) {
        return res
          .status(400)
          .json({ error: "Se requiere un array de registros" });
      }
      const resultado = await this.registroModel.createBulk(registros);
      res.status(201).json({
        message: `${resultado.count} registros creados correctamente`,
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = RegistroController;
