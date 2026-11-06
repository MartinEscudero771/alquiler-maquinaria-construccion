// Catalogo publico y privado, detalle con galeria y administracion.
// Solo presenta datos del backend; no calcula negocio.
let catalogoDatos = [];
let filtroPublico = "todas";
let busquedaPublica = "";
let paginaPublica = 1;
let filtroPrivado = "todas";
let busquedaPrivada = "";
let paginaPrivada = 1;
const POR_PAGINA = 9;

let detalleFotos = [];
let detalleIndice = 0;

function fotoPrincipal(carpeta) {
  return "img/maquinaria/" + carpeta + "/foto01.jpg";
}

function imagenConRespaldo(src, alt) {
  return "<img src=\"" + src + "\" alt=\"" + sanitizarTexto(alt) + "\" loading=\"lazy\" decoding=\"async\" data-respaldo=\"1\">";
}

// Manejador unico de respaldo de imagenes (sin onerror en linea, compatible con CSP estricta).
document.addEventListener("error", function (e) {
  const img = e.target;
  if (!img || img.tagName !== "IMG" || !img.dataset.respaldo) return;
  if (img.dataset.intentos === "png") {
    img.dataset.intentos = "fin";
    img.src = "img/logo.png";
  } else if (img.dataset.intentos === "fin") {
    return;
  } else {
    img.dataset.intentos = "png";
    img.src = img.src.replace(".jpg", ".png");
  }
}, true);

function listaFiltrada() {
  return catalogoDatos.filter(function (m) {
    if (filtroPrivado !== "todas" && String(m.categoria || "") !== filtroPrivado) return false;
    if (busquedaPrivada !== "" && String(m.nombre || "").toLowerCase().indexOf(busquedaPrivada) < 0) return false;
    return true;
  });
}

let filtroDisponibilidad = "todas";
let precioMin = 0;
let precioMax = 0;
let ordenCatalogo = "relevancia";

function listaFiltradaPublica() {
  return catalogoDatos.filter(function (m) {
    if (Number(m.activo) !== 1) return false;
    if (filtroPublico !== "todas" && String(m.categoria || "") !== filtroPublico) return false;
    if (busquedaPublica !== "" && String(m.nombre || "").toLowerCase().indexOf(busquedaPublica) < 0) return false;
    if (filtroDisponibilidad === "disponibles" && Number(m.unidades_disponibles || 0) <= 0) return false;
    const tarifa = Number(m.tarifadiaria || 0);
    if (precioMin > 0 && tarifa < precioMin) return false;
    if (precioMax > 0 && tarifa > precioMax) return false;
    return true;
  }).sort(compararMaquinas);
}

function compararMaquinas(a, b) {
  if (ordenCatalogo === "nombre") return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es");
  if (ordenCatalogo === "precio-asc") return Number(a.tarifadiaria || 0) - Number(b.tarifadiaria || 0);
  if (ordenCatalogo === "precio-desc") return Number(b.tarifadiaria || 0) - Number(a.tarifadiaria || 0);
  if (ordenCatalogo === "disponibles") return Number(b.unidades_disponibles || 0) - Number(a.unidades_disponibles || 0);
  return 0;
}

