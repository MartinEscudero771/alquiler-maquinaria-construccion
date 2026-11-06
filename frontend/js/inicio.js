// Vista publica/privada, login con captcha, roles y cierre de sesion.
// El captcha es obligatorio siempre: el backend lo exige en cada login.
let captchaSeleccionado = "";
let modalLoginObj = null;

function obtenerModalLogin() {
  if (!modalLoginObj) {
    modalLoginObj = new bootstrap.Modal(document.getElementById("modalLogin"));
  }
  return modalLoginObj;
}

function mostrarVista(cual) {
  document.getElementById("vista-publica").classList.toggle("d-none", cual !== "publica");
  document.getElementById("vista-privada").classList.toggle("d-none", cual !== "privada");
  if (cual === "privada" && typeof iniciarNotificaciones === "function") iniciarNotificaciones();
  if (cual === "publica" && typeof detenerNotificaciones === "function") detenerNotificaciones();
  window.scrollTo(0, 0);
}

function mostrarModulo(nombre) {
  document.querySelectorAll("#vista-privada .modulo").forEach(function (s) { s.classList.add("d-none"); });
  const destino = document.getElementById("modulo-" + nombre);
  if (destino) destino.classList.remove("d-none");
  document.querySelectorAll("#menuLateral .botonmenu").forEach(function (b) {
    const activo = b.getAttribute("data-modulo") === nombre;
    b.classList.toggle("activo", activo);
    if (activo) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (nombre === "inicio" && typeof cargarResumenInicio === "function") cargarResumenInicio();
  if (nombre === "inicio" && typeof cargarDashboard === "function") cargarDashboard();
  if (nombre === "calendario" && typeof cargarCalendario === "function") cargarCalendario();
  if (nombre === "clientes" && typeof cargarClientes === "function") cargarClientes();
  if (nombre === "catalogo" && typeof cargarCatalogoPrivado === "function") cargarCatalogoPrivado();
  if (nombre === "maquinas" && typeof cargarAdminMaquinas === "function") cargarAdminMaquinas();
  if (nombre === "unidades" && typeof prepararUnidades === "function") prepararUnidades();
  if (nombre === "alquileres" && typeof prepararAlquileres === "function") prepararAlquileres();
  if (nombre === "devoluciones" && typeof prepararDevoluciones === "function") prepararDevoluciones();
  if (nombre === "reportes" && typeof prepararReportes === "function") prepararReportes();
  if (nombre === "solicitudes" && typeof prepararSolicitudes === "function") prepararSolicitudes();
  if (nombre === "usuarios" && typeof prepararUsuarios === "function") prepararUsuarios();
}

function aplicarRol() {
  const rol = ROL_MEMORIA || "";
  document.querySelectorAll("[data-rol]").forEach(function (el) {
    const permitidos = String(el.getAttribute("data-rol") || "").split(" ");
    el.classList.toggle("d-none", permitidos.indexOf(rol) < 0);
  });
  document.getElementById("usuarioActual").textContent = haySesion() && USUARIO_MEMORIA ? USUARIO_MEMORIA + " (" + rol + ")" : "-";
}

function abrirLogin(mensaje) {
  ocultarMensaje("mensajeLogin");
  if (mensaje) mostrarMensaje("mensajeLogin", mensaje, "info");
  document.getElementById("loginUsuario").value = "";
  document.getElementById("loginClave").value = "";
  captchaSeleccionado = "";
  pedirCaptcha();
}

function archivoCaptcha(nombre) {
  return "img/captcha/icono-" + nombre + ".png";
}

const NOMBRES_ICONOS = {
  aplanadora: "la Aplanadora",
  cargador: "el Cargador",
  compactadora: "la Compactadora",
  excavadora: "la Excavadora",
  grua: "la Grúa",
  mezcladora: "la Mezcladora"
};

function nombreIcono(nombre) {
  return NOMBRES_ICONOS[String(nombre)] || String(nombre);
}

function pedirCaptcha() {
  const caja = document.getElementById("cajaIconos");
  const texto = document.getElementById("textoCaptcha");
  caja.innerHTML = "";
  texto.textContent = "Captcha: cargando...";
  pedirPublico("CAPTCHA", "POST", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta) || {};
    if (!respuesta || !respuesta.ok || !datos.captcha_id || !datos.objetivo || !datos.opciones) {
      texto.textContent = "Captcha: no disponible";
      mostrarMensaje("mensajeLogin", (respuesta && respuesta.mensaje) || "No se pudo cargar el captcha.", "error");
      return;
    }
    document.getElementById("captchaId").value = String(datos.captcha_id);
    texto.textContent = "Captcha: seleccione " + nombreIcono(datos.objetivo) + ".";
    const opciones = Array.isArray(datos.opciones) ? datos.opciones.slice() : [];
    opciones.forEach(function (opcion) {
      const nombre = String(opcion);
      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "icono-captcha";
      boton.setAttribute("data-opcion", nombre);
      boton.setAttribute("aria-label", "Seleccione " + nombreIcono(nombre));
      const img = document.createElement("img");
      img.src = archivoCaptcha(nombre);
      img.alt = "Icono " + nombre;
      img.width = 56;
      img.height = 56;
      img.loading = "lazy";
      img.onerror = function () { img.onerror = null; img.src = "img/logo.png"; };
      boton.appendChild(img);
      boton.addEventListener("click", function () {
        captchaSeleccionado = nombre;
        caja.querySelectorAll(".icono-captcha").forEach(function (b) { b.classList.remove("seleccionado"); });
        boton.classList.add("seleccionado");
      });
      caja.appendChild(boton);
    });
  });
}

