const ImpresoraModel = require("../models/impresora.model");

class ImpresoraController {
  constructor(pool) {
    this.impresoraModel = new ImpresoraModel(pool);
  }

  // GET /api/impresoras
  getAll = async (req, res, next) => {
    try {
      const filtros = {
        activa: req.query.activa ? req.query.activa === "true" : undefined,
        empresa_id: req.query.empresa_id
          ? parseInt(req.query.empresa_id)
          : undefined,
        modelo: req.query.modelo,
      };

      const impresoras = await this.impresoraModel.findAll(filtros);
      res.json(impresoras);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/impresoras/:id
  getById = async (req, res, next) => {
    try {
      const { id } = req.params;
      const impresora = await this.impresoraModel.findById(id);

      if (!impresora) {
        return res.status(404).json({ error: "Impresora no encontrada" });
      }

      res.json(impresora);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/impresoras/:id/registros
  getRegistros = async (req, res, next) => {
    try {
      const { id } = req.params;
      const { limite = 10 } = req.query;

      const impresora = await this.impresoraModel.findById(id);
      if (!impresora) {
        return res.status(404).json({ error: "Impresora no encontrada" });
      }

      const registros = await this.impresoraModel.getUltimosRegistros(
        id,
        parseInt(limite),
      );
      res.json(registros);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/impresoras/:id/contrato
  getContrato = async (req, res, next) => {
    try {
      const { id } = req.params;

      const impresora = await this.impresoraModel.findById(id);
      if (!impresora) {
        return res.status(404).json({ error: "Impresora no encontrada" });
      }

      const contrato = await this.impresoraModel.getContratoActivo(id);
      res.json(contrato || { message: "No hay contrato activo" });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/impresoras
  create = async (req, res, next) => {
    try {
      const impresoraData = req.body;

      if (!impresoraData.serial_number) {
        return res.status(400).json({
          error: "Falta campo requerido: serial_number",
        });
      }

      const existente = await this.impresoraModel.findBySerial(
        impresoraData.serial_number,
      );
      if (existente) {
        return res.status(400).json({
          error: "Ya existe una impresora con ese serial_number",
        });
      }

      // Asegurar que los campos de color existen
      impresoraData.precio_copia_color1 =
        impresoraData.precio_copia_color1 ||
        impresoraData.precio_copia_color ||
        0;
      impresoraData.precio_copia_color2 =
        impresoraData.precio_copia_color2 || 0;
      impresoraData.precio_copia_color3 =
        impresoraData.precio_copia_color3 || 0;
      impresoraData.tipo_facturacion =
        impresoraData.tipo_facturacion || "BN_AND_COLOR";

      const nuevaImpresora = await this.impresoraModel.create(impresoraData);
      res.status(201).json(nuevaImpresora);
    } catch (error) {
      next(error);
    }
  };

  // PUT /api/impresoras/:id
  update = async (req, res, next) => {
    try {
      const { id } = req.params;
      const impresoraData = req.body;

      const impresora = await this.impresoraModel.findById(id);
      if (!impresora) {
        return res.status(404).json({ error: "Impresora no encontrada" });
      }

      // Asegurar que los campos de color existen
      impresoraData.precio_copia_color1 =
        impresoraData.precio_copia_color1 ||
        impresoraData.precio_copia_color ||
        0;
      impresoraData.precio_copia_color2 =
        impresoraData.precio_copia_color2 || 0;
      impresoraData.precio_copia_color3 =
        impresoraData.precio_copia_color3 || 0;

      const impresoraActualizada = await this.impresoraModel.update(
        id,
        impresoraData,
      );
      res.json(impresoraActualizada);
    } catch (error) {
      next(error);
    }
  };

  // DELETE /api/impresoras/:id
  delete = async (req, res, next) => {
    try {
      const { id } = req.params;

      const impresora = await this.impresoraModel.findById(id);
      if (!impresora) {
        return res.status(404).json({ error: "Impresora no encontrada" });
      }

      const eliminada = await this.impresoraModel.delete(id);
      if (eliminada) {
        res.json({ message: "Impresora eliminada correctamente" });
      } else {
        res.status(500).json({ error: "Error al eliminar la impresora" });
      }
    } catch (error) {
      next(error);
    }
  };
}

module.exports = ImpresoraController;
