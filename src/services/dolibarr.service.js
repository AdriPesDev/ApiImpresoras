class DolibarrService {
  constructor() {
    this._cache = new Map();
  }

  // DOLIBARR_URL puede venir con o sin el sufijo /api/index.php (el .env.example
  // lo documenta CON sufijo, y así es como se configura en este proyecto) — se
  // normaliza aquí para que _get/post, que siempre añaden /api/index.php/, no
  // acaben duplicando la ruta (".../api/index.php/api/index.php/...") y
  // devolviendo un 501 "API not found" de Dolibarr.
  _baseUrl() {
    return process.env.DOLIBARR_URL
      ?.replace(/\/$/, "")
      .replace(/\/api\/index\.php$/i, "");
  }

  _headers() {
    return {
      DOLAPIKEY: process.env.DOLIBARR_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
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
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Dolibarr POST /${endpoint} → ${res.status} ${text}`);
    }
    return res.json();
  }

  _normalizar(t) {
    // Dolibarr 22 renamed 'nom' to 'name'
    if (!t.nom && t.name) t.nom = t.name;
    return t;
  }

  // Solo tolera diferencias de mayúsculas/acentos/espacios — cualquier otra
  // diferencia (puntuación, forma jurídica, nombre editado en Kyofleet, etc.)
  // debe contar como "no es la misma empresa" y por tanto no facturar sola.
  _normalizarNombre(nombre) {
    return nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  // Dolibarr responde 404 "No third parties found" cuando una búsqueda no
  // encuentra NADA (en vez de un array vacío con 200) — _get() lanza excepción
  // ante cualquier status no-ok. Sin este envoltorio, un 404 en el nivel 1
  // (coincidencia exacta, la que más falla por acentos/puntuación) abortaba
  // TODA la cadena de fallback y nunca se llegaba al nivel 2 (candidatos por
  // LIKE + igualdad normalizada), que es el que encuentra la mayoría de
  // empresas reales cuyo único problema es acentos/mayúsculas.
  async _buscarThirdparties(params) {
    try {
      const res = await this._get("thirdparties", params);
      return Array.isArray(res) ? res : [];
    } catch (err) {
      return [];
    }
  }

  async buscarTercero(nombre) {
    if (process.env.DOLIBARR_MOCK === "true") {
      const fake = { id: 99999, nom: nombre, _source: "mock" };
      this._cache.set(nombre, fake);
      return fake;
    }
    if (this._cache.has(nombre)) return this._cache.get(nombre);

    try {
      // Level 1: exact match (fast path, no normalization needed)
      let res = await this._buscarThirdparties({
        sqlfilters: `(t.nom:=:'${nombre}')`,
      });
      if (res.length) {
        const t = this._normalizar(res[0]);
        this._cache.set(nombre, t);
        return t;
      }

      // Level 2: fetch candidates by a broad LIKE on the first significant
      // word, then require EQUALITY (not substring) once both sides are
      // normalized (case/accents/whitespace only). Any other difference —
      // punctuation, legal form, a name edited in Kyofleet — must NOT match:
      // it means it's not (verifiably) the same company, so it should be
      // left unresolved rather than billed against a guess.
      const primeraPalabra = nombre.split(/\s+/).find((p) => p.length >= 3);
      if (primeraPalabra) {
        res = await this._buscarThirdparties({
          sqlfilters: `(t.nom:like:'%${primeraPalabra}%')`,
        });
        if (res.length) {
          const objetivo = this._normalizarNombre(nombre);
          for (const tercero of res) {
            const nomDoli = tercero.nom || tercero.name || "";
            if (this._normalizarNombre(nomDoli) === objetivo) {
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
    const res = await this._get("thirdparties", params);
    return Array.isArray(res) ? res.map((t) => this._normalizar(t)) : [];
  }

  async obtenerTerceroPorId(id) {
    if (process.env.DOLIBARR_MOCK === "true") {
      return {
        id,
        nom: `mock-${id}`,
        cond_reglement_id: 1,
        mode_reglement_id: 3,
        _source: "mock",
      };
    }
    try {
      const t = await this._get(`thirdparties/${id}`);
      return t ? this._normalizar(t) : null;
    } catch (err) {
      return null; // el llamante ya trata la ausencia de condiciones
    }
  }

  async crearFactura(payload) {
    if (process.env.DOLIBARR_MOCK === "true") {
      const fakeId = Math.floor(Math.random() * 90000) + 10000;
      console.log(
        `[DOLIBARR_MOCK] crearFactura simulada → id ${fakeId} socid=${payload.socid}`,
      );
      return fakeId;
    }
    return this.post("invoices", payload);
  }

  clearCache() {
    this._cache.clear();
  }
}

module.exports = DolibarrService;
