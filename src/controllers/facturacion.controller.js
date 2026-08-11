const FacturacionService = require('../services/facturacion.service');
const DolibarrService = require('../services/dolibarr.service');
const { generarReporteExcel, listarReportes } = require('../services/reporteExcel.service');

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

      // El Excel refleja TODA la flota del periodo (no solo lo seleccionado),
      // superponiendo el resultado real de la emisión.
      let excelInfo = null;
      try {
        const analisis = await this.facturacionService.analizarFlota(periodo);

        // Overlay 1: KPIs de emisión REAL (en la flota no se emite → vendrían a 0).
        analisis.resumen.facturas_creadas               = resultado.resumen.facturas_creadas;
        analisis.resumen.facturas_error_envio           = resultado.resumen.facturas_error_envio;
        analisis.resumen.facturas_creadas_sin_persistir = resultado.resumen.facturas_creadas_sin_persistir;

        // Overlay 2: id de factura realmente emitida, por serial.
        const idsPorSerial = new Map();
        for (const f of resultado.facturas_por_empresa) {
          if (f.id_factura_dolibarr) {
            for (const s of f.seriales) idsPorSerial.set(s, f.id_factura_dolibarr);
          }
        }

        const origenCsv = await this.facturacionService.getOrigenCsvPeriodo(periodo);
        excelInfo = await generarReporteExcel(analisis, {
          origenCsv: origenCsv || 'N/D',
          modo: 'produccion',
          idsPorSerial,
        });
      } catch (excelErr) {
        console.error('[Excel] Error generando reporte:', excelErr.message);
      }

      res.json({
        ...resultado,
        excel: excelInfo ? { nombre: excelInfo.nombre, url: `/exports/${excelInfo.nombre}` } : null,
      });
    } catch (error) {
      next(error);
    }
  };
  // GET /api/facturacion/informe?periodo=YYYY-MM
  // Genera el Excel de análisis de flota sin tocar Dolibarr ni facturar nada
  // (analizarFlota ya es de solo lectura). Útil para revisar/exportar antes
  // de decidir qué facturar, o simplemente para tener el reporte del mes.
  informe = async (req, res, next) => {
    try {
      const { periodo } = req.query;
      if (!periodo) return res.status(400).json({ error: 'Falta el periodo.' });

      const analisis = await this.facturacionService.analizarFlota(periodo);
      const origenCsv = await this.facturacionService.getOrigenCsvPeriodo(periodo);
      const excelInfo = await generarReporteExcel(analisis, {
        origenCsv: origenCsv || 'N/D',
        modo: 'informe',
      });

      res.json({ excel: { nombre: excelInfo.nombre, url: `/exports/${excelInfo.nombre}` } });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/facturacion/reportes
  // Lista los Excel ya generados (por ejecutar() o por informe()) para poder
  // descargarlos de nuevo sin tener que volver a generarlos.
  reportes = async (req, res, next) => {
    try {
      const reportes = await listarReportes();
      res.json(reportes.map((r) => ({ ...r, url: `/exports/${r.nombre}` })));
    } catch (error) {
      next(error);
    }
  };
}

module.exports = FacturacionController;
