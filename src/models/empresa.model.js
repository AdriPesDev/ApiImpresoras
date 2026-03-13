class EmpresaModel {
  constructor(pool) {
    this.pool = pool;
  }

  // Obtener todas las empresas
  async findAll(activo = null) {
    let query = "SELECT * FROM empresas";
    const params = [];

    if (activo !== null) {
      query += " WHERE activo = ?";
      params.push(activo);
    }

    query += " ORDER BY nombre_oficial";

    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  // Obtener empresa por ID
  async findById(id) {
    const [rows] = await this.pool.query(
      "SELECT * FROM empresas WHERE id = ?",
      [id],
    );
    return rows[0];
  }

  // Obtener empresa por dolibarr_id
  async findByDolibarrId(dolibarrId) {
    const [rows] = await this.pool.query(
      "SELECT * FROM empresas WHERE dolibarr_id = ?",
      [dolibarrId],
    );
    return rows[0];
  }

  // Crear empresa
  async create(empresaData) {
    const { dolibarr_id, nombre_oficial, cif, activo } = empresaData;

    const [result] = await this.pool.query(
      "INSERT INTO empresas (dolibarr_id, nombre_oficial, cif, activo) VALUES (?, ?, ?, ?)",
      [
        dolibarr_id,
        nombre_oficial,
        cif || null,
        activo !== undefined ? activo : 1,
      ],
    );

    return this.findById(result.insertId);
  }

  // Actualizar empresa
  async update(id, empresaData) {
    const { dolibarr_id, nombre_oficial, cif, activo } = empresaData;

    await this.pool.query(
      "UPDATE empresas SET dolibarr_id = ?, nombre_oficial = ?, cif = ?, activo = ? WHERE id = ?",
      [dolibarr_id, nombre_oficial, cif, activo, id],
    );

    return this.findById(id);
  }

  // Eliminar empresa
  async delete(id) {
    const [result] = await this.pool.query(
      "DELETE FROM empresas WHERE id = ?",
      [id],
    );
    return result.affectedRows > 0;
  }

  // Obtener estadísticas de empresa
  async getStats(id) {
    const [rows] = await this.pool.query(
      `
      SELECT 
        e.*,
        (SELECT COUNT(*) FROM impresoras WHERE empresa_id = e.id) as total_impresoras,
        (SELECT COUNT(*) FROM impresoras WHERE empresa_id = e.id AND activa = 1) as impresoras_activas,
        (SELECT SUM(total_facturar) FROM consumos_mensuales c 
         JOIN impresoras i ON c.impresora_id = i.id 
         WHERE i.empresa_id = e.id AND c.facturado = 0) as pendiente_facturar
      FROM empresas e
      WHERE e.id = ?
    `,
      [id],
    );

    return rows[0];
  }
}

module.exports = EmpresaModel;
