// ============================================================
// Copia los NOMBRES de terceros del Dolibarr REAL (solo lectura, GET) al
// Dolibarr de PRUEBAS (creación, POST) — para poder validar "Generar
// facturas" en local contra empresas que existen de verdad, sin tocar en
// ningún momento el Dolibarr real.
//
// El destino (Dolibarr de pruebas) sale de las mismas variables de entorno
// que ya usa la API (DOLIBARR_URL / DOLIBARR_API_KEY del docker-compose.dev.yml)
// — por eso este script se ejecuta DENTRO del contenedor `api`, no en el host.
//
// El origen (Dolibarr real) se pasa por variables de entorno SOLO en el
// momento de ejecutar, nunca se guarda en ningún fichero ni se comparte:
//
//   docker exec -e REAL_DOLIBARR_URL="https://tu-dolibarr-real.com/api/index.php" \
//                -e REAL_DOLIBARR_API_KEY="tu_api_key_real" \
//                proyectoimpresoras-api-1 \
//                node src/scripts/copiar-empresas-dolibarr-real-a-test.js
//
// Solo hace GET contra el Dolibarr real. Solo hace POST contra el de pruebas.
// Si una empresa (por nombre normalizado, mismo criterio que buscarTercero)
// ya existe en el de pruebas, se salta — así se puede volver a ejecutar sin
// duplicar nada.
// ============================================================

const DolibarrService = require("../services/dolibarr.service");

function normalizarNombre(nombre) {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// Cliente mínimo de solo lectura contra el Dolibarr REAL — deliberadamente
// separado de DolibarrService (que apunta al de pruebas vía env del compose)
// para que sea imposible mezclar credenciales por error.
class DolibarrRealSoloLectura {
  constructor(url, apiKey) {
    this.baseUrl = url.replace(/\/$/, "").replace(/\/api\/index\.php$/i, "");
    this.apiKey = apiKey;
  }

  async listarTercerosPagina(page, limit = 100) {
    const url = new URL(`${this.baseUrl}/api/index.php/thirdparties`);
    url.searchParams.set("page", page);
    url.searchParams.set("limit", limit);
    url.searchParams.set("sortfield", "t.rowid");
    url.searchParams.set("sortorder", "ASC");
    const res = await fetch(url.toString(), {
      headers: {
        DOLAPIKEY: this.apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 404) return []; // Dolibarr: sin más resultados en esta página
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Dolibarr REAL GET /thirdparties → ${res.status} ${text}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async listarTodos() {
    const todos = [];
    let page = 0;
    for (;;) {
      const pagina = await this.listarTercerosPagina(page);
      if (!pagina.length) break;
      todos.push(...pagina);
      page += 1;
      if (page > 200) break; // salvaguarda contra bucle infinito (20.000 terceros)
    }
    return todos;
  }
}

async function main() {
  const realUrl = process.env.REAL_DOLIBARR_URL;
  const realKey = process.env.REAL_DOLIBARR_API_KEY;
  if (!realUrl || !realKey) {
    console.error(
      "Faltan REAL_DOLIBARR_URL y/o REAL_DOLIBARR_API_KEY como variables de entorno.\n" +
        "Ejemplo:\n" +
        '  docker exec -e REAL_DOLIBARR_URL="https://tu-dolibarr-real.com/api/index.php" \\\n' +
        '               -e REAL_DOLIBARR_API_KEY="tu_api_key_real" \\\n' +
        "               proyectoimpresoras-api-1 \\\n" +
        "               node src/scripts/copiar-empresas-dolibarr-real-a-test.js",
    );
    process.exit(1);
  }
  if (process.env.DOLIBARR_MOCK === "true") {
    console.error(
      "DOLIBARR_MOCK=true — el destino (pruebas) está en modo simulado, no crearía nada real ahí. Aborto.",
    );
    process.exit(1);
  }

  const real = new DolibarrRealSoloLectura(realUrl, realKey);
  const test = new DolibarrService(); // usa DOLIBARR_URL/DOLIBARR_API_KEY del entorno del contenedor (pruebas)

  console.log("Leyendo terceros del Dolibarr REAL (solo lectura)…");
  const tercerosReales = await real.listarTodos();
  console.log(`  → ${tercerosReales.length} terceros encontrados en el Dolibarr real.`);

  console.log("Leyendo terceros ya existentes en el Dolibarr de PRUEBAS…");
  const tercerosTest = await test.listarTerceros({ limit: 1000 });
  const existentesNormalizados = new Set(
    tercerosTest.map((t) => normalizarNombre(t.nom || t.name || "")),
  );
  console.log(`  → ${tercerosTest.length} terceros ya existen en el de pruebas.`);

  let creados = 0;
  let saltados = 0;
  let errores = 0;

  for (const t of tercerosReales) {
    const nombre = (t.nom || t.name || "").trim();
    if (!nombre) continue;

    if (existentesNormalizados.has(normalizarNombre(nombre))) {
      saltados += 1;
      continue;
    }

    try {
      await test.post("thirdparties", {
        name: nombre,
        client: 1,
        code_client: "-1",
        code_fournisseur: "-1",
      });
      existentesNormalizados.add(normalizarNombre(nombre)); // evita duplicados si el nombre se repite en el origen
      creados += 1;
      if (creados % 20 === 0) console.log(`  … ${creados} creadas hasta ahora`);
    } catch (err) {
      errores += 1;
      console.error(`  ERROR creando "${nombre}": ${err.message}`);
    }
  }

  console.log("\n=== Resumen ===");
  console.log(`Terceros en Dolibarr real: ${tercerosReales.length}`);
  console.log(`Ya existían en pruebas (saltados): ${saltados}`);
  console.log(`Creados en pruebas: ${creados}`);
  console.log(`Errores: ${errores}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fallo general:", err);
    process.exit(1);
  });
