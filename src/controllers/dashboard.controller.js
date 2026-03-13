class DashboardController {
  constructor(pool) {
    this.pool = pool;
  }

  // GET /api/dashboard/stats
  getStats = async (req, res, next) => {
    try {
      const [rows] = await this.pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM empresas WHERE activo = 1) as empresas_activas,
          (SELECT COUNT(*) FROM empresas) as total_empresas,
          (SELECT COUNT(*) FROM impresoras WHERE activa = 1) as impresoras_activas,
          (SELECT COUNT(*) FROM impresoras) as total_impresoras,
          (SELECT COUNT(*) FROM registros_contadores WHERE fecha_lectura >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as lecturas_30dias,
          (SELECT IFNULL(SUM(total_facturar), 0) FROM consumos_mensuales WHERE facturado = 0) as pendiente_facturar,
          (SELECT IFNULL(SUM(total_facturar), 0) FROM consumos_mensuales 
           WHERE periodo = DATE_FORMAT(NOW(), '%Y-%m') AND facturado = 1) as facturado_mes,
          (SELECT IFNULL(SUM(copias_bn_mes + copias_color_mes), 0) FROM consumos_mensuales 
           WHERE periodo = DATE_FORMAT(NOW(), '%Y-%m')) as copias_mes
      `);

      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/dashboard/actividad-reciente
  getActividadReciente = async (req, res, next) => {
    try {
      // Últimas lecturas
      const [lecturas] = await this.pool.query(`
        SELECT 
          'lectura' as tipo,
          CONCAT('Nueva lectura: ', i.serial_number) as descripcion,
          DATE_FORMAT(r.fecha_lectura, '%d/%m/%Y %H:%i') as fecha,
          CONCAT(r.copias_bn_total + r.copias_color_total, ' copias') as valor,
          r.fecha_lectura as fecha_orden
        FROM registros_contadores r
        JOIN impresoras i ON r.impresora_id = i.id
        ORDER BY r.fecha_lectura DESC
        LIMIT 10
      `);

      // Últimas facturas
      const [facturas] = await this.pool.query(`
        SELECT 
          'factura' as tipo,
          CONCAT('Factura generada: ', e.nombre_oficial) as descripcion,
          DATE_FORMAT(c.created_at, '%d/%m/%Y') as fecha,
          CONCAT(ROUND(c.total_facturar, 2), ' €') as valor,
          c.created_at as fecha_orden
        FROM consumos_mensuales c
        JOIN impresoras i ON c.impresora_id = i.id
        JOIN empresas e ON i.empresa_id = e.id
        WHERE c.facturado = 1
        ORDER BY c.created_at DESC
        LIMIT 5
      `);

      // Nuevas impresoras
      const [impresoras] = await this.pool.query(`
        SELECT 
          'impresora' as tipo,
          CONCAT('Nueva impresora: ', i.serial_number) as descripcion,
          DATE_FORMAT(i.fecha_alta, '%d/%m/%Y') as fecha,
          i.modelo as valor,
          i.fecha_alta as fecha_orden
        FROM impresoras i
        ORDER BY i.fecha_alta DESC
        LIMIT 5
      `);

      // Combinar y ordenar
      const actividad = [...lecturas, ...facturas, ...impresoras]
        .sort((a, b) => new Date(b.fecha_orden) - new Date(a.fecha_orden))
        .slice(0, 15)
        .map(({ tipo, descripcion, fecha, valor }) => ({
          tipo,
          descripcion,
          fecha,
          valor,
        }));

      res.json(actividad);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/dashboard/grafico-mensual
  getGraficoMensual = async (req, res, next) => {
    try {
      const [rows] = await this.pool.query(`
        SELECT 
          periodo,
          SUM(copias_bn_mes) as total_bn,
          SUM(copias_color_mes) as total_color,
          SUM(total_facturar) as total_facturado
        FROM consumos_mensuales
        WHERE periodo >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 6 MONTH), '%Y-%m')
        GROUP BY periodo
        ORDER BY periodo ASC
      `);

      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/dashboard/top-impresoras
  getTopImpresoras = async (req, res, next) => {
    try {
      const [rows] = await this.pool.query(`
        SELECT 
          i.id,
          i.serial_number,
          i.modelo,
          e.nombre_oficial as empresa,
          SUM(c.copias_bn_mes + c.copias_color_mes) as total_copias,
          SUM(c.total_facturar) as total_facturado
        FROM consumos_mensuales c
        JOIN impresoras i ON c.impresora_id = i.id
        LEFT JOIN empresas e ON i.empresa_id = e.id
        WHERE c.periodo >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 3 MONTH), '%Y-%m')
        GROUP BY i.id, i.serial_number, i.modelo, e.nombre_oficial
        ORDER BY total_copias DESC
        LIMIT 10
      `);

      res.json(rows);
    } catch (error) {
      next(error);
    }
  };
}

module.exports = DashboardController;
