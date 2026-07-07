// ============================================================
// motorFacturacion.js — Motor de cálculo de facturación PURO
// ============================================================
// Lógica de cálculo por impresora extraída de facturacion.service.js para
// poder reutilizarla en DOS sitios sin duplicar reglas de negocio:
//   1. La importación de CSV (puente lecturas → consumos_mensuales).
//   2. La emisión de facturas (facturacion.service).
//
// Es PURO: no toca la BD. Recibe como parámetros la última lectura, los
// precios de la impresora y las líneas de contrato; el llamante se encarga
// de obtenerlos (con el pool o con la conexión de una transacción).
//
// Diferencia contra la última lectura, gestión de negativos/resets/lecturas 
// desordenadas, reparto por porcentaje de participación, copias incluidas y
// precio mínimo mensual.

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function nombreMes(periodo) {
  const [anio, mes] = periodo.split('-');
  return `${MESES[parseInt(mes, 10) - 1]} ${anio}`;
}

function timestampMesSiguiente(periodo) {
  let [anio, mes] = periodo.split('-').map(Number);
  if (mes === 12) { anio += 1; mes = 1; } else { mes += 1; }
  return Math.floor(new Date(anio, mes - 1, 1).getTime() / 1000);
}

function toInt(v) {
  const n = parseInt(String(v ?? 0).replace(/[.,]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function toFloat(v, def = 0) {
  const n = parseFloat(v ?? def);
  return Number.isFinite(n) ? n : def;
}

function parsearFecha(valor) {
  if (!valor) return null;
  // Kyofleet format: '22/04/2026-10:51:39' (dash between date and time)
  let v = String(valor).trim();
  if (v.includes('/') && v.includes('-')) v = v.replace('-', ' ');
  for (const fmt of [
    /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  ]) {
    const m = v.match(fmt);
    if (m) {
      // dd/mm/yyyy hh:mm:ss
      if (m[3].length === 4) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`);
      // yyyy-mm-dd hh:mm:ss
      return new Date(v);
    }
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ── Motor por impresora ───────────────────────────────────────────────────
// Devuelve un array de resultados (uno por empresa participante; con contrato
// compartido habrá varios). Cada resultado lleva estado, detalle y
// lineas_factura. NO consulta la BD: recibe ultimaLectura/preciosImpresora/
// contratoLineas ya resueltos por el llamante.
//
// Parámetros:
//   fila            { serial_number, modelo, empresa_nombre, bn_total,
//                     color_total, color1_total, color2_total, color3_total,
//                     color_niv2_total, color_niv3_total, fecha_lectura }
//   periodo         'YYYY-MM'
//   preciosImpresora fila de impresoras (precio_copia_bn, ...) o null
//   ultimaLectura   última fila de registros_contadores o null (primera lectura)
//   contratoLineas  array de líneas de contrato_impresoras (puede ser [])
function procesarImpresora({ fila, periodo, preciosImpresora, ultimaLectura, contratoLineas }) {
  const serial  = fila.serial_number;
  const modelo  = fila.modelo || serial;
  const empresa = fila.empresa_nombre;

  const bnActual     = toInt(fila.bn_total);
  const colorActual  = toInt(fila.color_total);
  const c1Actual     = toInt(fila.color1_total);
  const c2Actual     = toInt(fila.color2_total);
  const c3Actual     = toInt(fila.color3_total);
  const niv2Actual   = toInt(fila.color_niv2_total);
  const niv3Actual   = toInt(fila.color_niv3_total);
  const fechaLecturaCSV = parsearFecha(fila.fecha_lectura);

  // Detect billing type from what's populated in the CSV
  const tieneColor = colorActual > 0;
  const esMulticolor = tieneColor && (niv2Actual > 0 || niv3Actual > 0);

  let tipoDetectado, c1Eff, c2Eff, c3Eff;
  if (esMulticolor) {
    tipoDetectado = 'BN_MULTICOLOR';
    c1Eff = c1Actual || colorActual;
    c2Eff = niv2Actual;
    c3Eff = niv3Actual;
  } else if (tieneColor) {
    tipoDetectado = 'BN_AND_COLOR';
    c1Eff = colorActual;
    c2Eff = 0;
    c3Eff = 0;
  } else {
    tipoDetectado = 'BN_ONLY';
    c1Eff = 0;
    c2Eff = 0;
    c3Eff = 0;
  }

  // Plantilla común a cada resultado generado por esta impresora.
  const baseResultado = () => ({
    serial_number: serial,
    modelo,
    empresa,
    periodo,
    fecha_lectura: fila.fecha_lectura || null,
    estado: null,
    detalle: {},
    lineas_factura: [],
  });

  if (!preciosImpresora) {
    const r = baseResultado();
    r.estado = 'sin_precio';
    r.detalle.msg = 'Sin precio en BD para esta impresora.';
    return [r];
  }

  // Última lectura en BD
  const ultima = ultimaLectura;
  const esPrimeraLectura = !ultima;

  let bnAnterior, c1Anterior, c2Anterior, c3Anterior, contadorNegativoAnterior;
  let copiasBNBruto, copiasC1Bruto;
  const avisos = {};

  if (esPrimeraLectura) {
    bnAnterior = 0; c1Anterior = 0; c2Anterior = 0; c3Anterior = 0;
    contadorNegativoAnterior = false;
    copiasBNBruto = bnActual;
    copiasC1Bruto = c1Eff;
    avisos.primera_lectura = true;
  } else {
    bnAnterior  = toInt(ultima.copias_bn_total);
    c1Anterior  = toInt(ultima.copias_color1_total);
    c2Anterior  = toInt(ultima.copias_color2_total);
    c3Anterior  = toInt(ultima.copias_color3_total);
    contadorNegativoAnterior = Boolean(ultima.contador_negativo);

    // Skip out-of-order readings (CSV date older than last DB reading)
    const fechaUltimaBD = ultima.fecha_lectura instanceof Date
      ? ultima.fecha_lectura
      : parsearFecha(ultima.fecha_lectura);

    if (fechaLecturaCSV && fechaUltimaBD && fechaLecturaCSV < fechaUltimaBD) {
      const r = baseResultado();
      r.estado = 'lectura_desordenada';
      r.detalle.msg = `Fecha CSV (${fila.fecha_lectura}) anterior a última BD (${fechaUltimaBD.toISOString()}).`;
      return [r];
    }

    copiasBNBruto = bnActual - bnAnterior;
    copiasC1Bruto = c1Eff - c1Anterior;
  }

  // Handle negative counters (reset)
  if (copiasBNBruto < 0 && copiasC1Bruto < 0) {
    const r = baseResultado();
    r.estado = 'contador_negativo';
    r.detalle = {
      msg: 'Reset total de contadores. 0 copias este mes.',
      bn_anterior: bnAnterior, bn_actual: bnActual, copias_bn_bruto: copiasBNBruto,
      c1_anterior: c1Anterior, c1_actual: c1Eff,    copias_c1_bruto: copiasC1Bruto,
    };
    return [r];
  }
  if (copiasBNBruto < 0) { avisos.aviso_bn_negativo = copiasBNBruto; copiasBNBruto = 0; }
  if (copiasC1Bruto < 0) { avisos.aviso_color_negativo = copiasC1Bruto; copiasC1Bruto = 0; }
  if (contadorNegativoAnterior) {
    copiasBNBruto = 0; copiasC1Bruto = 0; avisos.absorbe_negativo = true;
  }

  // Copias C2/C3 brutas del mes (solo multicolor)
  const copC2Bruto = tipoDetectado === 'BN_MULTICOLOR' ? Math.max(0, c2Eff - c2Anterior) : 0;
  const copC3Bruto = tipoDetectado === 'BN_MULTICOLOR' ? Math.max(0, c3Eff - c3Anterior) : 0;

  // ── Objetivos de facturación ────────────────────────────────────────────
  // Con contrato: una línea por empresa participante (reparte por porcentaje y
  // descuenta las copias incluidas DE CADA empresa sobre su parte). Sin contrato:
  // un único objetivo al 100% con los precios de la impresora.
  const lineas = contratoLineas || [];
  const pBN = toFloat(preciosImpresora.precio_copia_bn);
  const pC1 = toFloat(preciosImpresora.precio_copia_color1);
  const pC2 = toFloat(preciosImpresora.precio_copia_color2) || pC1;
  const pC3 = toFloat(preciosImpresora.precio_copia_color3) || pC1;

  let objetivos;
  if (lineas.length > 0) {
    objetivos = lineas.map((l) => ({
      empresa: l.empresa_nombre || empresa,
      contrato: true,
      numero_contrato: l.numero_contrato,
      // Precio de contrato si lo define; si es null/0, cae al precio de impresora.
      precioBN: toFloat(l.precio_bn) || pBN,
      precioC1: toFloat(l.precio_color1) || pC1,
      precioC2: toFloat(l.precio_color2) || pC2,
      precioC3: toFloat(l.precio_color3) || pC3,
      pct: toFloat(l.porcentaje_participacion, 100) / 100,
      inclBN: toInt(l.copias_bn_incluidas),
      inclC1: toInt(l.copias_c1_incluidas),
      inclC2: toInt(l.copias_c2_incluidas),
      inclC3: toInt(l.copias_c3_incluidas),
      minimo: toFloat(l.precio_minimo_mensual),
    }));
  } else {
    objetivos = [{
      empresa, contrato: false, numero_contrato: null,
      precioBN: pBN, precioC1: pC1, precioC2: pC2, precioC3: pC3,
      pct: 1, inclBN: 0, inclC1: 0, inclC2: 0, inclC3: 0, minimo: 0,
      tipo_facturacion_bd: preciosImpresora.tipo_facturacion,
    }];
  }

  const compartido = objetivos.length > 1;
  const mesTxt = nombreMes(periodo);
  const _linea = (tipo, ant, act, qty, precio, pct) => ({
    tipo,
    desc: `Periodo: ${mesTxt}<br>\nCopias ${tipo} - ${modelo} (SN: ${serial})`
        + (pct < 1 ? `<br>\nParticipación: ${Math.round(pct * 100)}%` : '')
        + `<br>\nLectura anterior: ${ant.toLocaleString('es-ES')} ${tipo}`
        + `<br>\nLectura actual: ${act.toLocaleString('es-ES')} ${tipo}`,
    qty,
    subprice: Math.round(precio * 1000000) / 1000000,
    product_type: 1,
    tva_tx: 21.0,
    remise_percent: 0,
  });

  const resultados = [];
  for (const o of objetivos) {
    // Parte de copias de esta empresa = bruto * porcentaje, menos SUS incluidas.
    const copiasBN = Math.max(0, Math.round(copiasBNBruto * o.pct) - o.inclBN);
    const copiasC1 = Math.max(0, Math.round(copiasC1Bruto * o.pct) - o.inclC1);
    const copC2    = Math.max(0, Math.round(copC2Bruto * o.pct) - o.inclC2);
    const copC3    = Math.max(0, Math.round(copC3Bruto * o.pct) - o.inclC3);

    // Sin consumo para esta empresa (y no es primera lectura) → se excluye.
    if (copiasBN === 0 && copiasC1 === 0 && copC2 === 0 && copC3 === 0 && !esPrimeraLectura) {
      const r = baseResultado();
      r.empresa = o.empresa;
      r.estado = 'sin_consumo';
      r.detalle = { ...avisos, msg: 'Diferencia 0 copias.', contrato: o.contrato,
        numero_contrato: o.numero_contrato, participacion: o.pct,
        bn_anterior: bnAnterior, bn_actual: bnActual };
      resultados.push(r);
      continue;
    }

    const importeBN = Math.round(copiasBN * o.precioBN * 10000) / 10000;
    const importeC1 = Math.round(copiasC1 * o.precioC1 * 10000) / 10000;
    const importeC2 = Math.round(copC2 * o.precioC2 * 10000) / 10000;
    const importeC3 = Math.round(copC3 * o.precioC3 * 10000) / 10000;
    let importeTotal = Math.round((importeBN + importeC1 + importeC2 + importeC3) * 100) / 100;

    const minimoAplicado = o.minimo && importeTotal < o.minimo;
    if (minimoAplicado) importeTotal = o.minimo;

    const r = baseResultado();
    r.empresa = o.empresa;
    r.estado = 'facturable';
    r.detalle = {
      ...avisos,
      contrato: o.contrato,
      numero_contrato: o.numero_contrato,
      compartida: compartido,
      participacion: o.pct,
      precio_minimo: o.minimo,
      precio_minimo_aplicado: Boolean(minimoAplicado),
      tipo_facturacion_detectado: tipoDetectado,
      tipo_facturacion_bd: o.tipo_facturacion_bd,
      bn_anterior: bnAnterior, bn_actual: bnActual, copias_bn: copiasBN, precio_bn: o.precioBN,
      c1_anterior: c1Anterior, c1_actual: c1Eff,    copias_c1: copiasC1, precio_c1: o.precioC1,
      copias_c2: copC2, copias_c3: copC3,
      importe_bn: importeBN, importe_c1: importeC1, importe_c2: importeC2, importe_c3: importeC3,
      importe_total: importeTotal,
    };

    if (copiasBN > 0) r.lineas_factura.push(_linea('BN', bnAnterior, bnActual, copiasBN, o.precioBN, o.pct));
    if (tipoDetectado === 'BN_MULTICOLOR') {
      if (copiasC1 > 0) r.lineas_factura.push(_linea('COLOR1', c1Anterior, c1Eff, copiasC1, o.precioC1, o.pct));
      if (copC2 > 0)    r.lineas_factura.push(_linea('COLOR2', c2Anterior, c2Eff, copC2, o.precioC2, o.pct));
      if (copC3 > 0)    r.lineas_factura.push(_linea('COLOR3', c3Anterior, c3Eff, copC3, o.precioC3, o.pct));
    } else if (tipoDetectado === 'BN_AND_COLOR') {
      if (copiasC1 > 0) r.lineas_factura.push(_linea('COLOR', c1Anterior, c1Eff, copiasC1, o.precioC1, o.pct));
    }

    resultados.push(r);
  }

  return resultados;
}

module.exports = {
  procesarImpresora,
  nombreMes,
  timestampMesSiguiente,
  toInt,
  toFloat,
  parsearFecha,
};
