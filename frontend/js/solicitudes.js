// Solicitudes publicas de alquiler y gestion interna (admin/operador).
// El visitante no inicia sesion. La aprobacion crea el alquiler en Node.
let filtroSolicitudes = "pendiente";
let solicitudSeleccionada = 0;

function cargarMaquinasSolicitud() {
  pedirPublico("MAQUINARIAS", "GET", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    const sel = document.getElementById("solMaquinaria");
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) {
      sel.innerHTML = "<option value=\"\">No disponible</option>";
      return;
    }
    sel.innerHTML = datos.filter(function (m) { return Number(m.activo) === 1; }).map(function (m) {
      return "<option value=\"" + Number(m.idmaquinaria) + "\">" + sanitizarTexto(m.nombre) + " (" + moneda(m.tarifadiaria) + " por día)</option>";
    }).join("") || "<option value=\"\">Sin maquinarias</option>";
  });
}

function enviarSolicitud() {
  // Honeypot: el campo oculto solWeb solo lo llenan robots. Respuesta
  // aparente y silenciosa, sin tocar el backend.
  const trampa = valorCampo("solWeb");
  if (trampa !== "") {
    mostrarMensaje("mensajeSolicitud", "Solicitud registrada. Le contactaremos pronto.", "ok");
    return Promise.resolve(true);
  }
  const nombre = valorCampo("solNombre");
  const documento = valorCampo("solDocumento");
  const telefono = valorCampo("solTelefono");
  const correo = valorCampo("solCorreo");
  const idmaquinaria = Number(valorCampo("solMaquinaria"));
  const desde = valorCampo("solDesde");
  const hasta = valorCampo("solHasta");
  if (nombre.length < 3 || nombre.length > 100) {
    mostrarMensaje("mensajeSolicitud", "Escriba su nombre completo.", "error");
    return Promise.resolve(false);
  }
  if (documento.length < 4 || documento.length > 20) {
    mostrarMensaje("mensajeSolicitud", "Escriba un documento válido.", "error");
    return Promise.resolve(false);
  }
  if (telefono === "" && correo === "") {
    mostrarMensaje("mensajeSolicitud", "Indique un teléfono o un correo para contactarle.", "error");
    return Promise.resolve(false);
  }
  if (correo !== "" && !esCorreoValido(correo)) {
    mostrarMensaje("mensajeSolicitud", "El correo no es válido.", "error");
    return Promise.resolve(false);
  }
  if (!idmaquinaria) {
    mostrarMensaje("mensajeSolicitud", "Seleccione una maquinaria.", "error");
    return Promise.resolve(false);
  }
  if (!esFechaValida(desde) || !esFechaValida(hasta) || hasta < desde) {
    mostrarMensaje("mensajeSolicitud", "Las fechas deben ser válidas y la final posterior o igual.", "error");
    return Promise.resolve(false);
  }
  return pedirPublico("SOLICITUDES", "POST", {
    nombre: nombre,
    documento: documento,
    telefono: telefono === "" ? null : telefono,
    correo: correo === "" ? null : correo,
    idmaquinaria: idmaquinaria,
    fechalquiler: desde,
    fechadevolucionprogramada: hasta,
    observaciones: valorCampo("solObs")
  }).then(function (respuesta) {
    const datos = datosRespuesta(respuesta) || {};
    if (respuesta && respuesta.ok) {
      mostrarMensaje("mensajeSolicitud", "Solicitud número " + entero(datos.idsolicitud) + " registrada. Le contactaremos pronto.", "ok");
      if (typeof mostrarToast === "function") mostrarToast("Solicitud número " + entero(datos.idsolicitud) + " registrada.", "ok");
      ["solNombre", "solDocumento", "solTelefono", "solCorreo", "solDesde", "solHasta", "solObs", "solWeb"].forEach(function (id) { document.getElementById(id).value = ""; });
      document.getElementById("mensajeSolicitud").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      mostrarMensaje("mensajeSolicitud", (respuesta && respuesta.mensaje) || "No se pudo enviar.", "error");
      if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "No se pudo enviar.", "error");
    }
    return Boolean(respuesta && respuesta.ok);
  });
}

function prepararSolicitudes() {
  cargarSolicitudes();
}

