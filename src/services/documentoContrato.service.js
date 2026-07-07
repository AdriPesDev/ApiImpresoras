const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const AdmZip = require("adm-zip");

// ── Mapa de plantillas ────────────────────────────────────
const TEMPLATES_DIR = path.join(__dirname, "..", "..", "templates");

const TEMPLATE_MAP = {
  "3colores_con": "WordPlantilla3Colores_Con_Observaciones.docx",
  "3colores_sin": "WordPlantilla3Colores_Sin_Observaciones.docx",
  "1color_con": "WordPlantilla1Color_Con_Observaciones.docx",
  "1color_sin": "WordPlantilla1Color_Sin_Observaciones.docx",
  "bn_con": "WordPlantillaBlancoYNegro_Con_Condiciones.docx",
  "bn_sin": "WordPlantillaBlancoYNegro_Sin_Condiciones.docx",
};

// ── Helpers ────────────────────────────────────────────────

/** Escapa caracteres especiales de XML */
function xmlEscape(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Reemplaza texto plano dentro de elementos <w:t>...</w:t>.
 * Respeta el atributo xml:space="preserve" si el valor contiene espacios al inicio/final.
 */
function replaceInXml(xml, search, replace) {
  const escaped = xmlEscape(replace);
  // Busca dentro de tags <w:t> (con o sin atributos)
  // Patrón: >...search...</w:t>
  // Usamos split/join que es más robusto que regex para este caso
  return xml.split(search).join(escaped);
}

/**
 * Para placeholders que podrían estar escapados en XML (ej. B&N → B&amp;N)
 */
function replaceInXmlRaw(xml, search, replace) {
  return xml.split(search).join(replace);
}

// ── Servicio principal ────────────────────────────────────

/**
 * Genera un documento .docx de contrato a partir de una plantilla y datos del formulario.
 *
 * @param {Object} datos
 * @param {string} datos.tipoPlantilla        - "3colores" | "1color" | "bn"
 * @param {boolean} datos.incluirObservaciones - true/false
 * @param {string} datos.numeroContrato        - Nº de contrato para la cabecera
 *
 * -- Cliente --
 * @param {string} datos.nombreResponsable
 * @param {string} datos.dniResponsable
 * @param {string} datos.razonSocial
 * @param {string} datos.cif
 * @param {string} datos.direccionFiscal
 *
 * -- Impresoras (array) --
 * @param {Array}  datos.impresoras            - [{ marca, modelo, serie, copiasBN, copiasColor }]
 *
 * -- Precios --
 * @param {string} datos.precioBN
 * @param {string} datos.precioColor           - Solo 1color
 * @param {string} datos.precioC1              - Solo 3colores
 * @param {string} datos.precioC2              - Solo 3colores
 * @param {string} datos.precioC3              - Solo 3colores
 * @param {string} datos.cuotaAlquiler
 *
 * -- Contrato --
 * @param {string|number} datos.duracionMeses
 * @param {string} datos.observaciones
 *
 * -- Firma --
 * @param {string} datos.nombreFirmante
 * @param {string} datos.lugarFirma
 * @param {string} datos.fechaFirma
 *
 * @returns {Promise<{filePath: string, fileName: string}>}
 */
async function generarDocumento(datos) {
  const {
    tipoPlantilla,
    incluirObservaciones,
    numeroContrato = "",
    nombreResponsable = "",
    dniResponsable = "",
    razonSocial = "",
    cif = "",
    direccionFiscal = "",
    impresoras = [],
    precioBN = "",
    precioColor = "",
    precioC1 = "",
    precioC2 = "",
    precioC3 = "",
    cuotaAlquiler = "",
    duracionMeses = "",
    observaciones = "",
    nombreFirmante = "",
    lugarFirma = "",
    fechaFirma = "",
  } = datos;

  // 1. Determinar plantilla
  const suffix = incluirObservaciones ? "con" : "sin";
  const templateKey = `${tipoPlantilla}_${suffix}`;
  const templateFile = TEMPLATE_MAP[templateKey];

  if (!templateFile) {
    throw new Error(
      `Plantilla no encontrada: tipo=${tipoPlantilla}, observaciones=${incluirObservaciones}. Claves válidas: ${Object.keys(TEMPLATE_MAP).join(", ")}`,
    );
  }

  const templatePath = path.join(TEMPLATES_DIR, templateFile);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Archivo de plantilla no encontrado: ${templatePath}`);
  }

  // 2. Leer ZIP
  const zip = new AdmZip(templatePath);

  // 3. Procesar document.xml
  let docXml = zip.readAsText("word/document.xml");
  docXml = aplicarReemplazosDocumento(docXml, tipoPlantilla, datos);
  zip.updateFile("word/document.xml", Buffer.from(docXml, "utf-8"));

  // 4. Procesar header1.xml (nº de contrato en cabecera)
  const headerEntry = zip.getEntry("word/header1.xml");
  if (headerEntry) {
    let hdrXml = zip.readAsText("word/header1.xml");
    hdrXml = aplicarReemplazosHeader(hdrXml, numeroContrato);
    zip.updateFile("word/header1.xml", Buffer.from(hdrXml, "utf-8"));
  }

  // 5. Escribir archivo temporal
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "contrato-"));
  const safeNumero = (numeroContrato || "contrato")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .substring(0, 50);
  const safeEmpresa = (razonSocial || "empresa")
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, "")
    .substring(0, 30)
    .trim();
  const fileName = `Contrato_${safeNumero}_${safeEmpresa}.docx`;
  const filePath = path.join(tmpDir, fileName);

  zip.writeZip(filePath);

  return { filePath, fileName };
}

// ── Reemplazos en document.xml ────────────────────────────

function aplicarReemplazosDocumento(xml, tipoPlantilla, datos) {
  const {
    nombreResponsable = "",
    dniResponsable = "",
    razonSocial = "",
    cif = "",
    direccionFiscal = "",
    impresoras = [],
    precioBN = "",
    precioColor = "",
    precioC1 = "",
    precioC2 = "",
    precioC3 = "",
    cuotaAlquiler = "",
    duracionMeses = "",
    observaciones = "",
    nombreFirmante = "",
    lugarFirma = "",
    fechaFirma = "",
  } = datos;

  // ── Datos del cliente ──
  // Todos los templates usan las mismas frases (con variaciones de case)
  const clienteReemplazos = [
    ["Nombre y apellidos de la persona responsable", nombreResponsable],
    ["Nombre y apellidos persona firmante", nombreFirmante],
    ["DNI persona responsable", dniResponsable],
    ["DNI de la persona responsable", dniResponsable],
    ["Nombre o razón social", razonSocial],
    ["Dirección Fiscal Completa", direccionFiscal],
    ["Dirección fiscal completa", direccionFiscal],
    ["Nombre del firmante por parte del cliente", nombreFirmante],
    ["Nombre del firmante del cliente", nombreFirmante],
    ["Lugar de la firma", lugarFirma],
    ["Lugar de firma", lugarFirma],
    ["Fecha de la firma", fechaFirma],
    ["Observaciones del contrato", observaciones || "—"],
  ];

  for (const [search, replace] of clienteReemplazos) {
    xml = replaceInXml(xml, search, replace);
  }

  // CIF: reemplazar el CIF placeholder (standalone, no el de Nethive)
  // El CIF de Nethive es B42891945 y no debe tocarse
  // Los placeholders son literalmente "CIF" como texto standalone
  xml = reemplazarCifPlaceholder(xml, cif);

  // ── Impresoras ──
  const imp = impresoras[0] || {};
  xml = aplicarReemplazosImpresora(xml, tipoPlantilla, imp);

  // ── Precios según tipo ──
  if (tipoPlantilla === "3colores") {
    xml = replaceInXml(xml, "Precio por copia BN", precioBN);
    xml = replaceInXml(xml, "Precio por copia C1", precioC1);
    xml = replaceInXml(xml, "Precio por copia C2", precioC2);
    xml = replaceInXml(xml, "Precio por copia C3", precioC3);
    xml = replaceInXml(xml, "Cuota fija mensual de alquiler", cuotaAlquiler || "—");
    // Variante "Cuota fija mensual de " (sin "alquiler" en Sin_Observaciones)
    xml = replaceInXml(xml, "Cuota fija mensual de ", `${cuotaAlquiler || "—"} `);
    xml = replaceInXml(xml, "Duración de contrato", duracionMeses);
  } else if (tipoPlantilla === "1color") {
    xml = replaceInXml(xml, "precio por copia de bn", precioBN);
    xml = replaceInXml(xml, "precio por copia color", precioColor || precioBN);
    xml = replaceInXml(xml, "cuota fija mensual de alquiler", cuotaAlquiler || "—");
    // En 1Color la duración está embebida como "60 meses" — reemplazar "60"
    xml = replaceInXmlRaw(
      xml,
      "será de 60 meses",
      `será de ${xmlEscape(String(duracionMeses || "60"))} meses`,
    );
  } else if (tipoPlantilla === "bn") {
    xml = replaceInXml(xml, "Coste por copia B/N", precioBN);
    xml = replaceInXml(xml, "Cuota fija mensual de alquiler", cuotaAlquiler ? `${cuotaAlquiler} €/Mensual` : "—");
    xml = replaceInXml(xml, "Duración del contrato", duracionMeses);
  }

  return xml;
}

// ── Reemplazar CIF sin tocar el de Nethive ────────────────

function reemplazarCifPlaceholder(xml, cifValor) {
  // El placeholder "CIF" aparece como texto standalone en <w:t>CIF</w:t>
  // o <w:t xml:space="preserve">CIF</w:t>
  // Pero no queremos tocar "CIF B42891945" que es el de Nethive
  // Estrategia: reemplazar solo <w:t> que contengan exactamente "CIF" o " CIF"
  // y que NO estén precedidos por "con" (parte de la dirección del cliente, que ya fue reemplazada)

  // Reemplazo seguro: buscar ">CIF<" que son los placeholders standalone
  // Hay dos: uno en "con CIF CIF" y otro standalone
  // Después de reemplazar "con CIF " queda solo el valor en el siguiente run
  xml = xml.replace(
    /(<w:t[^>]*>)CIF(<\/w:t>)/g,
    (match, open, close, offset) => {
      // No tocar si está junto a B42891945 (Nethive)
      const context = xml.substring(
        Math.max(0, offset - 100),
        offset + match.length + 100,
      );
      if (context.includes("B42891945")) return match;
      return `${open}${xmlEscape(cifValor)}${close}`;
    },
  );

  return xml;
}

// ── Reemplazar datos de impresora ─────────────────────────

function aplicarReemplazosImpresora(xml, tipoPlantilla, imp) {
  const marca = imp.marca || "—";
  const modelo = imp.modelo || "—";
  const serie = imp.serie || "—";
  const copiasBN = imp.copiasBN || "0";
  const copiasColor = imp.copiasColor || "0";

  if (tipoPlantilla === "3colores") {
    xml = replaceInXml(xml, "Marca de la impresora", marca);
    xml = replaceInXml(xml, "Modelo de la impresora", modelo);
    xml = replaceInXml(xml, "Número de serie", serie);
    xml = replaceInXml(xml, "Numero de copias iniciales en BN ", copiasBN);
    xml = replaceInXml(xml, "Numero de copias iniciales en color", copiasColor);
  } else if (tipoPlantilla === "1color") {
    xml = replaceInXml(xml, "Marca de la impresora", marca);
    xml = replaceInXml(xml, "Modelo de la impresora", modelo);
    xml = replaceInXml(xml, "Numero de serie de la impresora", serie);
    xml = replaceInXml(xml, "Numero de copias BN", copiasBN);
    xml = replaceInXml(xml, "Numero de copias color", copiasColor);
    // Variante "Numero de copias " (sin "color", aparece en algunos)
    xml = replaceInXml(xml, "Numero de copias ", `${copiasColor} `);
  } else if (tipoPlantilla === "bn") {
    xml = replaceInXml(xml, "Marca de la impresora", marca);
    xml = replaceInXml(xml, "Modelo de la impresora", modelo);
    xml = replaceInXml(xml, "Número de serie", serie);
    xml = replaceInXml(xml, "Numero de copias iniciales BN", copiasBN);
  }

  return xml;
}

// ── Reemplazos en header1.xml ─────────────────────────────

function aplicarReemplazosHeader(xml, numeroContrato) {
  const valor = xmlEscape(numeroContrato || "—");

  // Después del merge, el header tiene:
  // <w:t>Número de contrato</w:t>  (texto completo mergeado)
  // y posiblemente <w:t>N</w:t><w:t>úmero de contrato</w:t> (parcialmente mergeado)

  // Reemplazar el texto completo
  xml = xml.split("Número de contrato").join(valor);
  // Reemplazar los fragmentos restantes
  xml = xml.split("úmero de contrato").join("");
  // El "N" suelto antes de "úmero" ahora queda como <w:t>N</w:t>
  // Lo reemplazamos si está justo antes del valor vacío
  // En realidad, tras el split/join de "úmero de contrato" → "", el "N" se queda solo.
  // Como el header se renderiza 2 veces (páginas pares/impares), sustituimos "N" → valor solo si quedó vacío
  // Mejor enfoque: reemplazar ">N<" que ahora está solo
  xml = xml.replace(
    /(<w:t[^>]*>)N(<\/w:t>)/g,
    `$1${valor}$2`,
  );

  return xml;
}

// ── Limpieza de temporales ────────────────────────────────

function limpiarTemporal(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const dir = path.dirname(filePath);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Silenciar errores de limpieza
  }
}

module.exports = { generarDocumento, limpiarTemporal };
