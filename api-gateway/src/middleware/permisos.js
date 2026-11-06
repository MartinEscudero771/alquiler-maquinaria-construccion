const { esPublica } = require('./autenticacion');

// Matriz de permisos por rol. Clave "RAMA:METODO".
// admin: acceso total. operador: 21 acciones que exigen token.
// CUENTAS (crear/listar usuarios) queda reservada al admin por '*'.
const PERMISOS = {
  admin: ['*'],
  operador: [
    'USUARIOS:PUT',
    'NOTIFICACIONES:GET',
    'NOTIFICACIONES:PUT',
    'CLIENTES:GET',
    'CLIENTES:POST',
    'ALQUILERES:GET',
    'ALQUILERES:POST',
    'DEVOLUCION:GET',
    'DEVOLUCION:PUT',
    'MAQUINARIAS:POST',
    'MAQUINARIAS:PATCH',
    'MAQUINARIAS:DELETE',
    'UNIDADES:POST',
    'UNIDADES:PUT',
    'FOTOS:POST',
    'REPORTES:GET',
    'REPORTES:POST',
    'REPORTES:DELETE',
    'SOLICITUDES:GET',
    'SOLICITUDES:POST',
    'SOLICITUDES:PUT'
  ]
};

function responder(res, codigo, mensaje) {
  return res.status(codigo).json({ ok: codigo < 400, codigo, mensaje, datos: [] });
}

function autorizar(req, res, next) {
  const info = req.gateway;
  if (!info) {
    return responder(res, 400, 'Estructura inválida.');
  }
  if (esPublica(info.rama, info.metodo)) {
    return next();
  }
  const usuario = req.usuario;
  if (!usuario || typeof usuario.rol !== 'string') {
    return responder(res, 401, 'Token requerido.');
  }
  const rol = usuario.rol;
  if (rol === 'admin') {
    return next();
  }
  const lista = PERMISOS[rol];
  if (!Array.isArray(lista)) {
    return responder(res, 403, 'Permiso denegado.');
  }
  const clave = info.rama + ':' + info.metodo;
  if (!lista.includes(clave)) {
    return responder(res, 403, 'Permiso denegado.');
  }
  next();
}

module.exports = { PERMISOS, autorizar };