function tarjetaMaquina(m, indice) {
  const i = Math.min(Math.max(Number(indice) || 0, 0), 6);  const disponibles = Number(m.unidades_disponibles || 0);
  const estado = disponibles > 0
    ? "<span class=\"disponible-ok\"><i class=\"bi bi-check-circle\"></i> " + entero(disponibles) + " disponibles</span>"
    : "<span class=\"disponible-no\"><i class=\"bi bi-x-circle\"></i> Sin unidades disponibles</span>";
  let extra = "";
  if (String(m.categoria) === "pesada") {
    extra = "<div class=\"texto-secundario\">Peso: " + sanitizarTexto(String(m.peso_toneladas || "—")) + " t · Movilización: " + moneda(m.costo_movilizacion) + "</div>";
  } else {
    const apta = Number(m.apta_zona_urbana) === 1 ? "Sí" : "No";
    extra = "<div class=\"texto-secundario\">Ancho: " + sanitizarTexto(String(m.ancho_metros || "—")) + " m · Apta zona urbana: " + apta + "</div>";
  }
  const botones = "<div class=\"d-grid gap-2 mt-auto\">" +
    "<button type=\"button\" class=\"btn botonacero\" data-detalle=\"" + Number(m.idmaquinaria) + "\"><i class=\"bi bi-eye\"></i> Ver detalles</button>" +
    (haySesion() ? "" : "<button type=\"button\" class=\"btn botonamarillo\" data-alquilar=\"" + Number(m.idmaquinaria) + "\"><i class=\"bi bi-clipboard-check\"></i> Solicitar</button>") +
    "</div>";
  return "<div class=\"col revelar i-" + i + "\"><div class=\"tarjeta-maquina\">" +
    "<div class=\"foto\">" + imagenConRespaldo(fotoPrincipal(m.carpeta), "Foto de " + m.nombre) + "<span class=\"categoria " + (String(m.categoria) === "pesada" ? "categoria-pesada" : "categoria-liviana") + "\">" + sanitizarTexto(String(m.categoria || "")) + "</span></div>" +
    "<div class=\"cuerpo\">" +
    "<h3 class=\"h5\">" + sanitizarTexto(m.nombre) + "</h3>" +
    "<div class=\"precio\">" + moneda(m.tarifadiaria) + " <small>por día</small></div>" +
    "<div>" + estado + "</div>" + extra + botones +
    "</div></div></div>";
}

function pintarTarjetas(destino, lista, pagina, alCambiar) {
  const cont = document.getElementById(destino);
  if (!cont) return;
  if (lista.length === 0) {
    if (alCambiar === "publica") {
      cont.innerHTML = "<div class=\"col-12\"><div class=\"vacio-catalogo\"><i class=\"bi bi-search\"></i><p class=\"mt-2\">No hay maquinarias que coincidan con los filtros.</p><button type=\"button\" class=\"btn botonoscuro\" data-limpiar-filtros=\"1\"><i class=\"bi bi-x-circle\"></i> Limpiar filtros</button></div></div>";
    } else {
      cont.innerHTML = "<div class=\"col-12\"><div class=\"alert alert-info\">No hay maquinarias para mostrar.</div></div>";
    }
  } else {
    const inicio = (pagina - 1) * POR_PAGINA;
    cont.innerHTML = lista.slice(inicio, inicio + POR_PAGINA).map(function (m, idx) { return tarjetaMaquina(m, idx); }).join("");
  observarRevelado(cont);
  const total = document.getElementById("conteoCatalogo");
  if (total && alCambiar === "publica") {
    total.textContent = "Mostrando " + entero(Math.min(lista.length, inicio + POR_PAGINA)) + " de " + entero(lista.length) + " máquinas.";
  }
  }
  cont.querySelectorAll("[data-detalle]").forEach(function (b) {
    b.addEventListener("click", function () { abrirDetalle(Number(b.getAttribute("data-detalle"))); });
  });
  cont.querySelectorAll("[data-alquilar]").forEach(function (b) {
    b.addEventListener("click", function () { irASolicitar(Number(b.getAttribute("data-alquilar"))); });
  });
  cont.querySelectorAll("[data-limpiar-filtros]").forEach(function (b) {
    b.addEventListener("click", function () { if (typeof limpiarFiltrosPublicos === "function") limpiarFiltrosPublicos(); });
  });
  const pag = document.getElementById(alCambiar === "publica" ? "paginacionPublico" : "paginacionPrivada");
  if (pag) {
    const total = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    let html = "";
    for (let i = 1; i <= total; i += 1) {
      html += "<button type=\"button\" class=\"btn " + (i === pagina ? "botonamarillo" : "botonoscuro") + "\" data-pagina=\"" + i + "\">" + i + "</button>";
    }
    pag.innerHTML = html;
    pag.querySelectorAll("[data-pagina]").forEach(function (b) {
      b.addEventListener("click", function () {
        const p = Number(b.getAttribute("data-pagina"));
        if (alCambiar === "publica") { paginaPublica = p; cargarCatalogoPublico(); }
        else { paginaPrivada = p; cargarCatalogoPrivado(); }
      });
    });
  }
}

