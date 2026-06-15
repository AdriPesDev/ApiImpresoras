# API Control de Impresoras v2.0

API REST en Node.js + Express 5 para la gestión de impresoras, contratos y facturación mensual. Migración del sistema Python `GestionImpresorasDeprecated`.

## Requisitos

- Node.js 18+
- MySQL 8+
- Dolibarr ERP con módulo API REST habilitado

## Instalación

```bash
npm install
```

## Configuración

Crea un archivo `.env` en la raíz del proyecto:

```env
# Servidor
PORT=3000
NODE_ENV=development

# Base de datos
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_password
DB_NAME=control_impresoras

# Dolibarr
DOLIBARR_URL=https://tu-dolibarr.com/api/index.php
DOLIBARR_API_KEY=tu_api_key_dolibarr

# Seguridad (solo requerido en producción)
API_KEY=tu_api_key_interna
CORS_ORIGIN=https://tu-frontend.com
```

> En `NODE_ENV=development` la autenticación por `x-api-key` está desactivada.  
> En producción, todas las rutas `/api/` requieren la cabecera `x-api-key`.

## Arranque

```bash
# Desarrollo (con recarga automática)
npm run dev

# Producción
npm start
```

El servidor arranca en `http://localhost:3000` por defecto.

---

## Endpoints

### Health

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del servidor |

---

### Empresas `/api/empresas`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/empresas` | Listar empresas. Params: `?activo=true&buscar=texto` |
| GET | `/api/empresas/:id` | Obtener empresa por ID |
| GET | `/api/empresas/:id/stats` | Estadísticas de la empresa |
| POST | `/api/empresas` | Crear empresa |
| PUT | `/api/empresas/:id` | Actualizar empresa |
| DELETE | `/api/empresas/:id` | Eliminar empresa |

**Body POST/PUT:**
```json
{
  "dolibarr_id": 12,
  "nombre_oficial": "Empresa S.L.",
  "cif": "B12345678",
  "activo": true
}
```

---

### Impresoras `/api/impresoras`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/impresoras` | Listar impresoras. Params: `?activa=true&buscar=texto&empresa_id=1` |
| GET | `/api/impresoras/:id` | Obtener impresora por ID |
| GET | `/api/impresoras/:id/registros` | Historial de lecturas de la impresora |
| GET | `/api/impresoras/:id/contrato` | Contrato activo de la impresora |
| POST | `/api/impresoras` | Crear impresora |
| PUT | `/api/impresoras/:id` | Actualizar impresora |
| DELETE | `/api/impresoras/:id` | Eliminar impresora |

**Body POST/PUT:**
```json
{
  "serial_number": "ABC123",
  "modelo": "Kyocera TASKalfa 2553ci",
  "empresa_id": 1,
  "precio_copia_bn": 0.008,
  "precio_copia_color1": 0.06,
  "precio_copia_color2": 0.06,
  "precio_copia_color3": 0.06,
  "tipo_facturacion": "BN_AND_COLOR",
  "activa": true
}
```

**Valores de `tipo_facturacion`:**

| Valor | Condición | Líneas en factura |
|-------|-----------|-------------------|
| `BN_ONLY` | Solo contador BN | 1 línea BN |
| `BN_AND_COLOR` | BN + color total | 1 BN + 1 COLOR |
| `BN_MULTICOLOR` | BN + niveles 2 y 3 distintos | 1 BN + COLOR1 + COLOR2 + COLOR3 |

---

### Contratos `/api/contratos`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/contratos` | Listar contratos |
| GET | `/api/contratos/:id` | Obtener contrato por ID (incluye impresoras y líneas fijas) |
| POST | `/api/contratos` | Crear contrato |
| PUT | `/api/contratos/:id` | Actualizar contrato |
| PATCH | `/api/contratos/:id/activo` | Activar / desactivar contrato |
| DELETE | `/api/contratos/:id` | Eliminar contrato |

**Sub-recurso: impresoras del contrato**

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/contratos/:id/impresoras` | Añadir impresora al contrato |
| PUT | `/api/contratos/:id/impresoras/:ci_id` | Actualizar condiciones de la impresora en el contrato |
| DELETE | `/api/contratos/:id/impresoras/:ci_id` | Quitar impresora del contrato |

**Sub-recurso: líneas fijas del contrato**

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/contratos/:id/lineas-fijas` | Añadir línea fija |
| PUT | `/api/contratos/:id/lineas-fijas/:lf_id` | Actualizar línea fija |
| DELETE | `/api/contratos/:id/lineas-fijas/:lf_id` | Eliminar línea fija |

**Body POST contrato:**
```json
{
  "numero_contrato": "CT-2025-001",
  "empresa_id": 1,
  "fecha_inicio": "2025-01-01",
  "fecha_fin": null,
  "activo": true
}
```

**Body POST impresora en contrato:**
```json
{
  "impresora_id": 3,
  "precio_bn": 0.007,
  "precio_color1": 0.055,
  "precio_color2": 0.055,
  "precio_color3": 0.055,
  "copias_bn_incluidas": 500,
  "copias_c1_incluidas": 0,
  "copias_c2_incluidas": 0,
  "copias_c3_incluidas": 0,
  "precio_minimo_mensual": 30.00
}
```

