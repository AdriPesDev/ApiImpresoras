const ImportacionService = require('../services/importacion.service');

class ImportarController {
  constructor(pool) {
    this.service = new ImportacionService(pool);
  }

  /**
   * POST /api/registros/importar
   * Body: { impresoras: [...], nombre_archivo, contenido_csv, dry_run }
   *
   * dry_run=true  → preview: compara con lecturas anteriores, no graba nada
   * dry_run=false → importa: graba lecturas, actualiza empresas, registra historial
   */
  importar = async (req, res, next) => {
    try {
      const { impresoras, nombre_archivo, contenido_csv, dry_run } = req.body;

      if (!impresoras || !Array.isArray(impresoras) || impresoras.length === 0) {
        return res.status(400).json({ error: 'Se requiere un array de impresoras.' });
      }

      // Generar hash del contenido para detección de duplicados
      const hash_archivo = contenido_csv
        ? ImportacionService.hash(contenido_csv)
        : ImportacionService.hash(JSON.stringify(impresoras));

      const resultado = await this.service.importar({
        impresoras,
        nombre_archivo: nombre_archivo || 'import_manual',
        hash_archivo,
        usuario: req.user?.username || 'api',
        dry_run: dry_run === true,
      });

      res.json(resultado);
    } catch (error) {
      console.error('Error en importar:', error);
      next(error);
    }
  };
}

module.exports = ImportarController;