function cargarCatalogo() {
  const fn = haySesion() ? pedir("MAQUINARIAS", "GET", {}) : pedirPublico("MAQUINARIAS", "GET", {});
  return fn.then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) return false;
    catalogoDatos = datos;
    return true;
  });
}

function mostrarEsqueletos(destino) {
  const cont = document.getElementById(destino);
  if (!cont) return;
  let html = "";
  for (let i = 0; i < 6; i += 1) {
    html += "<div class=\"col\"><div class=\"tarjeta-maquina\"><div class=\"esqueleto\"></div><div class=\"cuerpo\"><div class=\"esqueleto esqueleto-linea\"></div><div class=\"esqueleto esqueleto-linea\"></div></div></div></div>";
  }
  cont.innerHTML = html;
}

let observadorRevelado = null;

function observarRevelado(cont) {
  if (!("IntersectionObserver" in window)) {
    cont.querySelectorAll(".revelar").forEach(function (el) { el.classList.add("visible"); });
    return;
  }
  if (!observadorRevelado) {
    observadorRevelado = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          observadorRevelado.unobserve(e.target);
        }
      });
    }, { threshold: 0.1 });
  }
  cont.querySelectorAll(".revelar").forEach(function (el) { observadorRevelado.observe(el); });
}

function cargarCatalogoPublico() {
  mostrarEsqueletos("catalogoPublico");
  const caja = document.getElementById("mensajeCatalogo");
  cargarCatalogo().then(function (ok) {
    if (!ok) {
      if (caja) mostrarMensaje("mensajeCatalogo", "No se pudo cargar el catálogo.", "error");
      return;
    }
    if (caja) ocultarMensaje("mensajeCatalogo");
    pintarTarjetas("catalogoPublico", listaFiltradaPublica(), paginaPublica, "publica");
  });
}

function cargarCatalogoPrivado() {
  cargarCatalogo().then(function (ok) {
    if (!ok) return;
    pintarTarjetas("catalogoPrivado", listaFiltrada(), paginaPrivada, "privada");
  });
}

function fijarFiltroPublico(f) { filtroPublico = f; paginaPublica = 1; pintarTarjetas("catalogoPublico", listaFiltradaPublica(), paginaPublica, "publica"); }
function fijarBusquedaPublica(t) { busquedaPublica = String(t || "").toLowerCase().trim(); paginaPublica = 1; pintarTarjetas("catalogoPublico", listaFiltradaPublica(), paginaPublica, "publica"); }
function fijarFiltroPrivado(f) { filtroPrivado = f; paginaPrivada = 1; pintarTarjetas("catalogoPrivado", listaFiltrada(), paginaPrivada, "privada"); }
function fijarBusquedaPrivada(t) { busquedaPrivada = String(t || "").toLowerCase().trim(); paginaPrivada = 1; pintarTarjetas("catalogoPrivado", listaFiltrada(), paginaPrivada, "privada"); }
function fijarDisponibilidad(v) { filtroDisponibilidad = v === "disponibles" ? "disponibles" : "todas"; paginaPublica = 1; pintarTarjetas("catalogoPublico", listaFiltradaPublica(), paginaPublica, "publica"); }
function fijarPrecio(min, max) {
  precioMin = Number(min) > 0 ? Number(min) : 0;
  precioMax = Number(max) > 0 ? Number(max) : 0;
  paginaPublica = 1;
  pintarTarjetas("catalogoPublico", listaFiltradaPublica(), paginaPublica, "publica");
}
function fijarOrden(v) {
  const validos = ["relevancia", "nombre", "precio-asc", "precio-desc", "disponibles"];
  ordenCatalogo = validos.indexOf(v) >= 0 ? v : "relevancia";
  paginaPublica = 1;
  pintarTarjetas("catalogoPublico", listaFiltradaPublica(), paginaPublica, "publica");
}
function limpiarFiltrosPublicos() {
  filtroPublico = "todas";
  busquedaPublica = "";
  filtroDisponibilidad = "todas";
  precioMin = 0;
  precioMax = 0;
  ordenCatalogo = "relevancia";
  paginaPublica = 1;
  const b = document.getElementById("busquedaPublica");
  if (b) b.value = "";
  const d = document.getElementById("filtroDisponibilidad");
  if (d) d.value = "todas";
  const n = document.getElementById("filtroPrecioMin");
  if (n) n.value = "";
  const x = document.getElementById("filtroPrecioMax");
  if (x) x.value = "";
  const o = document.getElementById("ordenCatalogo");
  if (o) o.value = "relevancia";
  pintarTarjetas("catalogoPublico", listaFiltradaPublica(), paginaPublica, "publica");
}

