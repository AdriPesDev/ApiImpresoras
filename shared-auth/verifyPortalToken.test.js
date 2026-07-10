// tryPortalAuth NO debe limitarse a decir «no vale» ante mustChange: el middleware
// interpreta eso como «no hay sesión de portal» y cae al login local o a la API key.
// Tiene que devolver { valid:false, mustChange:true } para que el llamante corte con 403.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const jwt = require("jsonwebtoken");

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// El módulo lee el entorno al importarse: antes del require.
process.env.PORTAL_PUBLIC_KEY = publicKey;
process.env.PORTAL_ISSUER = "nethive-portal";
process.env.PORTAL_APP_SLUG = "impresoras";

const { tryPortalAuth } = require("./verifyPortalToken");

const cookieCon = (payload) => ({
  cookies: {
    np_session: jwt.sign(payload, privateKey, {
      algorithm: "RS256",
      issuer: "nethive-portal",
      subject: "u1",
      expiresIn: "5m",
    }),
  },
  headers: {},
});

const ACCESO = { type: "access", apps: { impresoras: "admin" } };

test("sesión normal con permiso: entra", () => {
  const res = tryPortalAuth(cookieCon(ACCESO));
  assert.equal(res.valid, true);
  assert.equal(res.user.rol, "admin");
});

test("contraseña temporal: no entra, y lo dice", () => {
  const res = tryPortalAuth(cookieCon({ ...ACCESO, mustChange: true }));
  assert.equal(res.valid, false);
  assert.equal(res.mustChange, true, "sin esto el middleware cae al login local");
});

test("la contraseña temporal manda aunque tenga permiso concedido", () => {
  const res = tryPortalAuth(cookieCon({ type: "access", mustChange: true, apps: { impresoras: "superadmin" } }));
  assert.equal(res.mustChange, true);
});

test("sin permiso a esta app: no entra, pero NO es un mustChange", () => {
  const res = tryPortalAuth(cookieCon({ type: "access", apps: { flota: "admin" } }));
  assert.equal(res.valid, false);
  assert.equal(res.mustChange, undefined, "no debe confundirse con el 403 de contraseña");
});

test("token de refresh: no entra, y NO es un mustChange", () => {
  const res = tryPortalAuth(cookieCon({ type: "refresh", mustChange: true }));
  assert.equal(res.valid, false);
  assert.equal(res.mustChange, undefined, "un refresh no autentica ni para rechazar por contraseña");
});

test("sin cookie ni Bearer: no entra", () => {
  assert.deepEqual(tryPortalAuth({ cookies: {}, headers: {} }), { valid: false });
});
