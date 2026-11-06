// Alquileres: crear (idempotente) y listar. Muestra valores del backend.
function prepararAlquileres() {
  pedir("CLIENTES", "GET", { busqueda: "", pagina: 1, limite: 200 }).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    const lista = Array.isArray(datos) ? datos : (datos && Array.isArray(datos.clientes) ? datos.clientes : []);
    const sel = document.getElementById("alqCliente");
    if (Array.isArray(lista)) {
      sel.innerHTML = lista.map(function (c) {
        return "<option value=\"" + Number(c.idcliente) + "\">" + sanitizarTexto(c.nombre) + " (" + sanitizarTexto(c.documento) + ")</option>";
      }).join("");
    }
  });
  pedir("MAQUINARIAS", "GET", {}).then(function () {
    cargarUnidadesDisponibles();
  });
  cargarAlquileres();
}

function cargarUnidadesDisponibles() {
  const sel = document.getElementById("alqUnidad");
  sel.innerHTML = "<option value=\"\">Cargando...</option>";
  pedir("MAQUINARIAS", "GET", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) {
      sel.innerHTML = "<option value=\"\">No disponible</option>";
      return;
    }
    const pendientes = [];
    datos.forEach(function (m) {
      if (Number(m.activo) !== 1 || Number(m.unidades_disponibles) <= 0) return;
      pendientes.push(pedir("UNIDADES", "POST", { idmaquinaria: Number(m.idmaquinaria) }).then(function (r) {
        const us = datosRespuesta(r);
        if (r && r.ok && Array.isArray(us)) {
          us.forEach(function (u) {
            if (String(u.estado) === "disponible") {
              const op = document.createElement("option");
              op.value = String(u.idunidad);
              op.textContent = m.nombre + " · " + u.serial + " (" + moneda(m.tarifadiaria) + ")";
              op.setAttribute("data-tarifa", String(m.tarifadiaria));
              sel.appendChild(op);
            }
          });
        }
      }));
    });
    Promise.all(pendientes).then(function () {
      if (sel.options.length === 0) sel.innerHTML = "<option value=\"\">Sin unidades disponibles</option>";
    });
  });
}

function guardarAlquiler() {
  const idcliente = Number(valorCampo("alqCliente"));
  const idunidad = Number(valorCampo("alqUnidad"));
  const desde = valorCampo("alqDesde");
  const hasta = valorCampo("alqHasta");
  const tarifa = Number(valorCampo("alqTarifa"));
  const movilizacion = Number(valorCampo("alqMovilizacion") || 0);
  if (!idcliente || !idunidad) {
    mostrarMensaje("mensajeAlquileres", "Seleccione cliente y unidad.", "error");
    return Promise.resolve(false);
  }
  if (!esFechaValida(desde) || !esFechaValida(hasta)) {
    mostrarMensaje("mensajeAlquileres", "Fechas inválidas (AAAA-MM-DD).", "error");
    return Promise.resolve(false);
  }
  if (hasta < desde) {
    mostrarMensaje("mensajeAlquileres", "La fecha programada debe ser posterior o igual.", "error");
    return Promise.resolve(false);
  }
  if (!Number.isFinite(tarifa) || tarifa <= 0) {
    mostrarMensaje("mensajeAlquileres", "Tarifa pactada positiva obligatoria.", "error");
    return Promise.resolve(false);
  }
  const clave = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("clave-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  return pedir("ALQUILERES", "POST", {
    idcliente: idcliente,
    idunidad: idunidad,
    fechalquiler: desde,
    fechadevolucionprogramada: hasta,
    tarifa_pactada: tarifa,
    costo_movilizacion_pactado: movilizacion,
    observaciones: valorCampo("alqObs"),
    clave_idempotencia: clave
  }).then(function (respuesta) {
    mostrarMensaje("mensajeAlquileres", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "aviso");
    if ((!respuesta || !respuesta.ok) && typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", "error");
    if (respuesta && respuesta.ok) {
      const datos = datosRespuesta(respuesta) || {};
      pedir("UNIDADES", "PUT", { idunidad: idunidad, estado: "alquilada" }).then(function () {
        cargarAlquileres();
        cargarUnidadesDisponibles();
      });
      mostrarMensaje("mensajeAlquileres", (respuesta.mensaje || "Alquiler registrado.") + " Total: " + moneda(datos.valortotal) + ".", "ok");
      if (typeof mostrarToast === "function") mostrarToast((respuesta.mensaje || "Alquiler registrado."), "ok");
    }
    return Boolean(respuesta && respuesta.ok);
  });
}

function cargarAlquileres() {
  pedir("ALQUILERES", "GET", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    const cuerpo = document.getElementById("tablaAlquileres");
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) {
      cuerpo.innerHTML = "<tr><td colspan=\"6\">" + sanitizarTexto((respuesta && respuesta.mensaje) || "No se pudo cargar.") + "</td></tr>";
      return;
    }
    cuerpo.innerHTML = datos.map(function (a) {
      const periodo = sanitizarTexto(a.fechalquiler || "") + " → " + sanitizarTexto(a.fechadevolucionprogramada || "");
      const estado = a.fechadevolucionreal ? "Devuelto" : (String(a.estado || "") === "moroso" ? "Moroso" : "Activo");
      return "<tr><td>" + entero(a.idalquiler) + "</td><td>" + entero(a.idcliente) + "</td><td>" + entero(a.idunidad) + "</td>" +
        "<td>" + periodo + "</td><td class=\"monto\">" + moneda(a.valortotal) + "</td><td>" + insignia(estado) + "</td></tr>";
    }).join("");
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const b = document.getElementById("botonGuardarAlquiler");
  if (b) b.addEventListener("click", function () { ejecutarAccion("botonGuardarAlquiler", guardarAlquiler); });
  const sel = document.getElementById("alqUnidad");
  if (sel) sel.addEventListener("change", function () {
    const op = sel.options[sel.selectedIndex];
    const tarifa = op ? op.getAttribute("data-tarifa") : "";
    if (tarifa) document.getElementById("alqTarifa").value = tarifa;
  });
  const imp = document.getElementById("botonImprimirAlquileres");
  if (imp) imp.addEventListener("click", function () { window.print(); });
});