function fotosExistentes(carpeta) {
  const candidatas = [];
  for (let i = 1; i <= 10; i += 1) {
    const n = String(i).padStart(2, "0");
    candidatas.push("img/maquinaria/" + carpeta + "/foto" + n + ".jpg");
  }
  const existentes = [];
  let pendientes = candidatas.length;
  return new Promise(function (resolver) {
    if (pendientes === 0) { resolver([]); return; }
    candidatas.forEach(function (src) {
      const img = new Image();
      img.onload = function () { existentes.push(src); if (--pendientes === 0) resolver(existentes.sort()); };
      img.onerror = function () {
        const png = src.replace(".jpg", ".png");
        const img2 = new Image();
        img2.onload = function () { existentes.push(png); if (--pendientes === 0) resolver(existentes.sort()); };
        img2.onerror = function () { if (--pendientes === 0) resolver(existentes.sort()); };
        img2.src = png;
      };
      img.src = src;
    });
  });
}

function abrirDetalle(idmaquinaria) {
  const m = catalogoDatos.find(function (x) { return Number(x.idmaquinaria) === Number(idmaquinaria); });
  if (!m) return;
  document.getElementById("detalleNombre").textContent = String(m.nombre || "Maquinaria");
  const disponibles = Number(m.unidades_disponibles || 0);
  let extra = "";
  if (String(m.categoria) === "pesada") {
    extra = "<p><strong>Peso:</strong> " + sanitizarTexto(String(m.peso_toneladas || "—")) + " t<br><strong>Movilización:</strong> " + moneda(m.costo_movilizacion) + "</p>";
  } else {
    extra = "<p><strong>Ancho:</strong> " + sanitizarTexto(String(m.ancho_metros || "—")) + " m<br><strong>Apta zona urbana:</strong> " + (Number(m.apta_zona_urbana) === 1 ? "Sí" : "No") + "</p>";
  }
  document.getElementById("detalleInfo").innerHTML =
    "<p><strong>Categoría:</strong> " + sanitizarTexto(String(m.categoria || "")) + "</p>" +
    "<p><strong>Tarifa por día:</strong> <span class=\"monto\">" + moneda(m.tarifadiaria) + "</span></p>" +
    "<p><strong>Disponibilidad:</strong> " + (disponibles > 0 ? "<span class=\"disponible-ok\">" + entero(disponibles) + " de " + entero(m.total_unidades) + " unidades</span>" : "<span class=\"disponible-no\">Sin unidades disponibles</span>") + "</p>" +
    extra +
    (haySesion() ? "" : "<button type=\"button\" class=\"btn botonamarillo mt-2\" data-alquilar=\"" + Number(m.idmaquinaria) + "\"><i class=\"bi bi-clipboard-check\"></i> Alquilar</button>");
  detalleFotos = [];
  detalleIndice = 0;
  const foto = document.getElementById("detalleFoto");
  foto.src = "img/logo.png";
  document.getElementById("detalleContador").textContent = "Cargando fotos...";
  new bootstrap.Modal(document.getElementById("modalDetalle")).show();
  const botonAlquilar = document.getElementById("detalleInfo").querySelector("[data-alquilar]");
  if (botonAlquilar) {
    botonAlquilar.addEventListener("click", function () {
      irASolicitar(Number(botonAlquilar.getAttribute("data-alquilar")));
    });
  }
  fotosExistentes(m.carpeta).then(function (lista) {
    detalleFotos = lista.length > 0 ? lista : ["img/logo.png"];
    detalleIndice = 0;
    mostrarFotoDetalle();
  });
}

