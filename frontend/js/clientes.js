// Clientes: crear y listar. Solo presenta respuestas del backend.
function cargarClientes() {
  const q = valorCampo("cliBusqueda");
  pedir("CLIENTES", "GET", { busqueda: q, pagina: 1, limite: 50 }).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    const cuerpo = document.getElementById("tablaClientes");
    if (!respuesta || !respuesta.ok) {
      cuerpo.innerHTML = "<tr><td colspan=\"4\">" + sanitizarTexto((respuesta && respuesta.mensaje) || "No se pudo cargar.") + "</td></tr>";
      return;
    }
    const lista = Array.isArray(datos) ? datos : (datos && Array.isArray(datos.clientes) ? datos.clientes : []);
    if (lista.length === 0) {
      cuerpo.innerHTML = "<tr><td colspan=\"4\">Sin clientes registrados.</td></tr>";
      return;
    }
    cuerpo.innerHTML = lista.map(function (c) {
      return "<tr><td>" + sanitizarTexto(c.nombre) + "</td><td>" + sanitizarTexto(c.documento) + "</td>" +
        "<td>" + sanitizarTexto(c.telefono || "—") + "</td><td>" + sanitizarTexto(c.correo || "—") + "</td></tr>";
    }).join("");
  });
}

function guardarCliente() {
  const nombre = valorCampo("cliNombre");
  const documento = valorCampo("cliDocumento");
  const telefono = valorCampo("cliTelefono");
  const correo = valorCampo("cliCorreo");
  const direccion = valorCampo("cliDireccion");
  if (nombre === "" || documento === "") {
    mostrarMensaje("mensajeClientes", "Nombre y documento son obligatorios.", "error");
    return Promise.resolve(false);
  }
  if (telefono === "" && correo === "") {
    mostrarMensaje("mensajeClientes", "Indique teléfono o correo.", "error");
    return Promise.resolve(false);
  }
  if (correo !== "" && !esCorreoValido(correo)) {
    mostrarMensaje("mensajeClientes", "El correo no es válido.", "error");
    return Promise.resolve(false);
  }
  return pedir("CLIENTES", "POST", { nombre: nombre, documento: documento, telefono: telefono || null, correo: correo || null, direccion: direccion || null }).then(function (respuesta) {
    mostrarMensaje("mensajeClientes", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
    if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
    if (respuesta && respuesta.ok) {
      ["cliNombre", "cliDocumento", "cliTelefono", "cliCorreo", "cliDireccion"].forEach(function (id) { document.getElementById(id).value = ""; });
      cargarClientes();
    }
    return Boolean(respuesta && respuesta.ok);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const bGuardar = document.getElementById("botonGuardarCliente");
  if (bGuardar) bGuardar.addEventListener("click", function () { ejecutarAccion("botonGuardarCliente", guardarCliente); });
  const bBuscar = document.getElementById("botonBuscarClientes");
  if (bBuscar) bBuscar.addEventListener("click", cargarClientes);
});
