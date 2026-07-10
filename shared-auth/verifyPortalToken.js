// ─────────────────────────────────────────────────────────────
//  Verificación del token RS256 del NethivePortal.
//  Copia idéntica a la de fleet-api.
// ─────────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');

const PORTAL_PUBLIC_KEY = process.env.PORTAL_PUBLIC_KEY;
const ISSUER = process.env.PORTAL_ISSUER || 'nethive-portal';
const APP_SLUG = process.env.PORTAL_APP_SLUG || 'impresoras';

function verifyPortalToken(token) {
  if (!PORTAL_PUBLIC_KEY) throw new Error('PORTAL_PUBLIC_KEY no configurada');
  return jwt.verify(token, PORTAL_PUBLIC_KEY, { algorithms: ['RS256'], issuer: ISSUER });
}

function extractPortalToken(req) {
  if (req.cookies?.np_session) return req.cookies.np_session;
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Devuelve { valid: true, user } o { valid: false }. El caso mustChange devuelve
// { valid: false, mustChange: true }: NO basta con decir que no vale, porque el
// middleware caería al login local (y en apiKeyMiddleware, a la rama de API key).
// Quien llama tiene que cortocircuitar con un 403 antes de ese fallback.
function tryPortalAuth(req) {
  const token = extractPortalToken(req);
  if (!token) return { valid: false };
  try {
    const claims = verifyPortalToken(token);
    if (claims.type !== 'access') return { valid: false };
    if (claims.mustChange) return { valid: false, mustChange: true };
    const satelliteRole = claims.apps?.[APP_SLUG];
    if (!satelliteRole) return { valid: false };
    return {
      valid: true,
      user: {
        portal_id: claims.sub,
        email: claims.email,
        nombre: claims.nombre,
        portal_role: claims.role,
        rol: satelliteRole,
        kind: 'staff',
      },
    };
  } catch {
    return { valid: false };
  }
}

module.exports = { verifyPortalToken, extractPortalToken, tryPortalAuth };
