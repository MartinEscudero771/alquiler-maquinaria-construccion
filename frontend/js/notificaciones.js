// Notificaciones del equipo (campana en la esquina superior derecha).
// Consulta la rama NOTIFICACIONES (apinode) cada 60 s mientras haya
// sesion; al llegar avisos nuevos dispara toasts y enciende el badge.
let temporizadorNotificaciones = null;
let idsNotificacionConocidas = {};
let primeraCargaNotificaciones = true;

function iniciarNotificaciones() {
  if (temporizadorNotificaciones) return;
  primeraCargaNotificaciones = true;
  idsNotificacionConocidas = {};
  cargarNotificaciones();
  temporizadorNotificaciones = setInterval(cargarNotificaciones, 60000);
}

function detenerNotificaciones() {
  if (temporizadorNotificaciones) {
    clearInterval(temporizadorNotificaciones);
    temporizadorNotificaciones = null;
  }
  const contador = document.getElementById("contadorNotificaciones");
  if (contador) contador.classList.add("d-none");
  const lista = document.getElementById("listaNotificaciones");
  if (lista) lista.innerHTML = "";
  idsNotificacionConocidas = {};
}

function etiquetaCuando(fechaCorta) {
  // fecha "YYYY-MM-DD HH:MM:SS" -> "DD/MM HH:MM"
  const f = String(fechaCorta || "").slice(0, 19);
  const partes = f.split(" ");
  if (partes.length !== 2) return f;
  const dia = partes[0].split("-").reverse().join("/");
  return dia + " " + partes[1].slice(0, 5);
}

async function cargarNotificaciones() {
  if (typeof haySesion !== "function" || !haySesion()) {
    detenerNotificaciones();
    return;
  }
  try {
    const respuesta = await pedir("NOTIFICACIONES", "GET", {});
    if (!respuesta || !respuesta.ok || respuesta.codigo === 401) {
      if (respuesta && respuesta.codigo === 401) detenerNotificaciones();
      return;
    }
    const datos = datosRespuesta(respuesta) || {};
    const lista = Array.isArray(datos.notificaciones) ? datos.notificaciones : [];
    const sinLeer = Number(datos.no_leidas || 0);
    const contador = document.getElementById("contadorNotificaciones");
    if (contador) {
      contador.textContent = String(sinLeer);
      contador.classList.toggle("d-none", sinLeer === 0);
    }
    const listaEl = document.getElementById("listaNotificaciones");
    if (listaEl) {
      if (lista.length === 0) {
        listaEl.innerHTML = '<div class="px-3 py-3 texto-secundario mb-0">No hay notificaciones todavía.</div>';
      } else {
        listaEl.innerHTML = lista.map(function (n) {
          const leida = Number(n.leida) === 1;
          const nivel = ["info", "exito", "aviso", "error"].includes(String(n.nivel)) ? String(n.nivel) : "info";
          const aria = leida ? "Notificación leída" : "Notificación sin leer";
          return '<button type="button" class="item-notificacion nivel-' + nivel + (leida ? " leida" : "") + '" data-id="' + entero(n.idnotificacion) + '" aria-label="' + aria + '">' +
            '<span class="borde-nivel" aria-hidden="true"></span>' +
            '<span class="cuerpo-notificacion"><span class="titulo-notificacion">' + sanitizarTexto(n.titulo) + '</span>' +
            '<span class="texto-notificacion">' + sanitizarTexto(n.mensaje) + '</span>' +
            '<span class="cuando-notificacion">' + sanitizarTexto(n.rama) + ' · ' + sanitizarTexto(etiquetaCuando(n.fecha)) + '</span></span></button>';
        }).join("");
      }
    }
    // Toasts solo para avisos nuevos (despues de la primera carga).
    lista.forEach(function (n) {
      const id = Number(n.idnotificacion);
      const nuevo = !idsNotificacionConocidas[id];
      idsNotificacionConocidas[id] = true;
      if (!primeraCargaNotificaciones && nuevo && Number(n.leida) !== 1 && typeof mostrarToast === "function") {
        mostrarToast(sanitizarTexto(n.titulo), n.nivel === "error" ? "mal" : n.nivel === "exito" ? "ok" : "aviso");
      }
    });
    primeraCargaNotificaciones = false;
  } catch (e) {
    // silencioso: la campana reintenta en el siguiente ciclo
  }
}

async function marcarLeida(id) {
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) return;
  try {
    const respuesta = await pedir("NOTIFICACIONES", "PUT", { idnotificacion: Number(id) });
    if (respuesta && respuesta.ok) cargarNotificaciones();
  } catch (e) { /* sin dato */ }
}

async function marcarTodasLeidas() {
  try {
    const respuesta = await pedir("NOTIFICACIONES", "PUT", { todas: true });
    if (respuesta && respuesta.ok) {
      if (typeof mostrarToast === "function") {
        const datos = datosRespuesta(respuesta) || {};
        mostrarToast("Notificaciones marcadas: " + entero(datos.actualizadas || 0) + ".", "ok");
      }
      cargarNotificaciones();
    }
  } catch (e) { /* sin dato */ }
}

document.addEventListener("DOMContentLoaded", function () {
  const btnTodas = document.getElementById("botonLeerTodas");
  if (btnTodas) btnTodas.addEventListener("click", marcarTodasLeidas);
  const listaEl = document.getElementById("listaNotificaciones");
  if (listaEl) {
    listaEl.addEventListener("click", function (ev) {
      const item = ev.target.closest && ev.target.closest("button.item-notificacion");
      if (!item) return;
      const id = Number(item.getAttribute("data-id"));
      if (!Number.isInteger(id) || id <= 0) return;
      if (item.classList.contains("leida")) return;
      marcarLeida(id);
    });
  }
});