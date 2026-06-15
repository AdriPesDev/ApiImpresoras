const { Router } = require('express');

module.exports = function createAuthRoutes(authController, jwtMiddleware) {
  const router = Router();

  // POST /api/auth/login — público, no requiere JWT
  router.post('/login', authController.login);

  // GET /api/auth/me — requiere JWT, devuelve datos del usuario actual
  router.get('/me', jwtMiddleware, authController.me);

  return router;
};
