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
          ? parseInt(req.query.impresora_id)
          : undefined,
        facturado:
          req.query.facturado !== undefined
            ? req.query.facturado === "true"
            : undefined,
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

  // POST /api/consumos/calcular/:periodo
  calcularPeriodo = async (req, res, next) => {
    const connection = await this.consumoModel.pool.getConnection();

    try {
      const { periodo } = req.params;

      // Validar formato del período (YYYY-MM)
      if (!periodo.match(/^\d{4}-\d{2}$/)) {
        return res
          .status(400)
          .json({ error: "Formato de período inválido. Use YYYY-MM" });
      }

      await connection.beginTransaction();

      // Obtener todas las impresoras activas con sus datos completos
      const impresoras = await connection.query(`
      SELECT * FROM impresoras WHERE activa = 1
    `);

      // Calcular consumos
      const resultados = await this.consumoModel.calcularConsumosPeriodo(
        periodo,
        impresoras[0],
        connection,
      );

      // Guardar cada consumo
      for (const resultado of resultados) {
        await this.consumoModel.upsert(resultado);
      }

      await connection.commit();

      res.json({
        message: `Consumos calculados para ${periodo}`,
        calculados: resultados.length,
        total: impresoras[0].length,
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  };
}

module.exports = ConsumoController;
