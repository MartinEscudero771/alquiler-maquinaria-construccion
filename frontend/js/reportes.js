// Reportes: resumen del backend, guardar y borrar (admin). Solo presenta.
let resumenActual = null;

function prepararReportes() {
  cargarGuardados();
}

function cargarResumen() {
  return pedir("REPORTES", "POST", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    const caja = document.getElementById("resumenReporte");
    if (!respuesta || !respuesta.ok || !datos) {
      caja.innerHTML = "<div class=\"alert alert-danger\">" + sanitizarTexto((respuesta && respuesta.mensaje) || "No se pudo cargar.") + "</div>";
      return false;
    }
    resumenActual = datos;
    let maquinas = "";
    if (Array.isArray(datos.maquinas)) {
      maquinas = datos.maquinas.map(function (m) {
        const total = Number(m.total_unidades || 0);
        const disp = Number(m.disponibles || 0);
        const pct = total > 0 ? Math.round((disp / total) * 100) : 0;
        return "<li>" + sanitizarTexto(m.nombre) + ": " + entero(disp) + " de " + entero(total) + " disponibles" +
          "<div class=\"proporcion\" aria-hidden=\"true\"><span data-pct=\"" + pct + "\"></span></div></li>";
      }).join("");
      if (maquinas !== "") maquinas = "<ul>" + maquinas + "</ul>";
    }
    caja.innerHTML = "<div class=\"row row-cols-1 row-cols-md-3 g-3 mb-3\">" +
      "<div class=\"col\"><div class=\"tarjetaresumen\"><div class=\"texto-secundario\">Maquinarias</div><div class=\"numero\">" + entero(datos.total_maquinarias) + "</div></div></div>" +
      "<div class=\"col\"><div class=\"tarjetaresumen\"><div class=\"texto-secundario\">Unidades</div><div class=\"numero\">" + entero(datos.unidades_totales) + "</div></div></div>" +
      "<div class=\"col\"><div class=\"tarjetaresumen\"><div class=\"texto-secundario\">Disponibles</div><div class=\"numero\">" + entero(datos.disponibles) + "</div></div></div>" +
      "</div><div class=\"tarjetaresumen\">" + maquinas + "</div>";
    // Anchos de barras por CSSOM (compatible con CSP sin estilo en linea).
    caja.querySelectorAll(".proporcion > span").forEach(function (barra) {
      barra.style.width = Number(barra.getAttribute("data-pct") || 0) + "%";
    });
    return true;
  });
}

function guardarReporte() {
  const titulo = valorCampo("repTitulo");
  if (titulo === "") {
    mostrarMensaje("mensajeReportes", "Escriba un título.", "error");
    return Promise.resolve(false);
  }
  return pedir("REPORTES", "POST", { titulo: titulo }).then(function (respuesta) {
    mostrarMensaje("mensajeReportes", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
    if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
    if (respuesta && respuesta.ok) {
      document.getElementById("repTitulo").value = "";
      cargarGuardados();
    }
    return Boolean(respuesta && respuesta.ok);
  });
}

function cargarGuardados() {
  pedir("REPORTES", "GET", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    const cuerpo = document.getElementById("tablaReportes");
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) {
      cuerpo.innerHTML = "<tr><td colspan=\"5\">" + sanitizarTexto((respuesta && respuesta.mensaje) || "No se pudo cargar.") + "</td></tr>";
      return;
    }
    if (datos.length === 0) {
      cuerpo.innerHTML = "<tr><td colspan=\"5\">Sin reportes guardados.</td></tr>";
      return;
    }
    cuerpo.innerHTML = datos.map(function (r) {
      const borrar = ROL_MEMORIA === "admin"
        ? "<button type=\"button\" class=\"btn botonamarillo btn-sm\" data-borrar-rep=\"" + Number(r.idreporte) + "\">Eliminar</button>"
        : "—";
      return "<tr><td>" + sanitizarTexto(r.titulo) + "</td><td>" + sanitizarTexto(String(r.fecha || "").slice(0, 10)) + "</td>" +
        "<td>" + entero(r.total_contratos) + "</td><td class=\"monto\">" + moneda(r.ingresos) + "</td>" +
        (ROL_MEMORIA === "admin" ? "<td>" + borrar + "</td>" : "") + "</tr>";
    }).join("");
    cuerpo.querySelectorAll("[data-borrar-rep]").forEach(function (b) {
      b.addEventListener("click", function () {
        const id = Number(b.getAttribute("data-borrar-rep"));
        confirmarAccion("¿Eliminar el reporte guardado?").then(function (si) {
          if (!si) return;
          pedir("REPORTES", "DELETE", { idreporte: id }).then(function (respuesta) {
            mostrarMensaje("mensajeReportes", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
            if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
            if (respuesta && respuesta.ok) cargarGuardados();
          });
        });
      });
    });
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const bCargar = document.getElementById("botonCargarResumen");
  if (bCargar) bCargar.addEventListener("click", function () { ejecutarAccion("botonCargarResumen", cargarResumen); });
  const bGuardar = document.getElementById("botonGuardarReporte");
  if (bGuardar) bGuardar.addEventListener("click", function () { ejecutarAccion("botonGuardarReporte", guardarReporte); });
  const bImprimir = document.getElementById("botonImprimirReportes");
  if (bImprimir) bImprimir.addEventListener("click", function () { window.print(); });
});