function intentarLogin() {
  const usuario = valorCampo("loginUsuario");
  const clave = document.getElementById("loginClave").value;
  const captchaId = valorCampo("captchaId");
  if (usuario === "" || clave === "") {
    mostrarMensaje("mensajeLogin", "Escriba el usuario y la clave.", "error");
    return Promise.resolve(false);
  }
  if (captchaId === "" || captchaSeleccionado === "") {
    mostrarMensaje("mensajeLogin", "Seleccione el icono del captcha.", "error");
    return Promise.resolve(false);
  }
  return pedirPublico("USUARIOS", "POST", {
    usuario: usuario,
    clave: clave,
    captcha_id: captchaId,
    captcha_respuesta: captchaSeleccionado
  }).then(function (respuesta) {
    const datos = datosRespuesta(respuesta) || {};
    if (!respuesta || !respuesta.ok || (!datos.token && !datos.sesion)) {
      mostrarMensaje("mensajeLogin", (respuesta && respuesta.mensaje) || "No se pudo iniciar sesion.", "error");
      captchaSeleccionado = "";
      pedirCaptcha();
      return false;
    }
    tomarSesion(datos);
    aplicarRol();
    obtenerModalLogin().hide();
    mostrarVista("privada");
    if (Number(datos.debe_cambiar_clave) === 1) {
      mostrarModulo("clave");
      mostrarMensaje("mensajeClave", "Por seguridad debe cambiar su contraseña antes de continuar.", "aviso");
    } else {
      mostrarModulo("inicio");
    }
    return true;
  });
}

function cerrarSesion() {
  limpiarSesion();
  mostrarVista("publica");
  cargarEstadisticasPublicas();
  if (typeof cargarCatalogoPublico === "function") cargarCatalogoPublico();
}

function cargarEstadisticasPublicas() {
  pedirPublico("MAQUINARIAS", "GET", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) return;
    let unidades = 0;
    let disponibles = 0;
    datos.forEach(function (m) {
      if (Number(m.activo) !== 1) return;
      unidades += Number(m.total_unidades || 0);
      disponibles += Number(m.unidades_disponibles || 0);
    });
    const n = datos.filter(function (m) { return Number(m.activo) === 1; }).length;
    observarContador(document.getElementById("statMaquinas"), n);
    observarContador(document.getElementById("statUnidades"), unidades);
    observarContador(document.getElementById("statDisponibles"), disponibles);
  });
}

