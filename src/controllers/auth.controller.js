const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const AuthModel = require('../models/auth.model');

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar_este_secreto_en_produccion';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

class AuthController {
  constructor(pool) {
    this.model = new AuthModel(pool);
  }

  login = async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
      }

      const user = await this.model.findByUsername(username);

      if (!user) {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      }

      if (!user.activo) {
        return res.status(403).json({ error: 'Cuenta desactivada.' });
      }

      const passwordValid = await bcrypt.compare(password, user.password);
      if (!passwordValid) {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      }

      // Generar JWT
      const token = jwt.sign(
        { id: user.id, username: user.username, rol: user.rol },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES },
      );

      // Actualizar último acceso
      await this.model.updateLastAccess(user.id);

      // Respuesta con el formato que espera el frontend
      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          rol: user.rol,
        },
      });
    } catch (error) {
      console.error('Error en login:', error);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  };

  // Endpoint para verificar que el token sigue siendo válido
  me = async (req, res) => {
    res.json({ user: req.user });
  };
}

module.exports = AuthController;
