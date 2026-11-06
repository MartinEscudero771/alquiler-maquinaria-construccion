const RAMAS = {
  USUARIOS: ['POST', 'PUT', 'PATCH'],
  CUENTAS: ['GET', 'POST'],
  CLIENTES: ['GET', 'POST'],
  ALQUILERES: ['GET', 'POST'],
  DEVOLUCION: ['PUT', 'GET'],
  MAQUINARIAS: ['GET', 'POST', 'PATCH', 'DELETE'],
  UNIDADES: ['POST', 'PUT'],
  FOTOS: ['POST'],
  REPORTES: ['GET', 'POST', 'DELETE'],
  CAPTCHA: ['POST'],
  SOLICITUDES: ['GET', 'POST', 'PUT'],
  NOTIFICACIONES: ['GET', 'PUT']
};

// Defensa de prototipos (N7): rechaza claves peligrosas en RAMA/DATOS
// hasta profundidad 3. Costo minimo, cierra la puerta a que un cuerpo
// malintencionado manipule objetos internos.
function clavesPeligrosas(objetivo, profundidad) {
  if (profundidad > 3 || objetivo === null || typeof objetivo !== 'object' || Array.isArray(objetivo)) {
    return false;
  }
  for (const clave of Object.keys(objetivo)) {
    if (clave === '__proto__' || clave === 'constructor' || clave === 'prototype') {
      return true;
    }
    if (clavesPeligrosas(objetivo[clave], profundidad + 1)) {
      return true;
    }
  }
  return false;
}

function responder(res, codigo, mensaje) {
  return res.status(codigo).json({ ok: codigo < 400, codigo, mensaje, datos: [] });
}

function validarEstructura(req, res, next) {
  const cuerpo = req.body;
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    return responder(res, 400, 'Estructura inválida.');
  }
  const dat = cuerpo.dat;
  if (!dat || typeof dat !== 'object' || Array.isArray(dat)) {
    return responder(res, 400, 'Estructura inválida. Se requiere dat{RAMA,METODO,DATOS}.');
  }
  const ramaCruda = dat.RAMA;
  const metodoCrudo = dat.METODO;
  if (typeof ramaCruda !== 'string' || typeof metodoCrudo !== 'string') {
    return responder(res, 400, 'Estructura inválida. RAMA y METODO son obligatorios.');
  }
  const rama = ramaCruda.trim().toUpperCase();
  const metodo = metodoCrudo.trim().toUpperCase();
  if (rama === '' || metodo === '') {
    return responder(res, 400, 'Estructura inválida. RAMA y METODO son obligatorios.');
  }
  if (!Object.prototype.hasOwnProperty.call(RAMAS, rama)) {
    return responder(res, 404, 'Rama no encontrada.');
  }
  if (!RAMAS[rama].includes(metodo)) {
    return responder(res, 405, 'Método no permitido.');
  }
  if (Object.prototype.hasOwnProperty.call(dat, 'DATOS')) {
    const datos = dat.DATOS;
    if (datos !== undefined && datos !== null && (typeof datos !== 'object' || Array.isArray(datos))) {
      return responder(res, 400, 'Estructura inválida. DATOS debe ser objeto.');
    }
  }
  if (clavesPeligrosas(dat, 0)) {
    return responder(res, 400, 'Estructura inválida. Contenido no permitido.');
  }
  req.gateway = {
    rama,
    metodo,
    datos: dat.DATOS && typeof dat.DATOS === 'object' ? dat.DATOS : {},
    token: typeof cuerpo.TOKEN === 'string' ? cuerpo.TOKEN : ''
  };
  next();
}

module.exports = { RAMAS, validarEstructura };