function cargarResumenInicio() {  const fn = function (rama) {
    return haySesion() ? pedir(rama, "GET", {}) : pedirPublico(rama, "GET", {});
  };
  fn("MAQUINARIAS").then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) return;
    let unidades = 0;
    let disponibles = 0;
    datos.forEach(function (m) {
      unidades += Number(m.total_unidades || 0);
      disponibles += Number(m.unidades_disponibles || 0);
    });
    observarContador(document.getElementById("resumenMaquinas"), datos.length);
    observarContador(document.getElementById("resumenUnidades"), unidades);
    observarContador(document.getElementById("resumenDisponibles"), disponibles);
    const barra = document.getElementById("barraDisponibles");
    if (barra) barra.style.width = unidades > 0 ? Math.round((disponibles / unidades) * 100) + "%" : "0%";
  });
  const alq = haySesion() ? pedir("ALQUILERES", "GET", {}) : Promise.resolve(null);
  alq.then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) {
      document.getElementById("resumenActivos").textContent = haySesion() ? "—" : "0";
      return;
    }
    let activos = 0;
    datos.forEach(function (a) { if (!a.fechadevolucionreal) activos += 1; });
    document.getElementById("resumenActivos").textContent = entero(activos);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("#menuLateral [data-modulo]").forEach(function (b) {
    b.addEventListener("click", function () { mostrarModulo(b.getAttribute("data-modulo")); });
  });
  document.querySelectorAll('[data-filtro]').forEach(function (b) {
    b.addEventListener("click", function () {
      if (typeof fijarFiltroPublico === "function") fijarFiltroPublico(b.getAttribute("data-filtro"));
    });
  });
  const busqueda = document.getElementById("busquedaPublica");
  if (busqueda) busqueda.addEventListener("input", function () {
    if (typeof fijarBusquedaPublica === "function") fijarBusquedaPublica(busqueda.value);
  });
  const disp = document.getElementById("filtroDisponibilidad");
  if (disp) disp.addEventListener("change", function () {
    if (typeof fijarDisponibilidad === "function") fijarDisponibilidad(disp.value);
  });
  const pmin = document.getElementById("filtroPrecioMin");
  const pmax = document.getElementById("filtroPrecioMax");
  const aplicarPrecio = function () {
    if (typeof fijarPrecio === "function") fijarPrecio(pmin ? pmin.value : 0, pmax ? pmax.value : 0);
  };
  if (pmin) pmin.addEventListener("input", aplicarPrecio);
  if (pmax) pmax.addEventListener("input", aplicarPrecio);
  const orden = document.getElementById("ordenCatalogo");
  if (orden) orden.addEventListener("change", function () {
    if (typeof fijarOrden === "function") fijarOrden(orden.value);
  });
  const bLimpiar = document.getElementById("botonLimpiarFiltros");
  if (bLimpiar) bLimpiar.addEventListener("click", function () {
    if (typeof limpiarFiltrosPublicos === "function") limpiarFiltrosPublicos();
  });
  document.querySelectorAll('[data-filtropriv]').forEach(function (b) {
    b.addEventListener("click", function () {
      if (typeof fijarFiltroPrivado === "function") fijarFiltroPrivado(b.getAttribute("data-filtropriv"));
    });
  });
  const busquedaPriv = document.getElementById("busquedaPrivada");
  if (busquedaPriv) busquedaPriv.addEventListener("input", function () {
    if (typeof fijarBusquedaPrivada === "function") fijarBusquedaPrivada(busquedaPriv.value);
  });
  document.getElementById("botonAbrirLogin").addEventListener("click", function () {
    abrirLogin("");
    obtenerModalLogin().show();
  });
  const bOlvido = document.getElementById("botonOlvidoClave");
  if (bOlvido) bOlvido.addEventListener("click", function () {
    document.getElementById("cajaRecuperar").classList.remove("d-none");
    ocultarMensaje("mensajeLogin");
  });
  const bVolver = document.getElementById("botonVolverLogin");
  if (bVolver) bVolver.addEventListener("click", function () {
    document.getElementById("cajaRecuperar").classList.add("d-none");
  });
  document.getElementById("botonSalir").addEventListener("click", function () {
    ejecutarAccion("botonSalir", function () { cerrarSesion(); return Promise.resolve(true); });
  });
  document.getElementById("botonIngresar").addEventListener("click", function () {
    ejecutarAccion("botonIngresar", intentarLogin);
  });
  document.getElementById("botonRecargarCaptcha").addEventListener("click", function () {
    captchaSeleccionado = "";
    pedirCaptcha();
  });
  const bVer = document.getElementById("botonVerClave");
  if (bVer) bVer.addEventListener("click", function () {
    const campo = document.getElementById("loginClave");
    const mostrar = campo.type === "password";
    campo.type = mostrar ? "text" : "password";
    bVer.innerHTML = mostrar ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
  });
  document.getElementById("modalLogin").addEventListener("shown.bs.modal", function () {
    document.getElementById("loginUsuario").focus();
  });
  ["loginUsuario", "loginClave"].forEach(function (id) {
    document.getElementById(id).addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        ejecutarAccion("botonIngresar", intentarLogin);
      }
    });
  });
  const botonSi = document.getElementById("botonConfirmarSi");
  if (botonSi) botonSi.addEventListener("click", function () {
    bootstrap.Modal.getInstance(document.getElementById("modalConfirmar")).hide();
    if (confirmarResolver) {
      const r = confirmarResolver;
      confirmarResolver = null;
      r(true);
    }
  });
  document.getElementById("modalConfirmar").addEventListener("hidden.bs.modal", function () {
    if (confirmarResolver) {
      const r = confirmarResolver;
      confirmarResolver = null;
      r(false);
    }
  });
  document.addEventListener("sesion-expirada", function () {
    mostrarVista("publica");
    abrirLogin("La sesión terminó. Inicie sesión de nuevo.");
    obtenerModalLogin().show();
  });
  mostrarVista("publica");
  cargarEstadisticasPublicas();
  if (typeof cargarCatalogoPublico === "function") cargarCatalogoPublico();
});

