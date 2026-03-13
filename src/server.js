const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");

// Importar configuración de BD
const { testConnection } = require("./config/database");

// Importar rutas
const empresasRoutes = require("./routes/empresas.routes");
const impresorasRoutes = require("./routes/impresoras.routes");
const registrosRoutes = require("./routes/registros.routes");
const consumosRoutes = require("./routes/consumos.routes");
const dashboardRoutes = require("./routes/dashboard.routes");

// Configurar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet()); // Seguridad
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(morgan("dev")); // Logging
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// Middleware para logging de peticiones
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Rutas
app.use("/api/empresas", empresasRoutes);
app.use("/api/impresoras", impresorasRoutes);
app.use("/api/registros", registrosRoutes);
app.use("/api/consumos", consumosRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Ruta de salud (health check)
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Ruta raíz
app.get("/", (req, res) => {
  res.json({
    message: "API Control de Impresoras",
    version: "1.0.0",
    endpoints: {
      health: "/api/health",
      empresas: "/api/empresas",
      impresoras: "/api/impresoras",
      registros: "/api/registros",
      consumos: "/api/consumos",
      dashboard: "/api/dashboard",
    },
  });
});

// Manejo de errores 404
app.use("*", (req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado" });
});

// Middleware de manejo de errores
app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(err.status || 500).json({
    error: err.message || "Error interno del servidor",
  });
});

// Iniciar servidor después de verificar BD
const startServer = async () => {
  const dbConnected = await testConnection();

  if (!dbConnected && process.env.NODE_ENV === "production") {
    console.error("❌ No se pudo conectar a la BD. Saliendo...");
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📚 Documentación disponible en http://localhost:${PORT}`);
    console.log(`🔧 Modo: ${process.env.NODE_ENV || "development"}`);
    if (!dbConnected) {
      console.warn("⚠️  Advertencia: No conectado a la BD. Modo offline.");
    }
  });
};

startServer();
