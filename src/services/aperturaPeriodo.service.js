// La lectura de "apertura" de un periodo debe ser el CIERRE del periodo
// anterior YA CALCULADO para esa impresora (consumos_mensuales.contador_*_fin),
// no "la fila más reciente de registros_contadores anterior a tal fecha".
//
// Por qué: cuando una impresora deja de comunicar (Kyofleet sigue exportando
// su última lectura conocida, sin cambios, mes tras mes), esa misma lectura
// antigua puede ser "la más reciente antes del periodo" para VARIOS periodos
// seguidos. Derivar la apertura por fecha cruda hacía que cada periodo
// recalculara el delta contra ese mismo historial desde cero — en vez de
// reconocer que ese consumo ya se facturó el mes anterior, algunos casos
// volvían a salir con el delta completo otra vez (doble facturación real,
// detectado 2026-08-11 con la impresora V7F7106184: la misma lectura de
// 23/08/2025 se facturó en 2026-06 Y en 2026-07 como si fueran dos consumos
// distintos).
//
// Encadenar por periodo (cierre de N-1 = apertura de N) es robusto ante
// timestamps de lectura antiguos/repetidos: si el contador no se movió desde
// el cierre anterior, el delta sale 0 sin importar qué fecha traiga el CSV.
async function obtenerLecturaApertura(querier, impresora_id, periodo) {
  const [rows] = await querier.query(
    `SELECT contador_bn_fin AS copias_bn_total,
            contador_color1_fin AS copias_color1_total,
            contador_color2_fin AS copias_color2_total,
            contador_color3_fin AS copias_color3_total
     FROM consumos_mensuales
     WHERE impresora_id = ? AND periodo < ? AND contador_bn_fin IS NOT NULL
     ORDER BY periodo DESC LIMIT 1`,
    [impresora_id, periodo],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    copias_bn_total: r.copias_bn_total,
    copias_color1_total: r.copias_color1_total,
    copias_color2_total: r.copias_color2_total,
    copias_color3_total: r.copias_color3_total,
    // Sin fecha real (es un cierre, no una lectura física) y sin negativo
    // heredado: si el periodo anterior absorbió un reset, su contador_fin ya
    // quedó en el valor post-reset correcto.
    fecha_lectura: null,
    contador_negativo: false,
  };
}

module.exports = { obtenerLecturaApertura };
