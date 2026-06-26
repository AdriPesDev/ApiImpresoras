const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;

// ── Paleta de colores ─────────────────────────────────────────────────────────
const C = {
  navy:        'FF1B3A6B',
  navyLight:   'FFD6E0F0',
  green:       'FF1E5C2D',
  greenMid:    'FF2D8A4D',
  greenLight:  'FFD6F0DC',
  orange:      'FFC25A00',
  orangeLight: 'FFFCE8D5',
  gray:        'FF3D3D3D',
  grayLight:   'FFD9D9D9',
  red:         'FFCC0000',
  redLight:    'FFFFD6D6',
  amber:       'FFF0A500',
  white:       'FFFFFFFF',
  black:       'FF000000',
};

function fmtFecha(valor) {
  if (!valor) return '';
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return String(valor);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ── Helpers de estilo ─────────────────────────────────────────────────────────
function fill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
function font(opts = {}) {
  const { color: colorArg, size, bold, ...rest } = opts;
  return { name: 'Arial', size: size || 11, bold: bold || false, color: { argb: colorArg || C.black }, ...rest };
}
function border(color = 'FFBFBFBF', style = 'thin') {
  const s = { style, color: { argb: color } };
  return { top: s, left: s, bottom: s, right: s };
}
function align(h = 'left', v = 'middle') {
  return { horizontal: h, vertical: v, wrapText: false };
}

// Aplica estilo a un rango de celdas
function styleRange(ws, startRow, startCol, endRow, endCol, style) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      Object.assign(ws.getCell(r, c), style);
    }
  }
}