---

### Registros de contadores `/api/registros`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/registros` | Listar registros. Params: `?impresora_id=1&desde=2025-01-01` |
| GET | `/api/registros/:id` | Obtener registro por ID |
| GET | `/api/registros/estadisticas` | Estadísticas generales |
| GET | `/api/registros/por-mes` | Agrupación mensual |
| POST | `/api/registros` | Crear registro de lectura |
| POST | `/api/registros/bulk` | Crear múltiples registros (importación Kyofleet) |

**Body POST:**
```json
{
  "impresora_id": 3,
  "copias_bn_total": 125430,
  "copias_color1_total": 8200,
  "copias_color2_total": 0,
  "copias_color3_total": 0,
  "fecha_lectura": "2025-05-31T23:59:00"
}
```

---

### Consumos mensuales `/api/consumos`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/consumos` | Listar consumos. Params: `?periodo=2025-05&empresa_id=1` |
| GET | `/api/consumos/:id` | Obtener consumo por ID |
| GET | `/api/consumos/pendientes` | Consumos sin facturar |
| GET | `/api/consumos/resumen` | Resumen agregado |
| PUT | `/api/consumos/:id/facturar` | Marcar consumo como facturado |

---

### Facturación `/api/facturacion`

El flujo normal es: **preview → revisar → ejecutar**.

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/facturacion/preview` | Calcular facturación sin persistir ni crear facturas en Dolibarr |
| POST | `/api/facturacion/ejecutar` | Ejecutar facturación: crea facturas en Dolibarr y persiste en BD |

**Body (ambos endpoints):**
```json
{
  "periodo": "2025-05",
  "impresoras": [
    {
      "serial_number": "ABC123",
      "empresa_nombre": "Empresa S.L.",
      "modelo": "Kyocera TASKalfa 2553ci",
      "bn_total": 125430,
      "color1_total": 8200,
      "color2_total": 0,
      "color3_total": 0,
      "fecha_lectura": "22/05/2025-23:59:00",
      "fecha_lectura_anterior": "22/04/2025-23:59:00"
    }
  ]
}
```

> Los datos de contadores provienen del CSV de Kyofleet, parseado en el frontend y enviado como JSON.

**Respuesta preview:**
```json
{
  "periodo": "2025-05",
  "resumen": {
    "total_impresoras": 1,
    "facturadas": 1,
    "omitidas": 0,
    "importe_total": 87.50
  },
  "detalle": [...]
}
```

---

### Dolibarr `/api/dolibarr`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/dolibarr/health` | Verificar conexión con Dolibarr |
| GET | `/api/dolibarr/terceros` | Listar terceros (clientes) de Dolibarr |
| GET | `/api/dolibarr/terceros/buscar?nombre=Empresa` | Buscar tercero por nombre |

---

### Dashboard `/api/dashboard`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/dashboard/stats` | KPIs globales |
| GET | `/api/dashboard/actividad-reciente` | Últimas lecturas y facturas |
| GET | `/api/dashboard/grafico-mensual` | Datos para gráfico de consumo mensual |
| GET | `/api/dashboard/top-impresoras` | Ranking de impresoras por consumo |

---

### Importaciones `/api/importaciones`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/importaciones` | Historial de importaciones Kyofleet |
| GET | `/api/importaciones/verificar` | Verificar si ya existe importación para un periodo |
| GET | `/api/importaciones/:id` | Obtener importación por ID |
| POST | `/api/importaciones` | Registrar nueva importación |
| PUT | `/api/importaciones/:id/estado` | Actualizar estado de importación |

---

## Estructura del proyecto

```
src/
├── config/
│   └── database.js          # Pool de conexiones MySQL
├── controllers/             # Lógica de cada recurso
├── middleware/
│   ├── auth.middleware.js   # API key (solo producción)
│   ├── error.middleware.js  # Manejo centralizado de errores
│   ├── rateLimit.middleware.js
│   └── validation.middleware.js  # Validaciones express-validator
├── models/                  # Queries SQL
├── routes/                  # Definición de rutas
├── services/
│   ├── dolibarr.service.js  # Integración con Dolibarr REST API
│   └── facturacion.service.js  # Motor de facturación
└── server.js
```

## Esquema de base de datos

Las tablas principales son:

| Tabla | Descripción |
|-------|-------------|
| `empresas` | Clientes / terceros |
| `impresoras` | Máquinas con sus precios base |
| `contratos` | Contratos activos por empresa |
| `contrato_impresoras` | Relación N:M contrato–impresora con precios y copias incluidas |
| `contrato_lineas_fijas` | Cuotas fijas asociadas al contrato |
| `registros_contadores` | Lecturas de contadores (acumuladas) |
| `consumos_mensuales` | Consumo calculado por periodo e impresora |
| `logs_facturacion` | Trazabilidad de cada ejecución de facturación |
| `importaciones_kyofleet` | Registro de cada fichero CSV importado |
