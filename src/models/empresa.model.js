class EmpresaModel {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll(filtros = {}) {
    let query = `
      SELECT e.*, COUNT(DISTINCT i.id) AS num_impresoras
      FROM empresas e
      LEFT JOIN impresoras i ON i.empresa_id = e.id AND i.activa = TRUE
      WHERE 1=1
    `;
    const params = [];

    if (filtros.activo !== null && filtros.activo !== undefined) {
      query += ' AND e.activo = ?';
      params.push(filtros.activo);
    }
    if (filtros.buscar) {
      query += ' AND (e.nombre_oficial LIKE ? OR e.cif LIKE ?)';
      params.push(`%${filtros.buscar}%`, `%${filtros.buscar}%`);
    }

    query += ' GROUP BY e.id ORDER BY e.nombre_oficial';
    const [rows] = await this.pool.query(query, params);
    return rows;
  }

  async findById(id) {
    const [rows] = await this.pool.query('SELECT * FROM empresas WHERE id = ?', [id]);
    return rows[0];
  }

  async findByDolibarrId(dolibarrId) {
    const [rows] = await this.pool.query(
      'SELECT * FROM empresas WHERE dolibarr_id = ?',
      [dolibarrId],
    );
    return rows[0];
  }

  async create(data) {
    const [result] = await this.pool.query(
      'INSERT INTO empresas (dolibarr_id, nombre_oficial, cif, activo) VALUES (?, ?, ?, ?)',
      [data.dolibarr_id, data.nombre_oficial, data.cif ?? null, data.activo ?? true],
    );
    return this.findById(result.insertId);
  }

  async update(id, data) {
    const allowed = ['dolibarr_id', 'nombre_oficial', 'cif', 'activo'];
    const fields = [];
    const params = [];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(data[key]);
      }
    }

    if (fields.length) {
      params.push(id);
      await this.pool.query(`UPDATE empresas SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    return this.findById(id);
  }

  async delete(id) {
    const [result] = await this.pool.query('DELETE FROM empresas WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  async getStats(id) {
    const [rows] = await this.pool.query(
      `SELECT e.*,
              (SELECT COUNT(*) FROM impresoras WHERE empresa_id = e.id) AS total_impresoras,
              (SELECT COUNT(*) FROM impresoras WHERE empresa_id = e.id AND activa = TRUE) AS impresoras_activas
       FROM empresas e
       WHERE e.id = ?`,
      [id],
    );
    return rows[0];
  }
}

module.exports = EmpresaModel;
