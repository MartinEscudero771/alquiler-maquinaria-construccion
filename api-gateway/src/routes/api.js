const express = require('express');
const {
  controlAcceso,
  limiteGeneral,
  verificarBloqueoLogin,
  limiteFotos,
  limiteCaptcha,
  limiteSolicitudes
} = require('../middleware/seguridad');
const { validarEstructura } = require('../middleware/validacion');
const { autenticar } = require('../middleware/autenticacion');
const { autorizar } = require('../middleware/permisos');
const { procesar } = require('../controllers/gateway.controller');

const rutas = express.Router();

rutas.post(
  '/api',
  controlAcceso,
  limiteGeneral,
  validarEstructura,
  verificarBloqueoLogin,
  limiteFotos,
  limiteCaptcha,
  limiteSolicitudes,
  autenticar,
  autorizar,
  procesar
);

module.exports = rutas;
