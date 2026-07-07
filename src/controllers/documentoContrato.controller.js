const {
  generarDocumento,
  limpiarTemporal,
} = require("../services/documentoContrato.service");

class DocumentoContratoController {
  /**
   * POST /api/contratos/generar-documento
   *
   * Body esperado:
   * {
   *   tipoPlantilla: "3colores" | "1color" | "bn",
   *   incluirObservaciones: true | false,
   *   numeroContrato: "CTR-2024-001",
   *   nombreResponsable: "Juan García López",
   *   dniResponsable: "12345678A",
   *   razonSocial: "Empresa Ejemplo SL",
   *   cif: "B12345678",
   *   direccionFiscal: "C/ Mayor 1, 47001 Valladolid",
   *   impresoras: [
   *     { marca: "Kyocera", modelo: "ECOSYS M2040dn", serie: "VKN1234567", copiasBN: "12500", copiasColor: "300" }
   *   ],
   *   precioBN: "0.01200",
   *   precioColor: "0.05000",    // solo 1color
   *   precioC1: "0.03000",       // solo 3colores
   *   precioC2: "0.05000",       // solo 3colores
   *   precioC3: "0.07000",       // solo 3colores
   *   cuotaAlquiler: "45,00",
   *   duracionMeses: "60",
   *   observaciones: "Texto libre...",
   *   nombreFirmante: "Juan García López",
   *   lugarFirma: "Valladolid",
   *   fechaFirma: "7 de julio de 2026"
   * }
   */
  async generar(req, res) {
    try {
      const datos = req.body;

      // Validaciones básicas
      if (!datos.tipoPlantilla) {
        return res
          .status(400)
          .json({ error: "tipoPlantilla es obligatorio (3colores, 1color, bn)" });
      }
      if (!["3colores", "1color", "bn"].includes(datos.tipoPlantilla)) {
        return res
          .status(400)
          .json({ error: "tipoPlantilla debe ser: 3colores, 1color o bn" });
      }
      if (!datos.razonSocial) {
        return res
          .status(400)
          .json({ error: "razonSocial es obligatorio" });
      }

      const { filePath, fileName } = await generarDocumento(datos);

      // Enviar archivo como descarga
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(fileName)}"`,
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );

      const fileStream = require("node:fs").createReadStream(filePath);
      fileStream.pipe(res);

      // Limpiar temporal cuando termine el envío
      fileStream.on("end", () => limpiarTemporal(filePath));
      fileStream.on("error", () => limpiarTemporal(filePath));
    } catch (err) {
      console.error("Error generando documento de contrato:", err);
      res.status(500).json({
        error: "Error generando el documento",
        detalle: err.message,
      });
    }
  }
}

module.exports = DocumentoContratoController;