function cargarSolicitudes() {
  const datos = filtroSolicitudes === "" ? {} : { estado: filtroSolicitudes };
  pedir("SOLICITUDES", "GET", datos).then(function (respuesta) {
    const lista = datosRespuesta(respuesta);
    const cuerpo = document.getElementById("tablaSolicitudes");
    if (!respuesta || !respuesta.ok || !Array.isArray(lista)) {
      cuerpo.innerHTML = "<tr><td colspan=\"6\">" + sanitizarTexto((respuesta && respuesta.mensaje) || "No se pudo cargar.") + "</td></tr>";
      return;
    }
    if (lista.length === 0) {
      cuerpo.innerHTML = "<tr><td colspan=\"6\">Sin solicitudes.</td></tr>";
      return;
    }
    cuerpo.innerHTML = lista.map(function (s) {
      const periodo = sanitizarTexto(s.fechalquiler || "") + " → " + sanitizarTexto(s.fechadevolucionprogramada || "");
      const gestionar = String(s.estado) === "pendiente"
        ? "<button type=\"button\" class=\"btn botonamarillo btn-sm\" data-gestionar=\"" + Number(s.idsolicitud) + "\">Gestionar</button>"
        : "—";
      return "<tr><td>" + entero(s.idsolicitud) + "</td><td>" + sanitizarTexto(s.nombre) + " (" + sanitizarTexto(s.documento) + ")</td>" +
        "<td>" + entero(s.idmaquinaria) + "</td><td>" + periodo + "</td><td>" + insignia(String(s.estado || "")) + "</td>" +
        "<td>" + gestionar + "</td></tr>";
    }).join("");
    cuerpo.querySelectorAll("[data-gestionar]").forEach(function (b) {
      b.addEventListener("click", function () { seleccionarSolicitud(Number(b.getAttribute("data-gestionar"))); });
    });
  });
}

function seleccionarSolicitud(id) {
  solicitudSeleccionada = id;
  document.getElementById("gestionSolicitudNumero").value = String(id);
  document.getElementById("gestionSolicitudId").textContent = "n.º " + entero(id);
  document.getElementById("cajaGestionSolicitud").classList.remove("d-none");
  pedir("CLIENTES", "GET", { busqueda: "", pagina: 1, limite: 200 }).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    const lista = Array.isArray(datos) ? datos : (datos && Array.isArray(datos.clientes) ? datos.clientes : []);
    document.getElementById("apruebaCliente").innerHTML = lista.map(function (c) {
      return "<option value=\"" + Number(c.idcliente) + "\">" + sanitizarTexto(c.nombre) + " (" + sanitizarTexto(c.documento) + ")</option>";
    }).join("");
  });
  pedir("MAQUINARIAS", "GET", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    const sel = document.getElementById("apruebaUnidad");
    sel.innerHTML = "<option value=\"\">Cargando...</option>";
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
              op.textContent = m.nombre + " · " + u.serial;
              op.setAttribute("data-tarifa", String(m.tarifadiaria));
              sel.appendChild(op);
            }
          });
        }
      }));
    });
    Promise.all(pendientes).then(function () {
      if (sel.options.length <= 1) sel.innerHTML = "<option value=\"\">Sin unidades disponibles</option>";
    });
  });
  document.getElementById("cajaGestionSolicitud").scrollIntoView({ behavior: "smooth" });
}

