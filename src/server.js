const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");

// Importar configuración
const { pool, testConnection } = require("./config/database");

// Importar middleware
const { limiter, writeLimiter } = require("./middleware/rateLimit.middleware");
const authMiddleware = require("./middleware/auth.middleware");
const errorMiddleware = require("./middleware/error.middleware");

// Importar controladores
const EmpresaController = require("./controllers/empresa.controller");
const ImpresoraController = require("./controllers/impresora.controller");
const RegistroController = require("./controllers/registro.controller");
const ConsumoController = require("./controllers/consumo.controller");
const DashboardController = require("./controllers/dashboard.controller");
const ContratoController = require("./controllers/contrato.controller");

// Importar fábricas de rutas
const createEmpresaRoutes = require("./routes/empresa.routes");
const createImpresoraRoutes = require("./routes/impresora.routes");
const createRegistroRoutes = require("./routes/registro.routes");
const createConsumoRoutes = require("./routes/consumo.routes");
const createDashboardRoutes = require("./routes/dashboard.routes");
const createContratoRoutes = require("./routes/contrato.routes");

// Configurar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware globales
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  }),
);
app.use(morgan("dev"));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// Rate limiting
/**
app.use("/api/", limiter);
app.use("/api/empresas/bulk", writeLimiter);
app.use("/api/impresoras/bulk", writeLimiter);
app.use("/api/registros/bulk", writeLimiter);
app.use("/api/consumos/calcular/:periodo", writeLimiter);
*/

// Autenticación (opcional)
if (process.env.NODE_ENV === "production") {
  app.use("/api/", authMiddleware);
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
});

// Inicializar controladores con la pool de conexiones
const empresaController = new EmpresaController(pool);
const impresoraController = new ImpresoraController(pool);
const registroController = new RegistroController(pool);
const consumoController = new ConsumoController(pool);
const dashboardController = new DashboardController(pool);
const contratoController = new ContratoController(pool);

// Configurar rutas
app.use("/api/empresas", createEmpresaRoutes(empresaController));
app.use("/api/impresoras", createImpresoraRoutes(impresoraController));
app.use("/api/registros", createRegistroRoutes(registroController));
app.use("/api/consumos", createConsumoRoutes(consumoController));
app.use("/api/dashboard", createDashboardRoutes(dashboardController));
app.use("/api/contratos", createContratoRoutes(contratoController));

// Ruta raíz
app.get("/", (req, res) => {
  res.json({
    message: "API Control de Impresoras",
    version: "1.0.0",
    documentation: "/api/health",
    endpoints: {
      empresas: "/api/empresas",
      impresoras: "/api/impresoras",
      registros: "/api/registros",
      consumos: "/api/consumos",
      dashboard: "/api/dashboard",
    },
  });
});

// Manejo de errores 404
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado" });
});

// Middleware de manejo de errores
app.use(errorMiddleware);

// Iniciar servidor
const startServer = async () => {
  const dbConnected = await testConnection();

  if (!dbConnected && process.env.NODE_ENV === "production") {
    console.error("❌ No se pudo conectar a la BD. Saliendo...");
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`🔧 Modo: ${process.env.NODE_ENV || "development"}`);
    if (!dbConnected) {
      console.warn("⚠️  Advertencia: No conectado a la BD. Modo offline.");
    }
  });
};

startServer();
