// Devoluciones: registrar y listar activos. Muestra calculos del backend.
function prepararDevoluciones() {
  document.getElementById("devFecha").value = fechaHoy();
  pedir("ALQUILERES", "GET", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    const sel = document.getElementById("devAlquiler");
    const cuerpo = document.getElementById("tablaDevoluciones");
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) {
      sel.innerHTML = "<option value=\"\">No disponible</option>";
      return;
    }
    const activos = datos.filter(function (a) { return !a.fechadevolucionreal; });
    sel.innerHTML = activos.map(function (a) {
      return "<option value=\"" + Number(a.idalquiler) + "\">Contrato " + entero(a.idalquiler) + " · unidad " + entero(a.idunidad) + "</option>";
    }).join("") || "<option value=\"\">Sin contratos activos</option>";
    cuerpo.innerHTML = activos.map(function (a) {
      return "<tr><td>" + entero(a.idalquiler) + "</td><td>" + entero(a.idunidad) + "</td><td>" + sanitizarTexto(a.fechadevolucionprogramada || "") + "</td></tr>";
    }).join("") || "<tr><td colspan=\"3\">Sin contratos activos.</td></tr>";
  });
}

function guardarDevolucion() {
  const idalquiler = Number(valorCampo("devAlquiler"));
  const fecha = valorCampo("devFecha");
  const reparacion = Number(valorCampo("devReparacion") || 0);
  if (!idalquiler) {
    mostrarMensaje("mensajeDevoluciones", "Seleccione un contrato activo.", "error");
    return Promise.resolve(false);
  }
  if (!esFechaValida(fecha)) {
    mostrarMensaje("mensajeDevoluciones", "Fecha real inválida (AAAA-MM-DD).", "error");
    return Promise.resolve(false);
  }
  if (!Number.isFinite(reparacion) || reparacion < 0) {
    mostrarMensaje("mensajeDevoluciones", "La reparación no puede ser negativa.", "error");
    return Promise.resolve(false);
  }
  return pedir("DEVOLUCION", "PUT", {
    idalquiler: idalquiler,
    fechadevolucionreal: fecha,
    estadofisico: valorCampo("devEstado"),
    niveldesgaste: valorCampo("devDesgaste"),
    descripciondanos: valorCampo("devDanos"),
    valorreparacion: reparacion,
    observaciones: valorCampo("devObs")
  }).then(function (respuesta) {
    const datos = datosRespuesta(respuesta) || {};
    mostrarMensaje("mensajeDevoluciones", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
    if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
    if (respuesta && respuesta.ok) {
      document.getElementById("resultadoDevolucion").innerHTML =
        "<div class=\"alert alert-info\">Días: " + entero(datos.diasalquiler) + " · Retraso: " + entero(datos.diasretraso) +
        " · Total: <span class=\"monto\">" + moneda(datos.valortotal) + "</span> · Estado sugerido: " +
        sanitizarTexto(String(datos.estadofinal || "")) + "</div>";
      const siguiente = String(datos.estadofinal || "") === "en_reparacion" ? "en_reparacion"
        : (String(datos.estadofinal || "") === "en_inspeccion" ? "en_inspeccion" : "disponible");
      pedir("UNIDADES", "PUT", { idunidad: Number(datos.idunidad), estado: siguiente }).then(function () {
        prepararDevoluciones();
      });
    }
    return Boolean(respuesta && respuesta.ok);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const b = document.getElementById("botonGuardarDevolucion");
  if (b) b.addEventListener("click", function () { ejecutarAccion("botonGuardarDevolucion", guardarDevolucion); });
});
