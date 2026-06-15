class DolibarrService {
  constructor() {
    this._cache = new Map();
  }

  _baseUrl() {
    return process.env.DOLIBARR_URL?.replace(/\/$/, '');
  }

  _headers() {
    return {
      DOLAPIKEY: process.env.DOLIBARR_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async _get(endpoint, params = {}) {
    const url = new URL(`${this._baseUrl()}/api/index.php/${endpoint}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), {
      headers: this._headers(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Dolibarr GET /${endpoint} → ${res.status}`);
    return res.json();
  }

  async post(endpoint, payload) {
    const res = await fetch(`${this._baseUrl()}/api/index.php/${endpoint}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Dolibarr POST /${endpoint} → ${res.status} ${text}`);
    }
    return res.json();
  }

  _normalizar(t) {
    // Dolibarr 22 renamed 'nom' to 'name'
    if (!t.nom && t.name) t.nom = t.name;
    return t;
  }

  async buscarTercero(nombre) {
    if (this._cache.has(nombre)) return this._cache.get(nombre);

    try {
      // Level 1: exact match
      let res = await this._get('thirdparties', { sqlfilters: `(t.nom:=:'${nombre}')` });
      if (Array.isArray(res) && res.length) {
        const t = this._normalizar(res[0]);
        this._cache.set(nombre, t);
        return t;
      }

      // Level 2: prefix LIKE
      res = await this._get('thirdparties', { sqlfilters: `(t.nom:like:'${nombre}%')` });
      if (Array.isArray(res) && res.length) {
        const t = this._normalizar(res[0]);
        this._cache.set(nombre, t);
        return t;
      }

      // Level 3: keyword search — all significant words (≥3 chars) must appear in the Dolibarr name
      const palabras = nombre.split(/\s+/).filter((p) => p.length >= 3);
      if (palabras.length) {
        res = await this._get('thirdparties', {
          sqlfilters: `(t.nom:like:'%${palabras[0]}%')`,
        });
        if (Array.isArray(res) && res.length) {
          const palabrasLower = palabras.map((p) => p.toLowerCase());
          for (const tercero of res) {
            const nomDoli = (tercero.nom || tercero.name || '').toLowerCase();
            if (palabrasLower.every((p) => nomDoli.includes(p))) {
              const t = this._normalizar(tercero);
              this._cache.set(nombre, t);
              return t;
            }
          }
        }
      }
    } catch (err) {
      // network/API errors — caller handles null
    }

    this._cache.set(nombre, null);
    return null;
  }

  async listarTerceros(params = {}) {
    const res = await this._get('thirdparties', params);
    return Array.isArray(res) ? res.map((t) => this._normalizar(t)) : [];
  }

  async crearFactura(payload) {
    return this.post('invoices', payload);
  }

  clearCache() {
    this._cache.clear();
  }
}

module.exports = DolibarrService;
