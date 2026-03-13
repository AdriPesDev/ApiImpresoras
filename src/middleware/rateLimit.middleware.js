const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // límite de 100 peticiones por IP
  message: {
    error: "Demasiadas peticiones, por favor intente más tarde",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Límite más estricto para endpoints de escritura
const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 50, // 50 peticiones por hora
  message: {
    error: "Límite de operaciones de escritura alcanzado",
  },
});

module.exports = { limiter, writeLimiter };
