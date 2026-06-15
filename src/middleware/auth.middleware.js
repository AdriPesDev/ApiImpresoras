const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar_este_secreto_en_produccion';

// ── Middleware JWT ──────────────────────────────────
// Valida el token Bearer y adjunta req.user con { id, username, rol }.
// Se aplica a todas las rutas /api/* excepto /api/auth/login y /api/health.
const jwtMiddleware = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado.' });
  }

  const token = header.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id, username: decoded.username, rol: decoded.rol };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado.' });
    }
    return res.status(401).json({ error: 'Token inválido.' });
  }
};

// ── Middleware de roles ────────────────────────────
// Uso: requireRole('admin') o requireRole(['admin', 'viewer'])
const requireRole = (roles) => {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción.' });
    }
    next();
  };
};

// ── Middleware legacy API key (compatibilidad) ─────
// Acepta x-api-key como alternativa a JWT (para scripts, cron, etc.)
const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === process.env.API_KEY) {
    req.user = { id: 0, username: 'api-key', rol: 'admin' };
    return next();
  }
  return jwtMiddleware(req, res, next);
};

module.exports = { jwtMiddleware, requireRole, apiKeyMiddleware };
