const entorno = require('../config/environment');

const IPS_LOCALES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

function responder(res, codigo, mensaje) {
  return res.status(codigo).json({ ok: codigo < 400, codigo, mensaje, datos: [] });
}

function listaOrigenes() {
  if (Array.isArray(entorno.origenesFrontend) && entorno.origenesFrontend.length > 0) {
    return entorno.origenesFrontend.slice();
  }
  return String(entorno.origenFrontend || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s !== '');
}

function origenDeReferer(referer) {
  try {
    const url = new URL(referer);
    return url.origin;
  } catch (e) {
    return '';
  }
}

function cabecerasSeguridad(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Strict-Transport-Security', 'max-age=604800; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );
  res.setHeader('Cache-Control', 'no-store');
  next();
}

function controlAcceso(req, res, next) {
  if (!IPS_LOCALES.includes(req.ip)) {
    return responder(res, 403, 'Acceso denegado.');
  }
  if (req.path === '/salud') {
    return next();
  }
  const origen = req.headers.origin;
  const referer = req.headers.referer || req.headers.referrer;
  const permitidos = listaOrigenes();
  let candidato = '';
  if (typeof origen === 'string' && origen.trim() !== '') {
    candidato = origen.trim().replace(/\/+$/, '');
  } else if (typeof referer === 'string' && referer.trim() !== '') {
    candidato = origenDeReferer(referer.trim());
  } else {
    return responder(res, 403, 'Acceso denegado.');
  }
  if (!permitidos.includes(candidato)) {
    return responder(res, 403, 'Acceso denegado.');
  }
  next();
}

// Rate limit general: 100 req/min/IP (en memoria).
const ventanaGeneral = new Map();

function limiteGeneral(req, res, next) {
  const ahora = Date.now();
  const ventanaMs = 60 * 1000;
  const maximo = 100;
  const ip = req.ip || 'desconocida';
  const registro = ventanaGeneral.get(ip);
  if (!registro || ahora - registro.inicio >= ventanaMs) {
    ventanaGeneral.set(ip, { conteo: 1, inicio: ahora });
    return next();
  }
  registro.conteo += 1;
  if (registro.conteo > maximo) {
    const reintento = Math.ceil((registro.inicio + ventanaMs - ahora) / 1000);
    res.setHeader('Retry-After', String(reintento > 0 ? reintento : 1));
    return responder(res, 429, 'Demasiadas solicitudes.');
  }
  next();
}

// Rate limit login: 5 fallos/15min/IP (en memoria). El bloqueo de cuenta lo hace PHP.
const fallosLogin = new Map();

function obtenerRamaMetodo(req) {
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  const dat = cuerpo.dat && typeof cuerpo.dat === 'object' ? cuerpo.dat : null;
  if (!dat) {
    return '';
  }
  const rama = String(dat.RAMA || '').trim().toUpperCase();
  const metodo = String(dat.METODO || '').trim().toUpperCase();
  if (!rama || !metodo) {
    return '';
  }
  return rama + ':' + metodo;
}

function verificarBloqueoLogin(req, res, next) {
  if (obtenerRamaMetodo(req) !== 'USUARIOS:POST') {
    return next();
  }
  const ip = req.ip || 'desconocida';
  const ahora = Date.now();
  const ventanaMs = 15 * 60 * 1000;
  const registro = fallosLogin.get(ip);
  if (registro) {
    if (ahora - registro.inicio >= ventanaMs) {
      fallosLogin.delete(ip);
      return next();
    }
    if (registro.conteo >= 5) {
      const reintento = Math.ceil((registro.inicio + ventanaMs - ahora) / 1000);
      res.setHeader('Retry-After', String(reintento > 0 ? reintento : 1));
      return responder(res, 429, 'Demasiados intentos de acceso.');
    }
  }
  next();
}

function registrarFalloLogin(ip) {
  const ahora = Date.now();
  const ventanaMs = 15 * 60 * 1000;
  const registro = fallosLogin.get(ip);
  if (!registro || ahora - registro.inicio >= ventanaMs) {
    fallosLogin.set(ip, { conteo: 1, inicio: ahora });
    return;
  }
  registro.conteo += 1;
}

function limpiarLogin(ip) {
  fallosLogin.delete(ip);
}

// Rate limit fotos: 20 req/15min/IP (en memoria).
const ventanaFotos = new Map();