// ── HOJA RESUMEN ──────────────────────────────────────────────────────────────
function crearHojaResumen(wb, resultado, meta) {
  const ws = wb.addWorksheet('Resumen');
  ws.views = [{ showGridLines: false }];

  const periodo  = resultado.periodo;
  const resumen  = resultado.resumen;
  const estados  = resumen.estados_impresoras || {};

  const nNegIgn      = estados.contador_negativo_ignorado || 0; // alias usado en resumen
  // 'facturable' incluye las de negativo ignorado; se restan para que el conteo
  // coincida con la hoja "✅ Facturadas" (que las separa en su propia hoja).
  const nFacturadas  = Math.max(0, (estados.facturable || 0) - nNegIgn);
  const nSinConsumo  = estados.sin_consumo           || 0;
  const nSinEmpresa  = estados.sin_empresa_dolibarr  || 0;
  const nSinPrecio   = estados.sin_precio            || 0;

  // Anchos de columna (5 cols: A-E)
  ws.columns = [
    { width: 36 }, // A — etiquetas / Total impresoras
    { width: 15 }, // B — Importe KPI (###### grande pero oculto) / parte de "Nº impresoras" merge
    { width: 22 }, // C — Facturas creadas / parte de "Nº impresoras" merge
    { width: 22 }, // D — Facturas con error / parte de "Acción" merge
    { width: 28 }, // E — Sin empresa Dolibarr / parte de "Acción" merge
  ];

  // Fila 1: Título principal
  ws.mergeCells('A1:E1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `REPORTE DE FACTURACIÓN — Período ${periodo}`;
  titleCell.font      = font({ size: 18, bold: true, color: C.white });
  titleCell.fill      = fill(C.navy);
  titleCell.alignment = align('center');
  ws.getRow(1).height = 36;

  // Fila 2: separador
  ws.getRow(2).height = 6;

  // Filas 3–6: Metadatos
  const meta_ = [
    ['Origen CSV', meta.origenCsv || 'N/D'],
    ['Modo',       meta.modo || 'BD'],
    ['Generado',   resultado.generado || new Date().toISOString()],
    ['Fecha reporte', fmtFecha(new Date())],
  ];
  meta_.forEach(([label, val], i) => {
    const row = 3 + i;
    ws.getCell(row, 1).value     = label;
    ws.getCell(row, 1).fill      = fill(C.navyLight);
    ws.getCell(row, 1).font      = font({ bold: true, color: C.navy });
    ws.getCell(row, 1).alignment = align('right');
    ws.mergeCells(row, 2, row, 5);
    ws.getCell(row, 2).value     = val;
    ws.getCell(row, 2).font      = font(); // valor sobre blanco, texto negro
    ws.getCell(row, 2).alignment = align('left');
  });

  // Fila 7: separador
  ws.getRow(7).height = 6;

  // Filas 8–10: Tabla KPIs (5 cajas claras, una por indicador)
  // Cada caja = etiqueta (fila 9) + valor (fila 10) con el MISMO fondo claro,
  // texto oscuro y borde medium del color oscuro. Fila 8 = hueco superior.
  // (Sin raya blanca ni fila separadora diminuta como antes.)
  const kpiBoxes = [
    { label: 'Total impresoras',        bg: C.navyLight,   fg: C.navy   },
    { label: 'Importe total\nestimado', bg: C.orangeLight, fg: C.orange },
    { label: 'Facturas creadas',        bg: C.greenLight,  fg: C.green  },
    { label: 'Facturas con error',      bg: C.redLight,    fg: C.red    },
    { label: 'Sin empresa Dolibarr',    bg: C.orangeLight, fg: C.orange },
  ];
  const kpiValues = [
    resumen.total_impresoras,
    resumen.importe_total_estimado,
    resumen.facturas_creadas,
    resumen.facturas_error_envio || 0,
    resumen.empresas_no_en_dolibarr || 0,
  ];

  ws.getRow(8).height  = 12; // hueco superior
  ws.getRow(9).height  = 42; // etiquetas
  ws.getRow(10).height = 26; // valores

  kpiBoxes.forEach((k, i) => {
    const col = i + 1; // A-E

    // Etiqueta (fila 9)
    const hCell = ws.getCell(9, col);
    hCell.value     = k.label;
    hCell.fill      = fill(k.bg);
    hCell.font      = font({ size: 11, bold: true, color: k.fg });
    hCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    hCell.border    = border(k.fg, 'medium');

    // Valor (fila 10)
    const vCell = ws.getCell(10, col);
    vCell.value     = kpiValues[i];
    vCell.fill      = fill(k.bg);
    vCell.font      = font({ size: 20, bold: true, color: k.fg });
    vCell.alignment = align('center');
    vCell.border    = border(k.fg, 'medium');
    // El importe (col B=2) es numérico real pero la columna es estrecha → Excel
    // muestra ###### (oculto pero grande y centrado).
    if (i === 1) {
      vCell.numFmt = '#,##0.00';
    }
  });

  // Filas 11–12: separador
  ws.getRow(11).height = 6;
  ws.getRow(12).height = 6;

  // Fila 13: Cabecera tabla categorías
  // — sin border para evitar el subrayado blanco sobre las filas de datos
  // — "Nº impresoras" fusiona B+C (así cabe el texto y la col B puede ser estrecha para el KPI)
  // — "Acción recomendada" fusiona D+E
  const catHeaderDefs = [
    { col: 1, text: 'Categoría' },
    { col: 2, text: 'Nº impresoras', merge: [13, 2, 13, 3] },
    { col: 4, text: 'Acción recomendada', merge: [13, 4, 13, 5] },
  ];
  catHeaderDefs.forEach(({ col, text, merge }) => {
    if (merge) ws.mergeCells(...merge);
    const cell = ws.getCell(13, col);
    cell.value     = text;
    cell.fill      = fill(C.navy);
    cell.font      = font({ bold: true, color: C.white });
    cell.alignment = align('center');
  });
  ws.getRow(13).height = 22;

  // Filas 14–18: categorías
  const cats = [
    { icon: '✅', label: 'Facturadas correctamente',    n: nFacturadas, accion: 'Ninguna — facturado correctamente',                    bg: C.greenLight,  fontC: C.green },
    { icon: '⚠️', label: 'Contador negativo ignorado',  n: nNegIgn,     accion: 'Revisar si procede ajuste manual en la factura',         bg: C.orangeLight, fontC: C.orange },
    { icon: '■',  label: 'Sin consumo (0 copias)',       n: nSinConsumo, accion: 'Verificar si la máquina está operativa',                 bg: C.grayLight,   fontC: C.gray },
    { icon: '✗',  label: 'Sin empresa en Dolibarr',     n: nSinEmpresa, accion: 'Crear/corregir el tercero en Dolibarr y refacturar',     bg: C.redLight,    fontC: C.red },
    { icon: '⚠️', label: 'Sin precio en BD',            n: nSinPrecio,  accion: 'Registrar precio en BD y refacturar',                   bg: C.orangeLight, fontC: C.orange },
  ];

  cats.forEach((cat, i) => {
    const row = 14 + i;
    ws.getRow(row).height = 20;

    const cA = ws.getCell(row, 1);
    cA.value     = `${cat.icon} ${cat.label}`;
    cA.fill      = fill(cat.bg);
    cA.font      = font({ bold: true, color: cat.fontC });
    cA.alignment = align('left');
    cA.border    = border();

    ws.mergeCells(row, 2, row, 3); // B-C: conteo
    const cB = ws.getCell(row, 2);
    cB.value     = cat.n;
    cB.fill      = fill(cat.bg);
    cB.font      = font({ size: 12, bold: true, color: cat.fontC });
    cB.alignment = align('center');
    cB.border    = border();

    ws.mergeCells(row, 4, row, 5); // D-E: acción
    const cC = ws.getCell(row, 4);
    cC.value     = cat.accion;
    cC.fill      = fill(cat.bg);
    cC.font      = font({ color: cat.fontC });
    cC.alignment = align('left');
    cC.border    = border();
  });
}

// ── HOJA DETALLE (Facturadas / Neg. ignorado / Sin consumo) ──────────────────
function crearHojaDetalle(wb, nombre, titulo, subtitulo, impresoras, colorPrincipal, colorLight) {
  const ws = wb.addWorksheet(nombre);
  ws.views = [{ showGridLines: false }];

  ws.columns = [
    { width: 28 }, // A Empresa
    { width: 16 }, // B Serial
    { width: 22 }, // C Modelo
    { width: 22 }, // D Fecha anterior
    { width: 22 }, // E Fecha actual
    { width: 13 }, // F BN anterior
    { width: 13 }, // G BN actual
    { width: 12 }, // H Copias BN
    { width: 12 }, // I Copias color
    { width: 12 }, // J Precio BN
    { width: 12 }, // K Precio color
    { width: 13 }, // L Importe (€)
    { width: 13 }, // M ID Dolibarr
    { width: 35 }, // N Observaciones
  ];

  // Fila 1: Título
  ws.mergeCells('A1:N1');
  const t = ws.getCell('A1');
  t.value     = titulo;
  t.fill      = fill(colorPrincipal);
  t.font      = font({ size: 14, bold: true, color: C.white });
  t.alignment = align('center');
  ws.getRow(1).height = 28;

  // Fila 2: subtítulo
  ws.mergeCells('A2:N2');
  const s = ws.getCell('A2');
  s.value     = subtitulo;
  s.font      = font({ size: 10, color: C.gray });
  s.alignment = align('center');
  ws.getRow(2).height = 18;

  // Fila 3: vacía
  ws.getRow(3).height = 6;

  // Fila 4: cabeceras
  const headers = [
    'Empresa', 'Serial', 'Modelo', 'Fecha anterior', 'Fecha actual',
    'BN anterior', 'BN actual', 'Copias BN', 'Copias color',
    'Precio BN', 'Precio color', 'Importe (€)', 'ID Dolibarr', 'Observaciones',
  ];
  ws.getRow(4).height = 22;
  headers.forEach((h, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value     = h;
    cell.fill      = fill(colorPrincipal);
    cell.font      = font({ bold: true, color: C.white, size: 10 });
    cell.alignment = align('center');
    cell.border    = border(C.white);
  });

  // Datos
  impresoras.forEach((imp, idx) => {
    const row = 5 + idx;
    const bg  = idx % 2 === 0 ? C.white : colorLight;
    ws.getRow(row).height = 18;

    const d = imp.detalle || {};
    const obs = construirObservaciones(d);

    const vals = [
      imp.empresa,
      imp.serial_number,
      imp.modelo,
      fmtFecha(imp.fecha_anterior),
      fmtFecha(imp.fecha_lectura),
      d.bn_anterior ?? 0,
      d.bn_actual   ?? 0,
      d.copias_bn   ?? 0,
      d.copias_c1   ?? 0,
      d.precio_bn   ?? 0,
      d.precio_c1   ?? 0,
      d.importe_total ?? 0,
      imp._idFactura ?? '',
      obs,
    ];

    vals.forEach((v, i) => {
      const cell    = ws.getCell(row, i + 1);
      cell.value    = v;
      cell.fill     = fill(bg);
      cell.font     = font({ size: 10 });
      cell.border   = border();
      cell.alignment = align(typeof v === 'number' ? 'right' : 'left');
      // Formato numérico
      if (i === 9 || i === 10) cell.numFmt = '0.0000€';  // precios
      if (i === 11) cell.numFmt = '#,##0.00€';             // importe
    });
  });
}

// ── HOJA SIMPLE (Sin empresa / Sin precio) ────────────────────────────────────
function crearHojaSimple(wb, nombre, titulo, subtitulo, impresoras, colorPrincipal, colorLight) {
  const ws = wb.addWorksheet(nombre);
  ws.views = [{ showGridLines: false }];

  ws.columns = [
    { width: 30 }, // A Empresa
    { width: 16 }, // B Serial
    { width: 22 }, // C Modelo
    { width: 22 }, // D Estado
    { width: 13 }, // E BN anterior
    { width: 13 }, // F BN actual
    { width: 45 }, // G Motivo
  ];

  // Fila 1: Título
  ws.mergeCells('A1:G1');
  const t = ws.getCell('A1');
  t.value     = titulo;
  t.fill      = fill(colorPrincipal);
  t.font      = font({ size: 14, bold: true, color: C.white });
  t.alignment = align('center');
  ws.getRow(1).height = 28;

  // Fila 2: subtítulo
  ws.mergeCells('A2:G2');
  const s = ws.getCell('A2');
  s.value     = subtitulo;
  s.font      = font({ size: 10, color: C.gray });
  s.alignment = align('center');
  ws.getRow(2).height = 18;

  // Fila 3: vacía
  ws.getRow(3).height = 6;

  // Fila 4: cabeceras
  const headers = ['Empresa', 'Serial', 'Modelo', 'Estado', 'BN anterior', 'BN actual', 'Motivo'];
  ws.getRow(4).height = 22;
  headers.forEach((h, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value     = h;
    cell.fill      = fill(colorPrincipal);
    cell.font      = font({ bold: true, color: C.white, size: 10 });
    cell.alignment = align('center');
    cell.border    = border(C.white);
  });

  // Datos
  impresoras.forEach((imp, idx) => {
    const row = 5 + idx;
    const bg  = idx % 2 === 0 ? C.white : colorLight;
    ws.getRow(row).height = 18;

    const d = imp.detalle || {};
    const vals = [
      imp.empresa,
      imp.serial_number,
      imp.modelo,
      imp.estado,
      d.bn_anterior ?? 0,
      d.bn_actual   ?? 0,
      d.msg || imp.estado,
    ];

    vals.forEach((v, i) => {
      const cell    = ws.getCell(row, i + 1);
      cell.value    = v;
      cell.fill     = fill(bg);
      cell.font     = font({ size: 10 });
      cell.border   = border();
      cell.alignment = align(typeof v === 'number' ? 'right' : 'left');
    });
  });
}

// ── Observaciones para Neg. ignorado ─────────────────────────────────────────
function construirObservaciones(detalle) {
  const partes = [];
  if (detalle.aviso_bn_negativo != null) {
    partes.push(`BN negativo (${detalle.aviso_bn_negativo}), ignorado`);
  }
  if (detalle.aviso_color_negativo != null) {
    partes.push(`Color1 negativo (${detalle.aviso_color_negativo}), ignorado`);
  }
  if (detalle.absorbe_negativo) {
    partes.push('Absorbe negativo del mes anterior');
  }
  return partes.join('; ');
}

// ── Función principal exportada ───────────────────────────────────────────────
async function generarReporteExcel(resultado, meta = {}) {
  const periodo = resultado.periodo;

  // Separar impresoras facturadas vs neg. ignorado
  const facturadas  = [];
  const negIgnorado = [];
  const idsPorSerial = meta.idsPorSerial || null;
  for (const factura of (resultado.facturas_por_empresa || [])) {
    for (const imp of (factura.impresoras || [])) {
      imp._socid = factura.socid;
      // ID de factura REALMENTE emitida en esta ejecución (vacío si la impresora
      // es facturable pero no se emitió en este run).
      imp._idFactura = (idsPorSerial && idsPorSerial.get(imp.serial_number)) || '';
      const d = imp.detalle || {};
      if (d.aviso_bn_negativo != null || d.aviso_color_negativo != null) {
        negIgnorado.push(imp);
      } else {
        facturadas.push(imp);
      }
    }
  }

  // Inyectar conteo de neg. ignorado en el resumen para la hoja Resumen
  if (resultado.resumen && !resultado.resumen.estados_impresoras.contador_negativo_ignorado) {
    resultado.resumen.estados_impresoras.contador_negativo_ignorado = negIgnorado.length;
  }

  const excluidas   = resultado.impresoras_excluidas || [];
  const sinConsumo  = excluidas.filter((r) => r.estado === 'sin_consumo');
  const sinEmpresa  = excluidas.filter((r) => r.estado === 'sin_empresa_dolibarr');
  const sinPrecio   = excluidas.filter((r) => r.estado === 'sin_precio');

  const wb = new ExcelJS.Workbook();
  wb.creator  = 'ApiImpresoras';
  wb.created  = new Date();
  wb.modified = new Date();

  // Hoja 1: Resumen
  crearHojaResumen(wb, resultado, meta);

  // Hoja 2: Facturadas
  crearHojaDetalle(
    wb,
    '✅ Facturadas',
    `IMPRESORAS FACTURADAS CORRECTAMENTE — ${periodo}`,
    `${facturadas.length} impresoras incluidas en facturas enviadas a Dolibarr.`,
    facturadas,
    C.green,
    C.greenLight,
  );

  // Hoja 3: Neg. ignorado
  crearHojaDetalle(
    wb,
    '⚠️ Neg. ignorado',
    `CONTADORES NEGATIVOS IGNORADOS — ${periodo}`,
    'Se facturó el componente positivo. El negativo fue ignorado. Revisar si procede ajuste.',
    negIgnorado,
    C.orange,
    C.orangeLight,
  );

  // Hoja 4: Sin consumo
  crearHojaDetalle(
    wb,
    '■ Sin consumo',
    `IMPRESORAS SIN CONSUMO — ${periodo}`,
    'Diferencia 0 entre lecturas. Incluidas en factura con €0. Verificar si la máquina está operativa.',
    sinConsumo,
    C.gray,
    C.grayLight,
  );

  // Hoja 5: Sin empresa
  crearHojaSimple(
    wb,
    '✗ Sin empresa',
    `SIN EMPRESA EN DOLIBARR — ${periodo}`,
    'No se encontró el tercero en Dolibarr. No se ha facturado. Crear empresa y refacturar.',
    sinEmpresa,
    C.red,
    C.redLight,
  );

  // Hoja 6: Sin precio
  crearHojaSimple(
    wb,
    '⚠️ Sin precio',
    `SIN PRECIO EN BASE DE DATOS — ${periodo}`,
    'La impresora no tiene precio registrado en la BD. No se ha facturado.',
    sinPrecio,
    C.orange,
    C.orangeLight,
  );

  // Guardar archivo
  const timestamp = fmtTimestamp();
  const nombre    = `reporte_${periodo}_${timestamp}.xlsx`;
  const exportsDir = path.join(process.cwd(), 'exports');
  await fs.mkdir(exportsDir, { recursive: true });
  const ruta = path.join(exportsDir, nombre);
  await wb.xlsx.writeFile(ruta);

  return { nombre, ruta };
}

module.exports = { generarReporteExcel };
