const jwt = require('jsonwebtoken');
const entorno = require('../config/environment');

const EMISOR = 'alquiler-gateway';
const AUDIENCIA = 'alquiler-app';

// Ramas públicas que no exigen token (catálogo sin login + autenticación).
const RUTAS_PUBLICAS = new Set([
  'USUARIOS:POST',
  'CAPTCHA:POST',
  'MAQUINARIAS:GET',
  'FOTOS:POST',
  'UNIDADES:POST',
  'REPORTES:GET',
  'SOLICITUDES:POST'
]);

function responder(res, codigo, mensaje) {
  return res.status(codigo).json({ ok: codigo < 400, codigo, mensaje, datos: [] });
}

function esPublica(rama, metodo) {
  return RUTAS_PUBLICAS.has(rama + ':' + metodo);
}

function autenticar(req, res, next) {
  const info = req.gateway;
  if (!info) {
    return responder(res, 400, 'Estructura inválida.');
  }
  const clave = info.rama + ':' + info.metodo;
  const token = info.token;
  if (RUTAS_PUBLICAS.has(clave)) {
    if (!token) {
      req.usuario = null;
      return next();
    }
    try {
      const carga = jwt.verify(token, entorno.secretoJwt, {
        algorithms: ['HS256'],
        issuer: EMISOR,
        audience: AUDIENCIA
      });
      req.usuario = carga;
      return next();
    } catch (e) {
      return responder(res, 401, 'Token inválido o expirado.');
    }
  }
  if (!token) {
    return responder(res, 401, 'Token requerido.');
  }
  try {
    const carga = jwt.verify(token, entorno.secretoJwt, {
      algorithms: ['HS256'],
      issuer: EMISOR,
      audience: AUDIENCIA
    });
    req.usuario = carga;
    return next();
  } catch (e) {
    return responder(res, 401, 'Token inválido o expirado.');
  }
}

function firmarToken(carga) {
  return jwt.sign(carga, entorno.secretoJwt, {
    algorithm: 'HS256',
    expiresIn: '15m',
    issuer: EMISOR,
    audience: AUDIENCIA
  });
}

module.exports = { RUTAS_PUBLICAS, esPublica, autenticar, firmarToken, EMISOR, AUDIENCIA };