function irASolicitar(idmaquinaria) {
  bootstrap.Modal.getInstance(document.getElementById("modalDetalle")).hide();
  const sel = document.getElementById("solMaquinaria");
  if (sel) {
    const existe = Array.prototype.some.call(sel.options, function (op) { return op.value === String(idmaquinaria); });
    if (existe) sel.value = String(idmaquinaria);
  }
  const seccion = document.getElementById("seccion-solicitar");
  if (seccion) seccion.scrollIntoView({ behavior: "smooth" });
}

function mostrarFotoDetalle() {
  if (detalleFotos.length === 0) return;
  const foto = document.getElementById("detalleFoto");
  foto.style.opacity = "0";
  foto.onload = function () { foto.style.opacity = "1"; };
  foto.onerror = function () { foto.onerror = null; foto.src = "img/logo.png"; foto.style.opacity = "1"; };
  foto.src = detalleFotos[detalleIndice];
  foto.alt = "Foto " + (detalleIndice + 1) + " de maquinaria";
  document.getElementById("detalleContador").textContent = "Foto " + (detalleIndice + 1) + " de " + detalleFotos.length;
}

function fotoSiguiente() {
  if (detalleFotos.length === 0) return;
  detalleIndice = (detalleIndice + 1) % detalleFotos.length;
  mostrarFotoDetalle();
}

function fotoAnterior() {
  if (detalleFotos.length === 0) return;
  detalleIndice = (detalleIndice - 1 + detalleFotos.length) % detalleFotos.length;
  mostrarFotoDetalle();
}

function cargarAdminMaquinas() {
  pedir("MAQUINARIAS", "GET", {}).then(function (respuesta) {
    const datos = datosRespuesta(respuesta);
    if (!respuesta || !respuesta.ok || !Array.isArray(datos)) return;
    catalogoDatos = datos;
    const cuerpo = document.getElementById("tablaMaquinas");
    cuerpo.innerHTML = datos.map(function (m) {
      const puede = ROL_MEMORIA === "admin" || ROL_MEMORIA === "operador";
      let acciones = "—";
      if (puede) {
        acciones = "<button type=\"button\" class=\"btn botonoscuro btn-sm\" data-editar=\"" + Number(m.idmaquinaria) + "\">Editar</button> " +
          (ROL_MEMORIA === "admin" ? "<button type=\"button\" class=\"btn botonamarillo btn-sm\" data-borrar=\"" + Number(m.idmaquinaria) + "\">Eliminar</button>" : "");
      }
      return "<tr><td>" + sanitizarTexto(m.nombre) + "</td><td>" + sanitizarTexto(String(m.categoria || "")) + "</td>" +
        "<td class=\"monto\">" + moneda(m.tarifadiaria) + "</td>" +
        "<td>" + entero(m.unidades_disponibles) + " / " + entero(m.total_unidades) + "</td>" +
        "<td>" + insignia(Number(m.activo) === 1 ? "Activa" : "Inactiva") + "</td>" +
        (ROL_MEMORIA === "admin" || ROL_MEMORIA === "operador" ? "<td>" + acciones + "</td>" : "") + "</tr>";
    }).join("");
    cuerpo.querySelectorAll("[data-editar]").forEach(function (b) {
      b.addEventListener("click", function () { editarMaquina(Number(b.getAttribute("data-editar"))); });
    });
    cuerpo.querySelectorAll("[data-borrar]").forEach(function (b) {
      b.addEventListener("click", function () { borrarMaquina(Number(b.getAttribute("data-borrar"))); });
    });
  });
}

