const entorno = require('../config/environment');
const { firmarToken } = require('../middleware/autenticacion');
const { registrarFalloLogin, limpiarLogin } = require('../middleware/seguridad');
const { resolverDestino, reenviar } = require('../services/router.service');

function responder(res, codigo, mensaje, datos) {
  return res.status(codigo).json({
    ok: codigo < 400,
    codigo,
    mensaje,
    datos: datos === undefined ? [] : datos
  });
}

function esEscritura(metodo) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo);
}

// Bitácora fire-and-forget: POST /bitacora a PHP, sin bloquear la respuesta.
function registrarBitacora({ rama, metodo, codigo, ip, idusuario }) {
  try {
    const url = entorno.urlApiPhp + '/bitacora';
    const cuerpo = { rama, metodo, codigo, ip };
    if (idusuario !== undefined && idusuario !== null) {
      cuerpo.idusuario = idusuario;
    }
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 5000);
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clave-Interna': entorno.clavePhp || ''
      },
      body: JSON.stringify(cuerpo),
      signal: controlador.signal
    })
      .catch(() => {})
      .finally(() => clearTimeout(temporizador));
  } catch (e) {
    // Nunca bloquea ni rompe la respuesta principal.
  }
}

async function procesar(req, res) {
  const info = req.gateway;
  if (!info) {
    return responder(res, 400, 'Estructura inválida.', []);
  }
  const { rama, metodo, datos } = info;
  const ip = req.ip || 'desconocida';
  const usuario = req.usuario || null;

  try {
    // Caso especial: login. Reenvía a PHP y genera JWT propio. PHP no conoce el secreto.
    if (rama === 'USUARIOS' && metodo === 'POST') {
      const destino = resolverDestino(rama, metodo, datos);
      const contexto = { rol: '', usuario: '' };
      const resultado = await reenviar(destino, datos, contexto);
      if (!resultado.cuerpo || resultado.cuerpo.ok !== true || resultado.estado >= 400) {
        if ([400, 401, 403].includes(resultado.estado)) {
          registrarFalloLogin(ip);
        }
        return res.status(resultado.estado).json(resultado.cuerpo);
      }
      limpiarLogin(ip);
      const datosPhp = resultado.cuerpo.datos || {};
      // Carga minima: sin datos muertos. 'sid' se elimino porque se firmaba
      // pero nunca se usaba (S7). La ventana corta de 15 min + sesion en
      // memoria del cliente cubren la revocacion practica.
      const carga = {
        idusuario: datosPhp.idusuario,
        usuario: datosPhp.usuario,
        nombre: datosPhp.nombre,
        rol: datosPhp.rol
      };
      const token = firmarToken(carga);
      registrarBitacora({
        rama,
        metodo,
        codigo: resultado.estado,
        ip,
        idusuario: datosPhp.idusuario
      });
      return responder(res, resultado.estado, resultado.cuerpo.mensaje || 'Acceso correcto.', {
        idusuario: datosPhp.idusuario,
        usuario: datosPhp.usuario,
        nombre: datosPhp.nombre,
        rol: datosPhp.rol,
        debe_cambiar_clave: Number(datosPhp.debe_cambiar_clave || 0),
        token
      });
    }

    const destino = resolverDestino(rama, metodo, datos);
    if (!destino) {
      return responder(res, 404, 'Rama no encontrada.', []);
    }
    if (destino.error) {
      return responder(res, destino.error, destino.mensaje || 'Solicitud inválida.', []);
    }
    const contexto = {
      rol: usuario && usuario.rol ? String(usuario.rol) : '',
      usuario: usuario && usuario.usuario ? String(usuario.usuario) : ''
    };
    const resultado = await reenviar(destino, datos, contexto);

    if (esEscritura(metodo)) {
      let idusuario = null;
      if (usuario && Number.isInteger(usuario.idusuario) && usuario.idusuario > 0) {
        idusuario = usuario.idusuario;
      } else if (usuario && typeof usuario.idusuario === 'string' && /^\d+$/.test(usuario.idusuario)) {
        idusuario = Number(usuario.idusuario);
      }
      registrarBitacora({ rama, metodo, codigo: resultado.estado, ip, idusuario });
    }

    return res.status(resultado.estado).json(resultado.cuerpo);
  } catch (e) {
    return responder(res, 500, 'Error interno del servidor.', []);
  }
}

module.exports = { procesar };
