const EmpresaModel = require("../models/empresa.model");

class EmpresaController {
  constructor(pool) {
    this.empresaModel = new EmpresaModel(pool);
  }

  // GET /api/empresas
  getAll = async (req, res, next) => {
    try {
      const { activo } = req.query;
      const activoFilter = activo !== undefined ? activo === "true" : null;

      const empresas = await this.empresaModel.findAll(activoFilter);
      res.json(empresas);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/empresas/:id
  getById = async (req, res, next) => {
    try {
      const { id } = req.params;
      const empresa = await this.empresaModel.findById(id);

      if (!empresa) {
        return res.status(404).json({ error: "Empresa no encontrada" });
      }

      res.json(empresa);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/empresas/:id/stats
  getStats = async (req, res, next) => {
    try {
      const { id } = req.params;
      const stats = await this.empresaModel.getStats(id);

      if (!stats) {
        return res.status(404).json({ error: "Empresa no encontrada" });
      }

      res.json(stats);
    } catch (error) {
      next(error);
    }
  };

  // POST /api/empresas
  create = async (req, res, next) => {
    try {
      const empresaData = req.body;

      // Validar datos requeridos
      if (!empresaData.dolibarr_id || !empresaData.nombre_oficial) {
        return res.status(400).json({
          error: "Faltan campos requeridos: dolibarr_id y nombre_oficial",
        });
      }

      // Verificar si ya existe
      const existente = await this.empresaModel.findByDolibarrId(
        empresaData.dolibarr_id,
      );
      if (existente) {
        return res.status(400).json({
          error: "Ya existe una empresa con ese dolibarr_id",
        });
      }

      const nuevaEmpresa = await this.empresaModel.create(empresaData);
      res.status(201).json(nuevaEmpresa);
    } catch (error) {
      next(error);
    }
  };

  // PUT /api/empresas/:id
  update = async (req, res, next) => {
    try {
      const { id } = req.params;
      const empresaData = req.body;

      const empresa = await this.empresaModel.findById(id);
      if (!empresa) {
        return res.status(404).json({ error: "Empresa no encontrada" });
      }

      const empresaActualizada = await this.empresaModel.update(
        id,
        empresaData,
      );
      res.json(empresaActualizada);
    } catch (error) {
      next(error);
    }
  };

  // DELETE /api/empresas/:id
  delete = async (req, res, next) => {
    try {
      const { id } = req.params;

      const empresa = await this.empresaModel.findById(id);
      if (!empresa) {
        return res.status(404).json({ error: "Empresa no encontrada" });
      }

      const eliminada = await this.empresaModel.delete(id);
      if (eliminada) {
        res.json({ message: "Empresa eliminada correctamente" });
      } else {
        res.status(500).json({ error: "Error al eliminar la empresa" });
      }
    } catch (error) {
      next(error);
    }
  };
}

module.exports = EmpresaController;
