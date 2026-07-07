const jwt = require("jsonwebtoken");
const { tryPortalAuth } = require("../../shared-auth/verifyPortalToken");
const { pool } = require("../config/database");

const JWT_SECRET =
  process.env.JWT_SECRET || "cambiar_este_secreto_en_produccion";

// ── Auto-provisioning (MySQL) ─────────────────────
// Si un usuario del portal entra por primera vez, crea un registro local.
// NOTA: ajusta el nombre de la tabla si no se llama `usuarios`.
const USERS_TABLE = "usuarios";

async function ensureLocalUser(portalUser) {
  const [existing] = await pool.query(
    `SELECT id, rol FROM ${USERS_TABLE} WHERE email = ?`,
    [portalUser.email],
  );

  if (existing.length > 0) {
    const local = existing[0];
    if (local.rol !== portalUser.rol) {
      await pool.query(`UPDATE ${USERS_TABLE} SET rol = ? WHERE id = ?`, [
        portalUser.rol,
        local.id,
      ]);
    }
    return { ...portalUser, id: local.id, username: portalUser.nombre };
  }

  const [result] = await pool.query(
    `INSERT INTO ${USERS_TABLE} (username, email, password, rol, activo) VALUES (?, ?, ?, ?, 1)`,
    [portalUser.nombre, portalUser.email, "!sso-only!", portalUser.rol],
  );
  return { ...portalUser, id: result.insertId, username: portalUser.nombre };
}

// ── Middleware JWT (con portal SSO) ────────────────
const jwtMiddleware = async (req, res, next) => {
  // 1) Intentar portal SSO (cookie np_session o Bearer RS256)
  const portal = tryPortalAuth(req);
  if (portal.valid) {
    try {
      req.user = await ensureLocalUser(portal.user);
      return next();
    } catch (err) {
      console.error("[sso] Error en auto-provisioning:", err.message);
      return res.status(500).json({ error: "Error al vincular usuario SSO" });
    }
  }

  // 2) Intentar auth local (JWT HS256)
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado." });
  }

  const token = header.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id, username: decoded.username, rol: decoded.rol };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expirado." });
    }
    return res.status(401).json({ error: "Token inválido." });
  }
};

// ── Middleware de roles (sin cambios) ──────────────
const requireRole = (roles) => {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.rol)) {
      return res
        .status(403)
        .json({ error: "No tienes permisos para esta acción." });
    }
    next();
  };
};

// ── API key legacy (con portal SSO) ────────────────
const apiKeyMiddleware = async (req, res, next) => {
  // Portal SSO tiene prioridad (cookie)
  const portal = tryPortalAuth(req);
  if (portal.valid) {
    try {
      req.user = await ensureLocalUser(portal.user);
      return next();
    } catch (err) {
      console.error("[sso] Error en auto-provisioning:", err.message);
      return res.status(500).json({ error: "Error al vincular usuario SSO" });
    }
  }

  // API key
  const apiKey = req.headers["x-api-key"];
  if (apiKey && apiKey === process.env.API_KEY) {
    req.user = { id: 0, username: "api-key", rol: "admin" };
    return next();
  }

  // JWT local
  return jwtMiddleware(req, res, next);
};

module.exports = { jwtMiddleware, requireRole, apiKeyMiddleware };
