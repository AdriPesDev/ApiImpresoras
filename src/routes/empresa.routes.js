const express = require("express");
const router = express.Router();

module.exports = (controller) => {
  // GET /api/empresas
  router.get("/", controller.getAll);

  // GET /api/empresas/:id
  router.get("/:id", controller.getById);

  // GET /api/empresas/:id/stats
  router.get("/:id/stats", controller.getStats);

  // POST /api/empresas
  router.post("/", controller.create);

  // PUT /api/empresas/:id
  router.put("/:id", controller.update);

  // DELETE /api/empresas/:id
  router.delete("/:id", controller.delete);

  return router;
};