function aprobarSolicitud() {
  const id = Number(document.getElementById("gestionSolicitudNumero").value);
  const idcliente = Number(valorCampo("apruebaCliente"));
  const idunidad = Number(valorCampo("apruebaUnidad"));
  const tarifa = Number(valorCampo("apruebaTarifa"));
  const movilizacion = Number(valorCampo("apruebaMovilizacion") || 0);
  if (!id || !idcliente || !idunidad) {
    mostrarMensaje("mensajeGestionSolicitud", "Seleccione cliente y unidad.", "error");
    return Promise.resolve(false);
  }
  if (!Number.isFinite(tarifa) || tarifa <= 0) {
    mostrarMensaje("mensajeGestionSolicitud", "Tarifa pactada positiva obligatoria.", "error");
    return Promise.resolve(false);
  }
  return pedir("SOLICITUDES", "PUT", {
    idsolicitud: id,
    accion: "aprobar",
    idcliente: idcliente,
    idunidad: idunidad,
    tarifa_pactada: tarifa,
    costo_movilizacion_pactado: movilizacion
  }).then(function (respuesta) {
    mostrarMensaje("mensajeGestionSolicitud", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
    if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
    if (respuesta && respuesta.ok) {
      document.getElementById("cajaGestionSolicitud").classList.add("d-none");
      cargarSolicitudes();
    }
    return Boolean(respuesta && respuesta.ok);
  });
}

function rechazarSolicitud() {
  const id = Number(document.getElementById("gestionSolicitudNumero").value);
  const motivo = valorCampo("rechazaMotivo");
  if (!id) return Promise.resolve(false);
  if (motivo.length < 3) {
    mostrarMensaje("mensajeGestionSolicitud", "Escriba el motivo del rechazo.", "error");
    return Promise.resolve(false);
  }
  return confirmarAccion("¿Rechazar la solicitud n.º " + id + "?").then(function (si) {
    if (!si) return false;
    return pedir("SOLICITUDES", "PUT", { idsolicitud: id, accion: "rechazar", motivo: motivo }).then(function (respuesta) {
      mostrarMensaje("mensajeGestionSolicitud", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
      if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
      if (respuesta && respuesta.ok) {
        document.getElementById("cajaGestionSolicitud").classList.add("d-none");
        document.getElementById("rechazaMotivo").value = "";
        cargarSolicitudes();
      }
      return Boolean(respuesta && respuesta.ok);
    });
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const bEnviar = document.getElementById("botonEnviarSolicitud");
  if (bEnviar) bEnviar.addEventListener("click", function () { ejecutarAccion("botonEnviarSolicitud", enviarSolicitud); });
  document.querySelectorAll("[data-filtro-sol]").forEach(function (b) {
    b.addEventListener("click", function () {
      filtroSolicitudes = b.getAttribute("data-filtro-sol") || "";
      cargarSolicitudes();
    });
  });
  const bAprobar = document.getElementById("botonAprobarSolicitud");
  if (bAprobar) bAprobar.addEventListener("click", function () { ejecutarAccion("botonAprobarSolicitud", aprobarSolicitud); });
  const bRechazar = document.getElementById("botonRechazarSolicitud");
  if (bRechazar) bRechazar.addEventListener("click", function () { ejecutarAccion("botonRechazarSolicitud", rechazarSolicitud); });
  const selUnidad = document.getElementById("apruebaUnidad");
  if (selUnidad) selUnidad.addEventListener("change", function () {
    const op = selUnidad.options[selUnidad.selectedIndex];
    const tarifa = op ? op.getAttribute("data-tarifa") : "";
    if (tarifa) document.getElementById("apruebaTarifa").value = tarifa;
  });
  cargarMaquinasSolicitud();
});

// Costo estimado del formulario publico (solo presentacion).
// No cambia el flujo de envio: lee la tarifa del catalogo ya cargado.
function tarifaDeMaquinaria(idmaquinaria) {
  if (typeof catalogoDatos === "undefined" || !Array.isArray(catalogoDatos)) return 0;
  const m = catalogoDatos.find(function (x) { return Number(x.idmaquinaria) === Number(idmaquinaria); });
  return m ? Number(m.tarifadiaria || 0) : 0;
}

function diasEntreFechas(desde, hasta) {
  if (!esFechaValida(desde) || !esFechaValida(hasta) || hasta < desde) return 0;
  const a = new Date(desde + "T00:00:00");
  const b = new Date(hasta + "T00:00:00");
  return Math.round((b - a) / 86400000) + 1;
}

function actualizarCostoEstimado() {
  const caja = document.getElementById("costoEstimado");
  if (!caja) return;
  const idmaq = Number(valorCampo("solMaquinaria"));
  const desde = valorCampo("solDesde");
  const hasta = valorCampo("solHasta");
  const tarifa = tarifaDeMaquinaria(idmaq);
  if (!idmaq || tarifa <= 0) {
    caja.textContent = "Seleccione la máquina y las fechas para ver el costo estimado.";
    return;
  }
  if (desde === "" || hasta === "") {
    caja.textContent = "Costo estimado: " + moneda(tarifa) + " por día. Elija las fechas para calcular el total.";
    return;
  }
  const dias = diasEntreFechas(desde, hasta);
  if (dias <= 0) {
    caja.textContent = "Revise las fechas: la fecha final debe ser igual o posterior a la inicial.";
    return;
  }
  caja.textContent = "Costo estimado: " + dias + (dias === 1 ? " día" : " días") + " × " + moneda(tarifa) + " = " + moneda(dias * tarifa) + ".";
}

// Validacion visual en vivo (no debilita la validacion del envio).
function marcarValidezSolicitud() {
  const hoy = fechaHoy();
  const desde = document.getElementById("solDesde");
  const hasta = document.getElementById("solHasta");
  const correo = document.getElementById("solCorreo");
  const maq = document.getElementById("solMaquinaria");
  if (desde && hoy) desde.min = hoy;
  if (hasta && hoy) hasta.min = hoy;
  if (desde && hasta && desde.value !== "" && hasta.value !== "" && esFechaValida(desde.value) && esFechaValida(hasta.value)) {
    const mal = hasta.value < desde.value;
    desde.classList.toggle("is-invalid", mal);
    hasta.classList.toggle("is-invalid", mal);
  } else {
    if (desde) desde.classList.remove("is-invalid");
    if (hasta) hasta.classList.remove("is-invalid");
  }
  if (correo) correo.classList.toggle("is-invalid", correo.value !== "" && !esCorreoValido(correo.value));
  if (maq) maq.classList.toggle("is-invalid", maq.value === "");
}

document.addEventListener("DOMContentLoaded", function () {
  ["solMaquinaria", "solDesde", "solHasta"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", function () { actualizarCostoEstimado(); marcarValidezSolicitud(); });
  });
  const correo = document.getElementById("solCorreo");
  if (correo) correo.addEventListener("input", marcarValidezSolicitud);
  actualizarCostoEstimado();
});
