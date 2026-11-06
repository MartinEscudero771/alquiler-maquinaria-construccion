// Unidades: listar por maquinaria y cambiar estado. Solo presenta backend.
function prepararUnidades() {
  pedir("MAQUINARIAS", "GET", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    const sel = document.getElementById("uniMaquinaria");
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) return;
    sel.innerHTML = datos.map(function (m) {
      return "<option value=\"" + Number(m.idmaquinaria) + "\">" + sanitizarTexto(m.nombre) + "</option>";
    }).join("");
  });
}

function cargarUnidades() {
  const id = Number(valorCampo("uniMaquinaria"));
  if (!id) return;
  pedir("UNIDADES", "POST", { idmaquinaria: id }).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    const cuerpo = document.getElementById("tablaUnidades");
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) {
      cuerpo.innerHTML = "<tr><td colspan=\"3\">" + sanitizarTexto((respuesta && respuesta.mensaje) || "No se pudo cargar.") + "</td></tr>";
      return;
    }
    const puede = ROL_MEMORIA === "admin" || ROL_MEMORIA === "operador";
    cuerpo.innerHTML = datos.map(function (u) {
      let accion = "—";
      if (puede && String(u.estado) !== "alquilada") {
        accion = "<select class=\"form-select form-select-sm\" data-unidad=\"" + Number(u.idunidad) + "\">" +
          ["disponible", "en_inspeccion", "en_reparacion"].map(function (e) {
            return "<option value=\"" + e + "\"" + (e === String(u.estado) ? " selected" : "") + ">" + e + "</option>";
          }).join("") + "</select> " +
          "<button type=\"button\" class=\"btn botonamarillo btn-sm mt-1\" data-guardar=\"" + Number(u.idunidad) + "\">Aplicar</button>";
      } else if (puede) {
        accion = "Ocupada por alquiler activo";
      }
      return "<tr><td>" + sanitizarTexto(u.serial) + "</td><td>" + insignia(String(u.estado)) + "</td>" +
        (puede ? "<td>" + accion + "</td>" : "") + "</tr>";
    }).join("");
    cuerpo.querySelectorAll("[data-guardar]").forEach(function (b) {
      b.addEventListener("click", function () {
        const idu = Number(b.getAttribute("data-guardar"));
        const sel = cuerpo.querySelector("select[data-unidad=\"" + idu + "\"]");
        const estado = sel ? sel.value : "";
        ejecutarAccion("botonCargarUnidades", function () {
          return pedir("UNIDADES", "PUT", { idunidad: idu, estado: estado }).then(function (respuesta) {
            mostrarMensaje("mensajeUnidades", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
            if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
            if (respuesta && respuesta.ok) cargarUnidades();
            return Boolean(respuesta && respuesta.ok);
          });
        });
      });
    });
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const b = document.getElementById("botonCargarUnidades");
  if (b) b.addEventListener("click", cargarUnidades);
});