function editarMaquina(id) {
  const m = catalogoDatos.find(function (x) { return Number(x.idmaquinaria) === Number(id); });
  if (!m) return;
  document.getElementById("maqId").value = String(m.idmaquinaria);
  document.getElementById("maqNombre").value = String(m.nombre || "");
  document.getElementById("maqCategoria").value = String(m.categoria || "liviana");
  document.getElementById("maqTarifa").value = String(m.tarifadiaria || "");
  document.getElementById("maqTotal").value = "";
  const texto = String(m.peso_toneladas !== undefined && m.peso_toneladas !== null ? m.peso_toneladas : "");
  document.getElementById("maqPeso").value = texto;
  const costo = String(m.costo_movilizacion !== undefined && m.costo_movilizacion !== null ? m.costo_movilizacion : "");
  document.getElementById("maqCostoMov").value = costo;
  const ancho = String(m.ancho_metros !== undefined && m.ancho_metros !== null ? m.ancho_metros : "");
  document.getElementById("maqAncho").value = ancho;
  document.getElementById("maqApta").value = Number(m.apta_zona_urbana) === 1 ? "1" : "0";
  document.getElementById("maqUnidadesAgregar").value = "";
  const activoTxt = Number(m.activo) === 1 ? " · activa" : " · inactiva";
  document.getElementById("tituloFormMaquina").textContent = "Editar maquinaria (modifique tarifa, movilización o agregue unidades)" + activoTxt;
  window.scrollTo(0, 0);
}

function limpiarFormMaquina() {
  ["maqId", "maqNombre", "maqTarifa", "maqTotal", "maqPeso", "maqCostoMov", "maqAncho", "maqUnidadesAgregar"].forEach(function (id) {
    document.getElementById(id).value = "";
  });
  document.getElementById("maqApta").value = "1";
  document.getElementById("tituloFormMaquina").textContent = "Nueva maquinaria";
}

function leerFotoBase64() {
  const archivo = document.getElementById("maqFoto").files[0];
  if (!archivo) return Promise.resolve(null);
  if (archivo.size > 2 * 1024 * 1024) return Promise.resolve("GRANDE");
  return new Promise(function (resolver) {
    const lectorDeArchivos = new FileReader();
    lectorDeArchivos.onload = function () { resolver(String(lectorDeArchivos.result || "").split(",")[1] || null); };
    lectorDeArchivos.onerror = function () { resolver(null); };
    lectorDeArchivos.readAsDataURL(archivo);
  });
}

