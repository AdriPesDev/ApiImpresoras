const errorMiddleware = (err, req, res, next) => {
  console.error("Error:", err);

  // Error de MySQL
  if (err.code) {
    switch (err.code) {
      case "ER_DUP_ENTRY":
        return res.status(400).json({
          error: "Registro duplicado",
          details: err.sqlMessage,
        });
      case "ER_NO_REFERENCED_ROW":
        return res.status(400).json({
          error: "Referencia a registro no existente",
          details: err.sqlMessage,
        });
      case "ER_ROW_IS_REFERENCED":
        return res.status(400).json({
          error: "No se puede eliminar, tiene registros relacionados",
          details: err.sqlMessage,
        });
    }
  }

  // Error de validación
  if (err.name === "ValidationError") {
    return res.status(400).json({
      error: "Error de validación",
      details: err.message,
    });
  }

  // Error por defecto
  const status = err.status || 500;
  const message = err.message || "Error interno del servidor";

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

module.exports = errorMiddleware;
