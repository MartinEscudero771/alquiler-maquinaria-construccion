// Cambio de contrasena del usuario autenticado.
function cambiarClave() {
  const actual = document.getElementById("claActual").value;
  const nueva = document.getElementById("claNueva").value;
  const nueva2 = document.getElementById("claNueva2").value;
  if (!actual || !nueva || !nueva2) {
    mostrarMensaje("mensajeClave", "Complete los tres campos.", "error");
    return Promise.resolve(false);
  }
  if (nueva.length < 12 || nueva.length > 72) {
    mostrarMensaje("mensajeClave", "La clave nueva debe tener entre 12 y 72 caracteres.", "error");
    return Promise.resolve(false);
  }
  if (nueva !== nueva2) {
    mostrarMensaje("mensajeClave", "La confirmación no coincide.", "error");
    return Promise.resolve(false);
  }
  if (!ID_USUARIO_MEMORIA) {
    mostrarMensaje("mensajeClave", "Sesión inválida. Inicie sesión de nuevo.", "error");
    return Promise.resolve(false);
  }
  return pedir("USUARIOS", "PUT", { idusuario: ID_USUARIO_MEMORIA, actual: actual, nueva: nueva }).then(function (respuesta) {
    mostrarMensaje("mensajeClave", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
    if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
    if (respuesta && respuesta.ok) {
      document.getElementById("claActual").value = "";
      document.getElementById("claNueva").value = "";
      document.getElementById("claNueva2").value = "";
    }
    return Boolean(respuesta && respuesta.ok);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const b = document.getElementById("botonCambiarClave");
  if (b) b.addEventListener("click", function () { ejecutarAccion("botonCambiarClave", cambiarClave); });
});
