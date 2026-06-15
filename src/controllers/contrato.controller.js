// controllers/contrato.controller.js
const ContratoModel = require("../models/contrato.model");
const ImpresoraModel = require("../models/impresora.model");
const EmpresaModel = require("../models/empresa.model");

class ContratoController {
  constructor(pool) {
    this.contratoModel = new ContratoModel(pool);
    this.impresoraModel = new ImpresoraModel(pool);
    this.empresaModel = new EmpresaModel(pool);
  }

  // GET /api/contratos
  getAll = async (req, res, next) => {
    try {
      const filtros = {
        impresora_id: req.query.impresora_id
          ? parseInt(req.query.impresora_id)
          : undefined,
        empresa_id: req.query.empresa_id
          ? parseInt(req.query.empresa_id)
          : undefined,
        activo:
          req.query.activo !== undefined
            ? req.query.activo === "true"
            : undefined,
        fecha: req.query.fecha,
      };
      const contratos = await this.contratoModel.findAll(filtros);
      res.json(contratos);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/contratos/:id
  getById = async (req, res, next) => {
    try {
      const { id } = req.params;
      const contrato = await this.contratoModel.findById(id);
      if (!contrato) {
        return res.status(404).json({ error: "Contrato no encontrado" });
      }
      res.json(contrato);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/contratos/impresora/:impresoraId/activos
  getActivosByImpresora = async (req, res, next) => {
    try {
      const { impresoraId } = req.params;
      const { fecha } = req.query;

      const impresora = await this.impresoraModel.findById(impresoraId);
      if (!impresora) {
        return res.status(404).json({ error: "Impresora no encontrada" });
      }

      const contratos = await this.contratoModel.findActivosByImpresora(
        impresoraId,
        fecha,
      );
      res.json(contratos || []);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/contratos/impresora/:impresoraId/activo
  getActivoByImpresora = async (req, res, next) => {
    try {
      const { impresoraId } = req.params;
      const impresora = await this.impresoraModel.findById(impresoraId);
      if (!impresora) {
        return res.status(404).json({ error: "Impresora no encontrada" });
      }
      const contrato =
        await this.contratoModel.findActivoByImpresora(impresoraId);
      res.json(contrato || { message: "No hay contrato activo" });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/contratos/impresora/:impresoraId/distribucion/:periodo
  getDistribucionCopias = async (req, res, next) => {
    try {
      const { impresoraId, periodo } = req.params;

      const impresora = await this.impresoraModel.findById(impresoraId);
      if (!impresora) {
        return res.status(404).json({ error: "Impresora no encontrada" });
      }

      const distribucion = await this.contratoModel.getDistribucionCopias(
        impresoraId,
        periodo,
      );
      res.json(distribucion);
    } catch (error) {
      next(error);
    }
  };

  // POST /api/contratos
  create = async (req, res, next) => {
    try {
      const contratoData = req.body;

      if (!contratoData.impresora_id) {
        return res.status(400).json({ error: "impresora_id es requerido" });
      }
      if (!contratoData.empresa_id) {
        return res.status(400).json({ error: "empresa_id es requerido" });
      }
      if (!contratoData.numero_contrato) {
        return res.status(400).json({ error: "numero_contrato es requerido" });
      }
      if (!contratoData.fecha_inicio) {
        return res.status(400).json({ error: "fecha_inicio es requerido" });
      }

      const impresora = await this.impresoraModel.findById(
        contratoData.impresora_id,
      );
      if (!impresora) {
        return res.status(400).json({ error: "La impresora no existe" });
      }

      const empresa = await this.empresaModel.findById(contratoData.empresa_id);
      if (!empresa) {
        return res.status(400).json({ error: "La empresa no existe" });
      }

      const nuevoContrato = await this.contratoModel.create(contratoData);
      res.status(201).json(nuevoContrato);
    } catch (error) {
      next(error);
    }
  };

  // PUT /api/contratos/:id
  update = async (req, res, next) => {
    try {
      const { id } = req.params;
      const contrato = await this.contratoModel.findById(id);
      if (!contrato) {
        return res.status(404).json({ error: "Contrato no encontrado" });
      }

      const contratoActualizado = await this.contratoModel.update(id, req.body);
      res.json(contratoActualizado);
    } catch (error) {
      next(error);
    }
  };

  // DELETE /api/contratos/:id (soft delete)
  delete = async (req, res, next) => {
    try {
      const { id } = req.params;
      const contrato = await this.contratoModel.findById(id);
      if (!contrato) {
        return res.status(404).json({ error: "Contrato no encontrado" });
      }

      const eliminado = await this.contratoModel.softDelete(id);
      if (eliminado) {
        res.json({ message: "Contrato desactivado correctamente" });
      } else {
        res.status(500).json({ error: "Error al desactivar el contrato" });
      }
    } catch (error) {
      next(error);
    }
  };

  // DELETE /api/contratos/:id/permanent (hard delete)
  hardDelete = async (req, res, next) => {
    try {
      const { id } = req.params;
      const contrato = await this.contratoModel.findById(id);
      if (!contrato) {
        return res.status(404).json({ error: "Contrato no encontrado" });
      }

      const eliminado = await this.contratoModel.delete(id);
      if (eliminado) {
        res.json({ message: "Contrato eliminado permanentemente" });
      } else {
        res.status(500).json({ error: "Error al eliminar el contrato" });
      }
    } catch (error) {
      next(error);
    }
  };
}

module.exports = ContratoController;
