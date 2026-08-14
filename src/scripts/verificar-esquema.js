// Script de SOLO LECTURA — compara el esquema real de la BD (usando las
// credenciales que ya tiene la API en su .env) contra lo que el código
// espera, y muestra qué columnas faltan. No modifica nada.
//
// Uso (en el servidor, dentro de /var/www/control-impresoras-api):
//   node src/scripts/verificar-esquema.js

require("dotenv").config();
const mysql = require("mysql2/promise");

const ESPERADAS = {
  consumos_mensuales: [
    "primera_lectura_confirmada",
    "contador_bn_inicio",
    "contador_bn_fin",
    "contador_color1_inicio",
    "contador_color1_fin",
    "contador_color2_inicio",
    "contador_color2_fin",
    "contador_color3_inicio",
    "contador_color3_fin",
  ],
  empresas: ["excluir_facturacion"],
  contratos: ["factura_separada"],
};

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log(`Conectado a ${process.env.DB_HOST}/${process.env.DB_NAME}\n`);

  let faltanAlgo = false;
  for (const [tabla, columnas] of Object.entries(ESPERADAS)) {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tabla],
    );
    const existentes = new Set(rows.map((r) => r.COLUMN_NAME));
    const faltan = columnas.filter((c) => !existentes.has(c));
    if (faltan.length) {
      faltanAlgo = true;
      console.log(`❌ ${tabla}: FALTAN → ${faltan.join(", ")}`);
    } else {
      console.log(`✅ ${tabla}: todas las columnas esperadas existen`);
    }
  }

  console.log(
    faltanAlgo
      ? "\nHay columnas que faltan — pásale este resultado a Claude para generar el ALTER TABLE exacto."
      : "\nTodo al día, no hace falta migrar nada.",
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