function guardarMaquina() {
  const id = valorCampo("maqId");
  const nombre = valorCampo("maqNombre");
  const categoria = valorCampo("maqCategoria");
  const tarifa = Number(valorCampo("maqTarifa"));
  if (nombre.length < 3 || !Number.isFinite(tarifa) || tarifa <= 0) {
    mostrarMensaje("mensajeMaquinas", "Nombre (mínimo 3 letras) y tarifa positiva son obligatorios.", "error");
    return Promise.resolve(false);
  }
  return leerFotoBase64().then(function (foto) {
    if (foto === "GRANDE") {
      mostrarMensaje("mensajeMaquinas", "La foto supera 2 MB.", "error");
      return false;
    }
    if (id === "") {
      const total = Number(valorCampo("maqTotal"));
      if (!Number.isInteger(total) || total < 1 || total > 200) {
        mostrarMensaje("mensajeMaquinas", "Indique las unidades a crear (1 a 200).", "error");
        return false;
      }
      const datos = { nombre: nombre, categoria: categoria, tarifadiaria: tarifa, totalunidades: total };
      if (foto) datos.foto_base64 = foto;
      if (categoria === "pesada") {
        const peso = Number(valorCampo("maqPeso"));
        const costo = Number(valorCampo("maqCostoMov") || 0);
        if (!Number.isFinite(peso) || peso <= 0) {
          mostrarMensaje("mensajeMaquinas", "La maquinaria pesada exige peso en toneladas.", "error");
          return false;
        }
        datos.peso_toneladas = peso;
        datos.costo_movilizacion = costo;
      } else {
        const ancho = Number(valorCampo("maqAncho"));
        if (!Number.isFinite(ancho) || ancho <= 0) {
          mostrarMensaje("mensajeMaquinas", "La maquinaria liviana exige ancho en metros.", "error");
          return false;
        }
        datos.ancho_metros = ancho;
        datos.apta_zona_urbana = Number(valorCampo("maqApta")) === 1 ? 1 : 0;
      }
      return pedir("MAQUINARIAS", "POST", datos).then(function (respuesta) {
        mostrarMensaje("mensajeMaquinas", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
        if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
        if (respuesta && respuesta.ok) { limpiarFormMaquina(); cargarAdminMaquinas(); }
        return Boolean(respuesta && respuesta.ok);
      });
    }
    const cambios = { tarifadiaria: tarifa };
    // El PATCH acepta el costo de movilizacion de las pesadas: se envia
    // siempre que el campo tenga valor (asi se puede corregir la cuota).
    if (categoria === "pesada") {
      const costo = valorCampo("maqCostoMov");
      if (costo !== "") {
        const c = Number(costo);
        if (!Number.isFinite(c) || c < 0 || c > 100000000) {
          mostrarMensaje("mensajeMaquinas", "El costo de movilización debe estar entre 0 y 100000000.", "error");
          return false;
        }
        cambios.costo_movilizacion = c;
      }
    }
    const agregar = valorCampo("maqUnidadesAgregar");
    if (agregar !== "") {
      const n = Number(agregar);
      if (!Number.isInteger(n) || n < 0 || n > 200) {
        mostrarMensaje("mensajeMaquinas", "Unidades a agregar: 0 a 200.", "error");
        return false;
      }
      if (n > 0) cambios.unidadesagregar = n;
    }
    if (foto) cambios.foto_base64 = foto;
    return pedir("MAQUINARIAS", "PATCH", Object.assign({ idmaquinaria: Number(id) }, cambios)).then(function (respuesta) {
      mostrarMensaje("mensajeMaquinas", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
      if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
      if (respuesta && respuesta.ok) { limpiarFormMaquina(); cargarAdminMaquinas(); }
      return Boolean(respuesta && respuesta.ok);
    });
  });
}

function borrarMaquina(id) {
  return confirmarAccion("¿Eliminar la maquinaria? Quedará inactiva.").then(function (si) {
    if (!si) return false;
    return pedir("MAQUINARIAS", "DELETE", { idmaquinaria: id }).then(function (respuesta) {
      mostrarMensaje("mensajeMaquinas", (respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
      if (typeof mostrarToast === "function") mostrarToast((respuesta && respuesta.mensaje) || "", respuesta && respuesta.ok ? "ok" : "error");
      if (respuesta && respuesta.ok) cargarAdminMaquinas();
      return Boolean(respuesta && respuesta.ok);
    });
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const bAnt = document.getElementById("botonFotoAnt");
  const bSig = document.getElementById("botonFotoSig");
  if (bAnt) bAnt.addEventListener("click", fotoAnterior);
  if (bSig) bSig.addEventListener("click", fotoSiguiente);
  document.addEventListener("keydown", function (e) {
    const modal = document.getElementById("modalDetalle");
    if (!modal || !modal.classList.contains("show")) return;
    if (e.key === "ArrowLeft") fotoAnterior();
    else if (e.key === "ArrowRight") fotoSiguiente();
  });
  const bGuardar = document.getElementById("botonGuardarMaquina");
  if (bGuardar) bGuardar.addEventListener("click", function () { ejecutarAccion("botonGuardarMaquina", guardarMaquina); });
  const bLimpiar = document.getElementById("botonLimpiarMaquina");
  if (bLimpiar) bLimpiar.addEventListener("click", limpiarFormMaquina);
});
