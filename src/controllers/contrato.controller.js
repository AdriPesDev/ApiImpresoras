const ContratoModel = require('../models/contrato.model');

class ContratoController {
  constructor(pool) {
    this.contratoModel = new ContratoModel(pool);
  }

  // GET /api/contratos
  getAll = async (req, res, next) => {
    try {
      const filtros = {
        activo: req.query.activo === undefined ? undefined : req.query.activo === 'true',
        empresa_id: req.query.empresa_id ? Number.parseInt(req.query.empresa_id, 10) : undefined,
        buscar: req.query.buscar || undefined,
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
      const contrato = await this.contratoModel.findById(req.params.id);
      if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });
      res.json(contrato);
    } catch (error) {
      next(error);
    }
  };

  // POST /api/contratos
  create = async (req, res, next) => {
    try {
      const nuevoContrato = await this.contratoModel.create(req.body);
      res.status(201).json(nuevoContrato);
    } catch (error) {
      next(error);
    }
  };

  // PUT /api/contratos/:id
  update = async (req, res, next) => {
    try {
      const contrato = await this.contratoModel.findById(req.params.id);
      if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });
      const actualizado = await this.contratoModel.update(req.params.id, req.body);
      res.json(actualizado);
    } catch (error) {
      next(error);
    }
  };

  // PATCH /api/contratos/:id/activo
  toggleActivo = async (req, res, next) => {
    try {
      const { activo } = req.body;
      if (activo === undefined) return res.status(400).json({ error: 'activo es requerido' });
      const contrato = await this.contratoModel.findById(req.params.id);
      if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });
      const actualizado = await this.contratoModel.toggleActivo(req.params.id, activo);
      res.json(actualizado);
    } catch (error) {
      next(error);
    }
  };

  // DELETE /api/contratos/:id
  delete = async (req, res, next) => {
    try {
      const contrato = await this.contratoModel.findById(req.params.id);
      if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });
      const eliminado = await this.contratoModel.delete(req.params.id);
      if (eliminado) {
        res.json({ message: 'Contrato eliminado correctamente' });
      } else {
        res.status(500).json({ error: 'Error al eliminar el contrato' });
      }
    } catch (error) {
      next(error);
    }
  };

  // ── Sub-resource: impresoras ──────────────────

  // POST /api/contratos/:id/impresoras
  addImpresora = async (req, res, next) => {
    try {
      const contrato = await this.contratoModel.findById(req.params.id);
      if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });
      const item = await this.contratoModel.addImpresora(req.params.id, req.body);
      res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  };

  // PUT /api/contratos/:id/impresoras/:ci_id
  updateImpresora = async (req, res, next) => {
    try {
      const item = await this.contratoModel.updateImpresora(req.params.ci_id, req.body);
      if (!item) return res.status(404).json({ error: 'Línea de impresora no encontrada' });
      res.json(item);
    } catch (error) {
      next(error);
    }
  };

  // DELETE /api/contratos/:id/impresoras/:ci_id
  removeImpresora = async (req, res, next) => {
    try {
      const eliminado = await this.contratoModel.removeImpresora(req.params.ci_id);
      if (eliminado) {
        res.json({ message: 'Impresora eliminada del contrato' });
      } else {
        res.status(404).json({ error: 'Línea de impresora no encontrada' });
      }
    } catch (error) {
      next(error);
    }
  };

  // ── Sub-resource: lineas_fijas ────────────────

  // POST /api/contratos/:id/lineas-fijas
  addLineaFija = async (req, res, next) => {
    try {
      const contrato = await this.contratoModel.findById(req.params.id);
      if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });
      const item = await this.contratoModel.addLineaFija(req.params.id, req.body);
      res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  };

  // PUT /api/contratos/:id/lineas-fijas/:lf_id
  updateLineaFija = async (req, res, next) => {
    try {
      const item = await this.contratoModel.updateLineaFija(req.params.lf_id, req.body);
      if (!item) return res.status(404).json({ error: 'Línea fija no encontrada' });
      res.json(item);
    } catch (error) {
      next(error);
    }
  };

  // DELETE /api/contratos/:id/lineas-fijas/:lf_id
  removeLineaFija = async (req, res, next) => {
    try {
      const eliminado = await this.contratoModel.removeLineaFija(req.params.lf_id);
      if (eliminado) {
        res.json({ message: 'Línea fija eliminada' });
      } else {
        res.status(404).json({ error: 'Línea fija no encontrada' });
      }
    } catch (error) {
      next(error);
    }
  };
}

module.exports = ContratoController;
