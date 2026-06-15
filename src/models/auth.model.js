class AuthModel {
  constructor(pool) {
    this.pool = pool;
  }

  async findByUsername(username) {
    const [rows] = await this.pool.query(
      `SELECT id, username, email, password, rol, activo
       FROM usuarios
       WHERE username = ?
       LIMIT 1`,
      [username],
    );
    return rows[0] || null;
  }

  async updateLastAccess(id) {
    await this.pool.query(
      'UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?',
      [id],
    );
  }
}

module.exports = AuthModel;
