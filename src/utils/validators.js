// Helpers de saneo de parámetros de query.

/**
 * Convierte a entero acotado. Si el valor no es numérico, devuelve `def`.
 * @param {*} value  valor crudo (normalmente string de req.query)
 * @param {number} def  valor por defecto si no es parseable
 * @param {number} min  mínimo permitido
 * @param {number} max  máximo permitido
 */
function clampInt(value, def, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

/**
 * Parsea un booleano de query de forma robusta.
 * Acepta true/1/si/sí/yes y false/0/no. Devuelve `def` para valores ausentes
 * o no reconocidos (en vez de coercer cualquier string a false).
 */
function parseBool(value, def = null) {
  if (value === undefined || value === null || value === '') return def;
  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'si', 'sí', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return def;
}

module.exports = { clampInt, parseBool };
