const entorno = require('../config/environment');

const TIEMPO_ESPERA_MS = 10000;

function enteroPositivo(valor) {
  if (typeof valor === 'number' && Number.isInteger(valor) && valor > 0) {
    return valor;
  }
  if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) {
    const numero = Number(valor.trim());
    if (Number.isInteger(numero) && numero > 0) {
      return numero;
    }
  }
  return null;
}

function construirConsulta(pares) {
  const partes = [];
  for (const [clave, valor] of Object.entries(pares)) {
    if (valor === undefined || valor === null || valor === '') {
      continue;
    }
    partes.push(encodeURIComponent(clave) + '=' + encodeURIComponent(String(valor)));
  }
  return partes.length > 0 ? '?' + partes.join('&') : '';
}

// Mapa RAMA+METODO -> UNA sola API interna. El gateway nunca encadena ni aplica lógica de negocio.
function resolverDestino(rama, metodo, datos) {
  const d = datos && typeof datos === 'object' ? datos : {};
  switch (rama + ':' + metodo) {
    case 'USUARIOS:POST':
      return { api: 'php', metodoHttp: 'POST', ruta: '/usuarios/login', clave: entorno.clavePhp };
    case 'USUARIOS:PUT':
      return { api: 'php', metodoHttp: 'PUT', ruta: '/usuarios/clave', clave: entorno.clavePhp };
    case 'USUARIOS:PATCH':
      return { api: 'php', metodoHttp: 'PATCH', ruta: '/usuarios/clave-admin', clave: entorno.clavePhp };
    case 'CUENTAS:GET':
      return { api: 'php', metodoHttp: 'GET', ruta: '/usuarios/lista', clave: entorno.clavePhp };
    case 'CUENTAS:POST':
      return { api: 'php', metodoHttp: 'POST', ruta: '/usuarios/crear', clave: entorno.clavePhp };
    case 'CLIENTES:POST':
      return { api: 'php', metodoHttp: 'POST', ruta: '/clientes', clave: entorno.clavePhp };
    case 'CLIENTES:GET': {
      const id = enteroPositivo(d.idcliente !== undefined ? d.idcliente : d.id);
      if (id) {
        return { api: 'php', metodoHttp: 'GET', ruta: '/clientes/' + id, clave: entorno.clavePhp };
      }
      const consulta = construirConsulta({ q: d.q, pagina: d.pagina, limite: d.limite });
      return { api: 'php', metodoHttp: 'GET', ruta: '/clientes' + consulta, clave: entorno.clavePhp };
    }
    case 'CAPTCHA:POST':
      return { api: 'php', metodoHttp: 'POST', ruta: '/captcha/generar', clave: entorno.clavePhp };
    case 'ALQUILERES:GET': {
      const id = enteroPositivo(d.idalquiler !== undefined ? d.idalquiler : d.id);
      if (id) {
        return { api: 'node', metodoHttp: 'GET', ruta: '/alquileres/' + id, clave: entorno.claveNode };
      }
      return { api: 'node', metodoHttp: 'GET', ruta: '/alquileres', clave: entorno.claveNode };
    }
    case 'ALQUILERES:POST':
      return { api: 'node', metodoHttp: 'POST', ruta: '/alquileres', clave: entorno.claveNode };
    case 'DEVOLUCION:PUT': {
      const id = enteroPositivo(d.idalquiler !== undefined ? d.idalquiler : d.id);
      if (!id) {
        return { error: 400, mensaje: 'Falta idalquiler para la devolución.' };
      }
      return { api: 'node', metodoHttp: 'PUT', ruta: '/alquileres/' + id + '/devolucion', clave: entorno.claveNode };
    }
    case 'DEVOLUCION:GET': {
      const id = enteroPositivo(d.idalquiler !== undefined ? d.idalquiler : d.id);
      if (!id) {
        return { api: 'node', metodoHttp: 'GET', ruta: '/alquileres', clave: entorno.claveNode };
      }
      return { api: 'node', metodoHttp: 'GET', ruta: '/alquileres/' + id, clave: entorno.claveNode };
    }
    case 'MAQUINARIAS:GET':
      return { api: 'python', metodoHttp: 'GET', ruta: '/maquinarias', clave: entorno.clavePython };
    case 'MAQUINARIAS:POST':
      return { api: 'python', metodoHttp: 'POST', ruta: '/maquinarias', clave: entorno.clavePython };
    case 'MAQUINARIAS:PATCH': {
      const id = enteroPositivo(d.idmaquinaria !== undefined ? d.idmaquinaria : d.id);
      if (!id) {
        return { error: 400, mensaje: 'Falta idmaquinaria.' };
      }
      return { api: 'python', metodoHttp: 'PATCH', ruta: '/maquinarias/' + id, clave: entorno.clavePython };
    }
    case 'MAQUINARIAS:DELETE': {
      const id = enteroPositivo(d.idmaquinaria !== undefined ? d.idmaquinaria : d.id);
      if (!id) {
        return { error: 400, mensaje: 'Falta idmaquinaria.' };
      }
      return { api: 'python', metodoHttp: 'DELETE', ruta: '/maquinarias/' + id, clave: entorno.clavePython };
    }
    case 'UNIDADES:POST':
      return { api: 'python', metodoHttp: 'POST', ruta: '/unidades/pormaquina', clave: entorno.clavePython };
    case 'UNIDADES:PUT': {
      const id = enteroPositivo(d.idunidad !== undefined ? d.idunidad : d.id);
      if (!id) {
        return { error: 400, mensaje: 'Falta idunidad.' };
      }
      return { api: 'python', metodoHttp: 'PUT', ruta: '/unidades/' + id + '/estado', clave: entorno.clavePython };
    }
    case 'FOTOS:POST':
      return { api: 'python', metodoHttp: 'POST', ruta: '/fotos', clave: entorno.clavePython };
    case 'REPORTES:GET':
      return { api: 'python', metodoHttp: 'GET', ruta: '/reportes/guardados', clave: entorno.clavePython };
    case 'REPORTES:POST': {
      const anidados = d.datos && typeof d.datos === 'object' ? d.datos : null;
      const tieneTitulo =
        (typeof d.titulo === 'string' && d.titulo.trim() !== '') ||
        (anidados && typeof anidados.titulo === 'string' && anidados.titulo.trim() !== '');
      if (tieneTitulo || d.guardar === true || d.accion === 'guardar') {
        return { api: 'python', metodoHttp: 'POST', ruta: '/reportes/guardados', clave: entorno.clavePython };
      }
      return { api: 'python', metodoHttp: 'POST', ruta: '/reportes/resumen', clave: entorno.clavePython };
    }
    case 'REPORTES:DELETE': {
      const id = enteroPositivo(d.idreporte !== undefined ? d.idreporte : d.id);
      if (!id) {
        return { error: 400, mensaje: 'Falta idreporte.' };
      }
      return { api: 'python', metodoHttp: 'DELETE', ruta: '/reportes/guardados/' + id, clave: entorno.clavePython };
    }
    case 'SOLICITUDES:GET': {
      const id = enteroPositivo(d.idsolicitud !== undefined ? d.idsolicitud : d.id);
      if (id) {
        return { api: 'node', metodoHttp: 'GET', ruta: '/solicitudes/' + id, clave: entorno.claveNode };
      }
      const estados = ['pendiente', 'aprobada', 'rechazada'];
      const consulta = typeof d.estado === 'string' && estados.includes(d.estado) ? '?estado=' + d.estado : '';
      return { api: 'node', metodoHttp: 'GET', ruta: '/solicitudes' + consulta, clave: entorno.claveNode };
    }
    case 'SOLICITUDES:POST':
      return { api: 'node', metodoHttp: 'POST', ruta: '/solicitudes', clave: entorno.claveNode };
    case 'SOLICITUDES:PUT': {
      const id = enteroPositivo(d.idsolicitud !== undefined ? d.idsolicitud : d.id);
      if (!id) {
        return { error: 400, mensaje: 'Falta idsolicitud.' };
      }
      if (d.accion === 'rechazar') {
        return { api: 'node', metodoHttp: 'PUT', ruta: '/solicitudes/' + id + '/rechazar', clave: entorno.claveNode };
      }
      return { api: 'node', metodoHttp: 'PUT', ruta: '/solicitudes/' + id + '/aprobar', clave: entorno.claveNode };
    }
    case 'NOTIFICACIONES:GET':
      return { api: 'node', metodoHttp: 'GET', ruta: '/notificaciones/lista', clave: entorno.claveNode };
    case 'NOTIFICACIONES:PUT': {
      if (d.todas === true) {
        return { api: 'node', metodoHttp: 'PUT', ruta: '/notificaciones/leer-todas', clave: entorno.claveNode };
      }
      const id = enteroPositivo(d.idnotificacion !== undefined ? d.idnotificacion : d.id);
      if (!id) {
        return { error: 400, mensaje: 'Falta idnotificacion (o use todas: true).' };
      }
      return { api: 'node', metodoHttp: 'PUT', ruta: '/notificaciones/' + id + '/leida', clave: entorno.claveNode };
    }
    default:
      return null;
  }
}

