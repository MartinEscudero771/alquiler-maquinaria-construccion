// Utilidades de presentacion. Nada aqui decide negocio: solo muestra texto,
// confirma acciones, valida formato basico y formatea moneda en pantalla.
const fmtCOPEntero = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmtCOPDecimal = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEntero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

function moneda(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? fmtCOPEntero.format(n) : fmtCOPDecimal.format(n);
}

function entero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? fmtEntero.format(Math.trunc(n)) : "—";
}

function valorCampo(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || "").trim() : "";
}

function sanitizarTexto(texto) {
  return String(texto === null || texto === undefined ? "" : texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

function mostrarMensaje(id, texto, tipo) {
  const el = document.getElementById(id);
  if (!el) return;
  let clase = "alert-danger";
  if (tipo === "ok") clase = "alert-success";
  else if (tipo === "info") clase = "alert-info";
  else if (tipo === "aviso") clase = "alert-warning";
  el.className = "alert mt-2 " + clase;
  el.textContent = String(texto || "");
}

function ocultarMensaje(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = "alert d-none mt-2";
  el.textContent = "";
}

const botonesOcupados = {};

function ejecutarAccion(idBoton, fn) {
  if (botonesOcupados[idBoton]) return Promise.resolve(false);
  const boton = document.getElementById(idBoton);
  const htmlOriginal = boton ? boton.innerHTML : "";
  botonesOcupados[idBoton] = true;
  if (boton) {
    boton.disabled = true;
    boton.classList.add("cargando");
    boton.innerHTML = "<span class=\"spinner\" aria-hidden=\"true\"></span> Cargando...";
  }
  let resultado;
  try {
    resultado = Promise.resolve().then(fn);
  } catch (e) {
    botonesOcupados[idBoton] = false;
    if (boton) {
      boton.disabled = false;
      boton.classList.remove("cargando");
      boton.innerHTML = htmlOriginal;
    }
    return Promise.resolve(false);
  }
  return resultado.then(function (v) { return v; }).catch(function () { return false; }).then(function (v) {
    botonesOcupados[idBoton] = false;
    if (boton) {
      boton.disabled = false;
      boton.classList.remove("cargando");
      boton.innerHTML = htmlOriginal;
    }
    return v;
  });
}

let confirmarResolver = null;

function confirmarAccion(mensaje) {
  const texto = document.getElementById("mensajeConfirmar");
  if (texto) texto.textContent = String(mensaje || "¿Confirmar?");
  const modal = new bootstrap.Modal(document.getElementById("modalConfirmar"));
  modal.show();
  return new Promise(function (resolver) { confirmarResolver = resolver; });
}

function esCorreoValido(correo) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(correo || ""));
}

function esFechaValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ""))) return false;
  const partes = String(fecha).split("-").map(Number);
  const d = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2]));
  return d.getUTCFullYear() === partes[0] && (d.getUTCMonth() + 1) === partes[1] && d.getUTCDate() === partes[2];
}

function fechaHoy() {
  const ahora = new Date();
  const y = ahora.getFullYear();
  const m = String(ahora.getMonth() + 1).padStart(2, "0");
  const d = String(ahora.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

// Insignia de estado: siempre icono + texto, nunca solo color.
// Solo presentacion; el texto se sanitiza igual que el resto de la tabla.
function insignia(estado) {  const t = String(estado || "").toLowerCase();
  let clase = "insignia-info";
  let icono = "bi-info-circle";
  if (["disponible", "activa", "activo", "aprobada", "devuelto", "bueno", "ninguno"].indexOf(t) >= 0) {
    clase = "insignia-ok";
    icono = "bi-check-circle";
  } else if (["alquilada", "moroso", "rechazada", "malo", "alto", "inactivo"].indexOf(t) >= 0) {
    clase = "insignia-mal";
    icono = "bi-x-circle";
  } else if (["mantenimiento", "en_reparacion", "en_inspeccion", "pendiente", "regular", "medio", "bajo", "bloqueado temporal", "temporal"].indexOf(t) >= 0) {
    clase = "insignia-aviso";
    icono = "bi-exclamation-triangle";
  }
  return "<span class=\"insignia " + clase + "\"><i class=\"bi " + icono + "\"></i> " + sanitizarTexto(String(estado || "—")) + "</span>";
}

// Avisos flotantes (toasts). Conviven con mostrarMensaje: los toasts
// confirman el resultado de la accion, las alertas inline quedan para
// errores de validacion del formulario.
function mostrarToast(texto, tipo) {
  let zona = document.getElementById("zonaToasts");
  if (!zona) return;
  const aviso = document.createElement("div");
  aviso.className = "toast-msg " + (tipo === "ok" ? "toast-ok" : tipo === "aviso" ? "toast-aviso" : "toast-mal");
  aviso.setAttribute("role", "status");
  const icono = document.createElement("i");
  icono.className = "bi " + (tipo === "ok" ? "bi-check-circle" : tipo === "aviso" ? "bi-exclamation-triangle" : "bi-x-circle");
  icono.setAttribute("aria-hidden", "true");
  aviso.appendChild(icono);
  aviso.appendChild(document.createTextNode(" " + String(texto || "")));
  zona.appendChild(aviso);
  while (zona.children.length > 3) zona.removeChild(zona.firstChild);
  setTimeout(function () {
    aviso.classList.add("salir");
    setTimeout(function () { if (aviso.parentNode === zona) zona.removeChild(aviso); }, 250);
  }, 4000);
}

// Contador animado de 0 al valor real (~900ms). Solo presentacion.
function animarContador(el, valorFinal, duracion) {
  if (!el) return;
  const final = Number(valorFinal) || 0;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = entero(final);
    return;
  }
  const total = duracion || 900;
  const inicio = performance.now();
  function paso(ahora) {
    const p = Math.min(1, (ahora - inicio) / total);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = entero(Math.round(final * e));
    if (p < 1) requestAnimationFrame(paso);
  }
  requestAnimationFrame(paso);
}

function observarContador(el, valorFinal) {
  if (!el) return;
  if (!("IntersectionObserver" in window)) {
    animarContador(el, valorFinal);
    return;
  }
  const obs = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (e) {
      if (e.isIntersecting) {
        animarContador(el, valorFinal);
        obs.unobserve(el);
      }
    });
  }, { threshold: 0.4 });
  obs.observe(el);
}
