const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');

dotenv.config();

const { pool, testConnection } = require('./config/database');
const { limiter, writeLimiter } = require('./middleware/rateLimit.middleware');
const { jwtMiddleware, requireRole, apiKeyMiddleware } = require('./middleware/auth.middleware');
const errorMiddleware = require('./middleware/error.middleware');

// Controllers
const AuthController         = require('./controllers/auth.controller');
const EmpresaController      = require('./controllers/empresa.controller');
const ImpresoraController    = require('./controllers/impresora.controller');
const RegistroController     = require('./controllers/registro.controller');
const ConsumoController      = require('./controllers/consumo.controller');
const DashboardController    = require('./controllers/dashboard.controller');
const ContratoController     = require('./controllers/contrato.controller');
const ImportacionesController = require('./controllers/importaciones.controller');
const FacturacionController  = require('./controllers/facturacion.controller');
const DolibarrController     = require('./controllers/dolibarr.controller');

// Route factories
const createAuthRoutes          = require('./routes/auth.routes');
const createEmpresaRoutes       = require('./routes/empresa.routes');
const createImpresoraRoutes     = require('./routes/impresora.routes');
const createRegistroRoutes      = require('./routes/registro.routes');
const createConsumoRoutes       = require('./routes/consumo.routes');
const createDashboardRoutes     = require('./routes/dashboard.routes');
const createContratoRoutes      = require('./routes/contrato.routes');
const createImportacionesRoutes = require('./routes/importaciones.routes');
const createFacturacionRoutes   = require('./routes/facturacion.routes');
const createDolibarrRoutes      = require('./routes/dolibarr.routes');

const app = express();
const PORT = process.env.PORT || 4000;

// ── Global middleware ──────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
}));
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting (descomentar en producción)
// app.use('/api/', limiter);
// app.use('/api/facturacion/ejecutar', writeLimiter);

// ── Health check (público) ─────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
});

// ── Instantiate controllers ────────────────────────
const authController          = new AuthController(pool);
const empresaController       = new EmpresaController(pool);
const impresoraController     = new ImpresoraController(pool);
const registroController      = new RegistroController(pool);
const consumoController       = new ConsumoController(pool);
const dashboardController     = new DashboardController(pool);
const contratoController      = new ContratoController(pool);
const importacionesController = new ImportacionesController(pool);
const facturacionController   = new FacturacionController(pool);
const dolibarrController      = new DolibarrController();

// ── Rutas públicas (sin auth) ──────────────────────
app.use('/api/auth', createAuthRoutes(authController, jwtMiddleware));

// ── Rutas protegidas (requieren JWT o API key) ─────
// En development puedes desactivar auth comentando la siguiente línea:
app.use('/api', apiKeyMiddleware);

// Rutas accesibles para admin y viewer
app.use('/api/empresas',      createEmpresaRoutes(empresaController));
app.use('/api/impresoras',    createImpresoraRoutes(impresoraController));
app.use('/api/registros',     createRegistroRoutes(registroController));
app.use('/api/consumos',      createConsumoRoutes(consumoController));
app.use('/api/dashboard',     createDashboardRoutes(dashboardController));
app.use('/api/contratos',     createContratoRoutes(contratoController));
app.use('/api/importaciones', createImportacionesRoutes(importacionesController));

// Rutas solo admin
app.use('/api/facturacion',   requireRole('admin'), createFacturacionRoutes(facturacionController));
app.use('/api/dolibarr',      requireRole('admin'), createDolibarrRoutes(dolibarrController));

// ── Root ───────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    message: 'API Control de Impresoras',
    version: '2.1.0',
    endpoints: {
      auth:          '/api/auth/login',
      empresas:      '/api/empresas',
      impresoras:    '/api/impresoras',
      contratos:     '/api/contratos',
      registros:     '/api/registros',
      consumos:      '/api/consumos',
      facturacion:   '/api/facturacion',
      dolibarr:      '/api/dolibarr',
      dashboard:     '/api/dashboard',
      importaciones: '/api/importaciones',
    },
  });
});

// ── 404 ────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// ── Error handler ──────────────────────────────────
app.use(errorMiddleware);

// ── Start ──────────────────────────────────────────
const startServer = async () => {
  const dbConnected = await testConnection();

  if (!dbConnected && process.env.NODE_ENV === 'production') {
    console.error('❌ No se pudo conectar a la BD. Saliendo...');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`🔧 Modo: ${process.env.NODE_ENV || 'development'}`);
    if (!dbConnected) console.warn('⚠️  Advertencia: No conectado a la BD. Modo offline.');
  });
};

startServer();