function baseDeApi(api) {
  if (api === 'php') {
    return entorno.urlApiPhp;
  }
  if (api === 'node') {
    return entorno.urlApiNode;
  }
  return entorno.urlApiPython;
}

async function reenviar(destino, cuerpo, contexto) {
  const base = baseDeApi(destino.api);
  const url = base + destino.ruta;
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_ESPERA_MS);
  const cabeceras = {
    'Content-Type': 'application/json',
    'X-Clave-Interna': destino.clave || '',
    'X-Rol': (contexto && contexto.rol) || '',
    'X-Usuario': (contexto && contexto.usuario) || ''
  };
  const opciones = {
    method: destino.metodoHttp,
    headers: cabeceras,
    signal: controlador.signal
  };
  if (destino.metodoHttp !== 'GET' && destino.metodoHttp !== 'HEAD') {
    opciones.body = JSON.stringify(cuerpo && typeof cuerpo === 'object' ? cuerpo : {});
  }
  try {
    const respuesta = await fetch(url, opciones);
    clearTimeout(temporizador);
    let datos = null;
    try {
      datos = await respuesta.json();
    } catch (e) {
      datos = null;
    }
    if (datos === null || typeof datos !== 'object') {
      datos = { ok: respuesta.ok, codigo: respuesta.status, mensaje: respuesta.ok ? 'Respuesta del servicio.' : 'Error del servicio.', datos: [] };
    }
    return { estado: respuesta.status, cuerpo: datos };
  } catch (e) {
    clearTimeout(temporizador);
    if (e && e.name === 'AbortError') {
      return { estado: 504, cuerpo: { ok: false, codigo: 504, mensaje: 'Tiempo de espera agotado.', datos: [] } };
    }
    return { estado: 502, cuerpo: { ok: false, codigo: 502, mensaje: 'Servicio no disponible.', datos: [] } };
  }
}

module.exports = { resolverDestino, reenviar, TIEMPO_ESPERA_MS };
