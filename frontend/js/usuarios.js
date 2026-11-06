// Gestion de cuentas + restablecimiento de contrasenas solo para admin.
// CUENTAS:GET/POST (gateway solo al rol admin) y USUARIOS:PATCH; PHP
// vuelve a exigir rol admin con la cabecera X-Rol.
function prepararUsuarios() {
  ocultarMensaje("mensajeReset");
  ocultarMensaje("mensajeUsuarios");
  ocultarMensaje("mensajeListaUsuarios");
  if (typeof cargarUsuarios === "function") cargarUsuarios();
}

function cargarUsuarios() {
  const cuerpo = document.getElementById("tablaUsuarios");
  if (!cuerpo) return;
  return pedir("CUENTAS", "GET", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) {
      cuerpo.innerHTML = "<tr><td colspan=\"5\">" + sanitizarTexto((respuesta && respuesta.mensaje) || "No se pudo cargar.") + "</td></tr>";
      return;
    }
    if (datos.length === 0) {
      cuerpo.innerHTML = "<tr><td colspan=\"5\">Sin usuarios registrados además del admin.</td></tr>";
      return;
    }
    cuerpo.innerHTML = datos.map(function (u) {
      const bloqueado = u.bloqueado_hasta && String(u.bloqueado_hasta) !== "" && new Date(String(u.bloqueado_hasta)) > new Date();
      const estado = Number(u.activo) === 1
        ? (bloqueado ? insignia("Bloqueado temporal") : insignia("Activo"))
        : insignia("Inactivo");
      const temporal = Number(u.debe_cambiar_clave) === 1 ? insignia("Temporal") : "—";
      return "<tr><td>" + sanitizarTexto(u.usuario) + "</td><td>" + sanitizarTexto(u.nombre) + "</td>" +
        "<td>" + insignia(u.rol === "admin" ? "Admin" : "Operador") + "</td>" +
        "<td>" + estado + "</td><td>" + temporal + "</td></tr>";
    }).join("");
  });
}

function crearUsuario() {
  const nombre = valorCampo("usrNombre");
  const usuario = valorCampo("usrUsuario").toLowerCase();
  const rol = valorCampo("usrRol") || "operador";
  const clave = document.getElementById("usrClave") ? document.getElementById("usrClave").value : "";
  if (nombre.length < 3 || nombre.length > 100) {
    mostrarMensaje("mensajeUsuarios", "Escriba el nombre completo del usuario.", "error");
    return Promise.resolve(false);
  }
  if (!/^[a-z0-9_.-]{4,30}$/.test(usuario)) {
    mostrarMensaje("mensajeUsuarios", "El usuario debe tener 4 a 30 caracteres: letras, números, punto, guion o guion bajo (sin espacios ni mayúsculas).", "error");
    return Promise.resolve(false);
  }
  if (rol !== "operador") {
    mostrarMensaje("mensajeUsuarios", "Seleccione un rol válido.", "error");
    return Promise.resolve(false);
  }
  if (clave.length < 12 || clave.length > 72) {
    mostrarMensaje("mensajeUsuarios", "La clave temporal debe tener entre 12 y 72 caracteres.", "error");
    return Promise.resolve(false);
  }
  return confirmarAccion("¿Crear la cuenta \"" + usuario + "\" con rol " + rol + "?").then(function (si) {
    if (!si) return false;
    return pedir("CUENTAS", "POST", { nombre: nombre, usuario: usuario, rol: rol, clave: clave }).then(function (respuesta) {
      const ok = Boolean(respuesta && respuesta.ok);
      mostrarMensaje("mensajeUsuarios", (respuesta && respuesta.mensaje) || "", ok ? "ok" : "error");
      if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", ok ? "ok" : "error");
      if (ok) {
        ["usrNombre", "usrUsuario", "usrClave"].forEach(function (id) { document.getElementById(id).value = ""; });
        cargarUsuarios();
      }
      return ok;
    });
  });
}

function restablecerClave() {
  const usuario = valorCampo("resUsuario");
  const nueva = document.getElementById("resNueva").value;
  const nueva2 = document.getElementById("resNueva2").value;
  if (usuario === "" || nueva === "" || nueva2 === "") {
    mostrarMensaje("mensajeReset", "Complete los tres campos.", "error");
    return Promise.resolve(false);
  }
  if (nueva.length < 12 || nueva.length > 72) {
    mostrarMensaje("mensajeReset", "La clave nueva debe tener entre 12 y 72 caracteres.", "error");
    return Promise.resolve(false);
  }
  if (nueva !== nueva2) {
    mostrarMensaje("mensajeReset", "La confirmación no coincide.", "error");
    return Promise.resolve(false);
  }
  return confirmarAccion("¿Restablecer la contraseña de " + usuario + "?").then(function (si) {
    if (!si) return false;
    return pedir("USUARIOS", "PATCH", { usuario: usuario, nueva: nueva }).then(function (respuesta) {
      mostrarMensaje("mensajeReset", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
      if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
      if (respuesta && respuesta.ok) {
        ["resUsuario", "resNueva", "resNueva2"].forEach(function (id) { document.getElementById(id).value = ""; });
        if (typeof cargarUsuarios === "function") cargarUsuarios();
      }
      return Boolean(respuesta && respuesta.ok);
    });
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const rest = document.getElementById("botonRestablecerClave");
  if (rest) rest.addEventListener("click", function () { ejecutarAccion("botonRestablecerClave", restablecerClave); });
  const crear = document.getElementById("botonCrearUsuario");
  if (crear) crear.addEventListener("click", function () { ejecutarAccion("botonCrearUsuario", crearUsuario); });
  const lista = document.getElementById("botonCargarUsuarios");
  if (lista) lista.addEventListener("click", function () { ejecutarAccion("botonCargarUsuarios", cargarUsuarios); });
});