function limiteFotos(req, res, next) {
  if (obtenerRamaMetodo(req) !== 'FOTOS:POST') {
    return next();
  }
  const ahora = Date.now();
  const ventanaMs = 15 * 60 * 1000;
  const maximo = 20;
  const ip = req.ip || 'desconocida';
  const registro = ventanaFotos.get(ip);
  if (!registro || ahora - registro.inicio >= ventanaMs) {
    ventanaFotos.set(ip, { conteo: 1, inicio: ahora });
    return next();
  }
  registro.conteo += 1;
  if (registro.conteo > maximo) {
    const reintento = Math.ceil((registro.inicio + ventanaMs - ahora) / 1000);
    res.setHeader('Retry-After', String(reintento > 0 ? reintento : 1));
    return responder(res, 429, 'Demasiadas solicitudes de fotos.');
  }
  next();
}

// Rate limit captcha: 10 req/5min/IP. Endurece CAPTCHA:POST (S11):
// el flujo normal de login usa 1 por intento; 10 en 5 minutos es sobrado.
const ventanaCaptcha = new Map();

function limiteCaptcha(req, res, next) {
  if (obtenerRamaMetodo(req) !== 'CAPTCHA:POST') {
    return next();
  }
  const ahora = Date.now();
  const ventanaMs = 5 * 60 * 1000;
  const maximo = 15;
  const ip = req.ip || 'desconocida';
  const registro = ventanaCaptcha.get(ip);
  if (!registro || ahora - registro.inicio >= ventanaMs) {
    ventanaCaptcha.set(ip, { conteo: 1, inicio: ahora });
    return next();
  }
  registro.conteo += 1;
  if (registro.conteo > maximo) {
    const reintento = Math.ceil((registro.inicio + ventanaMs - ahora) / 1000);
    res.setHeader('Retry-After', String(reintento > 0 ? reintento : 1));
    return responder(res, 429, 'Demasiadas solicitudes de captcha.');
  }
  next();
}

// Rate limit solicitud publica: 5 req/15min/IP (S11). El cliente legitimo
// pide 1 a 2 alquileres en ese lapso; evita inundar la tabla solicitudes.
const ventanaSolicitudes = new Map();

function limiteSolicitudes(req, res, next) {
  if (obtenerRamaMetodo(req) !== 'SOLICITUDES:POST') {
    return next();
  }
  const ahora = Date.now();
  const ventanaMs = 15 * 60 * 1000;
  const maximo = 5;
  const ip = req.ip || 'desconocida';
  const registro = ventanaSolicitudes.get(ip);
  if (!registro || ahora - registro.inicio >= ventanaMs) {
    ventanaSolicitudes.set(ip, { conteo: 1, inicio: ahora });
    return next();
  }
  registro.conteo += 1;
  if (registro.conteo > maximo) {
    const reintento = Math.ceil((registro.inicio + ventanaMs - ahora) / 1000);
    res.setHeader('Retry-After', String(reintento > 0 ? reintento : 1));
    return responder(res, 429, 'Demasiadas solicitudes de alquiler recientes.');
  }
  next();
}

// Limpieza periodica (S6a): descarta entradas vencidas de todos los Mapas
// y aplica tope duro si algo creciera de forma anomala. Solo corre con el
// proceso vivo y nunca bloquea peticiones.
const MAPAS_ACOTADOS = [
  { mapa: ventanaGeneral, ventanaMs: 60 * 1000 },
  { mapa: fallosLogin, ventanaMs: 15 * 60 * 1000 },
  { mapa: ventanaFotos, ventanaMs: 15 * 60 * 1000 },
  { mapa: ventanaCaptcha, ventanaMs: 5 * 60 * 1000 },
  { mapa: ventanaSolicitudes, ventanaMs: 15 * 60 * 1000 }
];
const TOPE_CLAVES = 20000;

function limpiarMapaVencido({ mapa, ventanaMs }, ahora) {
  for (const [clave, registro] of mapa) {
    if (!registro || ahora - registro.inicio >= ventanaMs) {
      mapa.delete(clave);
    }
  }
  if (mapa.size > TOPE_CLAVES) {
    mapa.clear();
  }
}

setInterval(() => {
  const ahora = Date.now();
  for (const entrada of MAPAS_ACOTADOS) {
    limpiarMapaVencido(entrada, ahora);
  }
}, 5 * 60 * 1000).unref();

module.exports = {
  IPS_LOCALES,
  cabecerasSeguridad,
  controlAcceso,
  limiteGeneral,
  verificarBloqueoLogin,
  registrarFalloLogin,
  limpiarLogin,
  limiteFotos,
  limiteCaptcha,
  limiteSolicitudes
};
