const ImpresoraModel = require("../models/impresora.model");

class ImpresoraController {
  constructor(pool) {
    this.impresoraModel = new ImpresoraModel(pool);
  }

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

      // Asegurar valores por defecto para colores
      const data = {
        ...impresoraData,
        precio_copia_bn: impresoraData.precio_copia_bn ?? 0.01,
        precio_copia_color1: impresoraData.precio_copia_color1 ?? 0.03,
        precio_copia_color2: impresoraData.precio_copia_color2 ?? 0,
        precio_copia_color3: impresoraData.precio_copia_color3 ?? 0,
        tipo_facturacion:
          impresoraData.tipo_facturacion ||
          this._detectarTipoFacturacion(impresoraData),
        activa:
          impresoraData.activa !== undefined ? impresoraData.activa : true,
      };

      const nuevaImpresora = await this.impresoraModel.create(data);
      res.status(201).json(nuevaImpresora);
    } catch (error) {
      next(error);
    }
  };

  update = async (req, res, next) => {
    try {
      const { id } = req.params;
      const impresoraData = req.body;

      const impresora = await this.impresoraModel.findById(id);
      if (!impresora) {
        return res.status(404).json({ error: "Impresora no encontrada" });
      }

      const data = {
        ...impresoraData,
        precio_copia_color1:
          impresoraData.precio_copia_color1 ?? impresora.precio_copia_color1,
        precio_copia_color2:
          impresoraData.precio_copia_color2 ?? impresora.precio_copia_color2,
        precio_copia_color3:
          impresoraData.precio_copia_color3 ?? impresora.precio_copia_color3,
        tipo_facturacion:
          impresoraData.tipo_facturacion || impresora.tipo_facturacion,
      };

      const impresoraActualizada = await this.impresoraModel.update(id, data);
      res.json(impresoraActualizada);
    } catch (error) {
      next(error);
    }
  };

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

  _detectarTipoFacturacion(data) {
    const tieneColor2 = (data.precio_copia_color2 ?? 0) > 0;
    const tieneColor3 = (data.precio_copia_color3 ?? 0) > 0;
    const tieneColor1 = (data.precio_copia_color1 ?? 0) > 0;
    const tieneBn = (data.precio_copia_bn ?? 0) > 0;

    if (tieneColor2 || tieneColor3) return "MULTICOLOR";
    if (tieneColor1 && tieneBn) return "BN_AND_COLOR";
    if (tieneColor1) return "COLOR_ONLY";
    if (tieneBn) return "BN_ONLY";
    return "BN_AND_COLOR";
  }
}

module.exports = ImpresoraController;
