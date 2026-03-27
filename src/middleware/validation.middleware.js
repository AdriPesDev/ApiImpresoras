const { body, param, query, validationResult } = require("express-validator");

// Middleware para validar resultados
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Error de validación",
      errors: errors.array(),
    });
  }
  next();
};

// Validaciones para empresas
const empresaValidations = {
  create: [
    body("dolibarr_id")
      .isInt()
      .withMessage("dolibarr_id debe ser un número entero"),
    body("nombre_oficial")
      .notEmpty()
      .withMessage("nombre_oficial es requerido"),
    body("cif").optional().isString(),
    body("activo").optional().isBoolean(),
    validate,
  ],
  update: [
    param("id").isInt().withMessage("ID debe ser un número entero"),
    body("dolibarr_id").optional().isInt(),
    body("nombre_oficial").optional().notEmpty(),
    body("cif").optional().isString(),
    body("activo").optional().isBoolean(),
    validate,
  ],
};

// Validaciones para impresoras
const impresoraValidations = {
  create: [
    body("serial_number").notEmpty().withMessage("serial_number es requerido"),
    body("modelo").optional().isString(),
    body("empresa_id").optional().isInt(),
    body("precio_copia_bn")
      .isFloat({ min: 0 })
      .withMessage("precio_copia_bn debe ser un número positivo"),
    body("precio_copia_color")
      .isFloat({ min: 0 })
      .withMessage("precio_copia_color debe ser un número positivo"),
    body("activa").optional().isBoolean(),
    validate,
  ],
  update: [
    param("id").isInt().withMessage("ID debe ser un número entero"),
    body("serial_number").optional().notEmpty(),
    body("modelo").optional().isString(),
    body("empresa_id").optional().isInt(),
    body("precio_copia_bn").optional().isFloat({ min: 0 }),
    body("precio_copia_color").optional().isFloat({ min: 0 }),
    body("activa").optional().isBoolean(),
    validate,
  ],
};

// Validaciones para registros
const registroValidations = {
  create: [
    body("impresora_id")
      .isInt()
      .withMessage("impresora_id debe ser un número entero"),
    body("copias_bn_total")
      .isInt({ min: 0 })
      .withMessage("copias_bn_total debe ser un número entero positivo"),
    // Aceptar los 3 colores como opcionales
    body("copias_color1_total")
      .optional()
      .isInt({ min: 0 })
      .withMessage("copias_color1_total debe ser un número entero positivo"),
    body("copias_color2_total")
      .optional()
      .isInt({ min: 0 })
      .withMessage("copias_color2_total debe ser un número entero positivo"),
    body("copias_color3_total")
      .optional()
      .isInt({ min: 0 })
      .withMessage("copias_color3_total debe ser un número entero positivo"),
    // Mantener compatibilidad con campo legacy
    body("copias_color_total").optional().isInt({ min: 0 }),
    body("fecha_lectura")
      .optional()
      .isISO8601()
      .withMessage("fecha_lectura debe ser una fecha válida"),
    validate,
  ],
  bulkCreate: [
    body().isArray().withMessage("Debe enviar un array de registros"),
    body("*.impresora_id").isInt(),
    body("*.copias_bn_total").isInt({ min: 0 }),
    body("*.copias_color1_total").optional().isInt({ min: 0 }),
    body("*.copias_color2_total").optional().isInt({ min: 0 }),
    body("*.copias_color3_total").optional().isInt({ min: 0 }),
    body("*.copias_color_total").optional().isInt({ min: 0 }),
    validate,
  ],
};

// Validaciones para consumos
const consumoValidations = {
  calcularPeriodo: [
    param("periodo")
      .matches(/^\d{4}-\d{2}$/)
      .withMessage("Período debe tener formato YYYY-MM"),
    validate,
  ],
};

module.exports = {
  empresaValidations,
  impresoraValidations,
  registroValidations,
  consumoValidations,
};
