// Cliente HTTP del SPA. Todo pasa por el gateway (CONFIG.URL_API) con el
// formato {TOKEN, dat:{RAMA, METODO, DATOS}}. El token vive solo en memoria
// (variables de este archivo) y se pierde al recargar la pagina.
let TOKEN_MEMORIA = "";
let ROL_MEMORIA = "";
let USUARIO_MEMORIA = "";
let ID_USUARIO_MEMORIA = 0;

function haySesion() {
  return TOKEN_MEMORIA !== "";
}

function datosRespuesta(respuesta) {
  if (!respuesta || typeof respuesta !== "object") return null;
  return respuesta.datos === undefined ? null : respuesta.datos;
}

async function enviarAlGateway(token, rama, metodo, datos) {
  let cuerpo;
  try {
    const r = await fetch(CONFIG.URL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ TOKEN: token, dat: { RAMA: rama, METODO: metodo, DATOS: datos || {} } })
    });
    cuerpo = await r.json();
  } catch (e) {
    return { ok: false, codigo: 0, mensaje: "No se pudo contactar el servidor.", datos: null };
  }
  if (!cuerpo || typeof cuerpo !== "object") {
    return { ok: false, codigo: 0, mensaje: "Respuesta invalida del servidor.", datos: null };
  }
  return cuerpo;
}

function pedir(rama, metodo, datos) {
  return enviarAlGateway(TOKEN_MEMORIA, rama, metodo, datos).then(function (respuesta) {
    if (respuesta && respuesta.codigo === 401) {
      limpiarSesion();
      document.dispatchEvent(new CustomEvent("sesion-expirada"));
    }
    return respuesta;
  });
}

function pedirPublico(rama, metodo, datos) {
  return enviarAlGateway("", rama, metodo, datos);
}

function tomarSesion(datos) {
  const d = datos && typeof datos === "object" ? datos : {};
  TOKEN_MEMORIA = String(d.token || d.sesion || "");
  ROL_MEMORIA = String(d.rol || "");
  USUARIO_MEMORIA = String(d.nombre || d.usuario || "");
  ID_USUARIO_MEMORIA = Number(d.idusuario || 0);
}

function limpiarSesion() {
  TOKEN_MEMORIA = "";
  ROL_MEMORIA = "";
  USUARIO_MEMORIA = "";
  ID_USUARIO_MEMORIA = 0;
}
