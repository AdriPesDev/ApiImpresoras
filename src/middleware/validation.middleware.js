const { body, param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Error de validación', errors: errors.array() });
  }
  next();
};

const empresaValidations = {
  create: [
    body('dolibarr_id').isInt().withMessage('dolibarr_id debe ser un número entero'),
    body('nombre_oficial').notEmpty().withMessage('nombre_oficial es requerido'),
    body('cif').optional().isString(),
    body('activo').optional().isBoolean(),
    validate,
  ],
  update: [
    param('id').isInt().withMessage('ID debe ser un número entero'),
    body('dolibarr_id').optional().isInt(),
    body('nombre_oficial').optional().notEmpty(),
    body('cif').optional().isString(),
    body('activo').optional().isBoolean(),
    validate,
  ],
};

const impresoraValidations = {
  create: [
    body('serial_number').notEmpty().withMessage('serial_number es requerido'),
    body('modelo').optional().isString(),
    body('empresa_id').optional().isInt(),
    body('precio_copia_bn').optional().isFloat({ min: 0 }),
    body('precio_copia_color1').optional().isFloat({ min: 0 }),
    body('precio_copia_color2').optional().isFloat({ min: 0 }),
    body('precio_copia_color3').optional().isFloat({ min: 0 }),
    body('tipo_facturacion').optional().isIn(['BN_ONLY', 'BN_AND_COLOR', 'BN_MULTICOLOR']),
    body('activa').optional().isBoolean(),
    validate,
  ],
  update: [
    param('id').isInt().withMessage('ID debe ser un número entero'),
    body('serial_number').optional().notEmpty(),
    body('modelo').optional().isString(),
    body('empresa_id').optional().isInt(),
    body('precio_copia_bn').optional().isFloat({ min: 0 }),
    body('precio_copia_color1').optional().isFloat({ min: 0 }),
    body('precio_copia_color2').optional().isFloat({ min: 0 }),
    body('precio_copia_color3').optional().isFloat({ min: 0 }),
    body('tipo_facturacion').optional().isIn(['BN_ONLY', 'BN_AND_COLOR', 'BN_MULTICOLOR']),
    body('activa').optional().isBoolean(),
    validate,
  ],
};

const registroValidations = {
  create: [
    body('impresora_id').isInt().withMessage('impresora_id debe ser un número entero'),
    body('copias_bn_total').isInt({ min: 0 }).withMessage('copias_bn_total debe ser un entero positivo'),
    body('copias_color1_total').optional().isInt({ min: 0 }),
    body('copias_color2_total').optional().isInt({ min: 0 }),
    body('copias_color3_total').optional().isInt({ min: 0 }),
    body('fecha_lectura').optional().isISO8601(),
    validate,
  ],
  bulkCreate: [
    body().isArray().withMessage('Debe enviar un array de registros'),
    body('*.impresora_id').isInt(),
    body('*.copias_bn_total').isInt({ min: 0 }),
    body('*.copias_color1_total').optional().isInt({ min: 0 }),
    body('*.copias_color2_total').optional().isInt({ min: 0 }),
    body('*.copias_color3_total').optional().isInt({ min: 0 }),
    validate,
  ],
};

const facturacionValidations = {
  procesar: [
    body('periodo')
      .matches(/^\d{4}-\d{2}$/)
      .withMessage('periodo debe tener formato YYYY-MM'),
    body('impresoras')
      .isArray({ min: 1 })
      .withMessage('impresoras debe ser un array con al menos un elemento'),
    body('impresoras.*.serial_number')
      .notEmpty()
      .withMessage('serial_number es requerido en cada impresora'),
    body('impresoras.*.empresa_nombre')
      .notEmpty()
      .withMessage('empresa_nombre es requerido en cada impresora'),
    body('impresoras.*.bn_total').optional().isInt({ min: 0 }),
    body('impresoras.*.color_total').optional().isInt({ min: 0 }),
    body('impresoras.*.color1_total').optional().isInt({ min: 0 }),
    body('impresoras.*.color2_total').optional().isInt({ min: 0 }),
    body('impresoras.*.color3_total').optional().isInt({ min: 0 }),
    validate,
  ],
};

module.exports = {
  empresaValidations,
  impresoraValidations,
  registroValidations,
  facturacionValidations,
};