// Mejoras visuales aditivas: chips con estado activo y seccion actual en la barra.
// No cambian la logica de filtrado ni de navegacion.
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("[data-filtro]").forEach(function (b) {
    if (b.getAttribute("data-filtro") === "todas") b.setAttribute("aria-pressed", "true");
    b.addEventListener("click", function () {
      document.querySelectorAll("[data-filtro]").forEach(function (x) {
        x.setAttribute("aria-pressed", x === b ? "true" : "false");
      });
    });
  });
  const enlaces = Array.prototype.slice.call(document.querySelectorAll(".encabezado-publico .nav-link[href^=\"#\"]"));
  if (!("IntersectionObserver" in window) || enlaces.length === 0) return;
  const mapa = {};
  enlaces.forEach(function (a) { mapa[a.getAttribute("href").slice(1)] = a; });
  const observador = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (e) {
      if (!e.isIntersecting) return;
      enlaces.forEach(function (a) {
        const esActiva = ("#" + e.target.id) === a.getAttribute("href");
        a.classList.toggle("activo", esActiva);
        if (esActiva) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  Object.keys(mapa).forEach(function (id) {
    const seccion = document.getElementById(id);
    if (seccion) observador.observe(seccion);
  });
});

// Barra publica compacta al hacer scroll (sombra + 6px menos de alto).
document.addEventListener("DOMContentLoaded", function () {
  const barra = document.querySelector(".encabezado-publico");
  if (!barra) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let programado = false;
  function aplicar() {
    programado = false;
    barra.classList.toggle("compacta", window.scrollY > 10);
  }
  window.addEventListener("scroll", function () {
    if (!programado) {
      programado = true;
      requestAnimationFrame(aplicar);
    }
  }, { passive: true });
  aplicar();
});
