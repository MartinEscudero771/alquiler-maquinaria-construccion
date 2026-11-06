// Calendario mensual de todos los alquileres (FullCalendar global + es).
// By las fuente de datos es la rama ALQUILERES que ya expone el gateway;
// el nombre del cliente y el serial de la unidad se resuelven con las
// ramas CLIENTES/UNIDADES (sin llamadas arbitrarias nuevas al backend).
let calendarioInstancia = null;

function clasificarAlquiler(a) {
  if (a.fechadevolucionreal) return { clave: "devuelto", etiqueta: "Devuelto" };
  const e = String(a.estado || "").toLowerCase();
  if (e === "moroso") return { clave: "moroso", etiqueta: "Moroso" };
  if (e === "devuelto") return { clave: "devuelto", etiqueta: "Devuelto" };
  return { clave: "activo", etiqueta: "Activo" };
}

function coloresCalendario() {
  const oscuro = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    activo: { backgroundColor: "#FFB800", borderColor: "#9A6700", textColor: "#14161A" },
    moroso: { backgroundColor: "#B42318", borderColor: "#7A170F", textColor: "#FFFFFF" },
    devuelto: { backgroundColor: "#1E7B3A", borderColor: "#135426", textColor: "#FFFFFF" },
    textoTabla: oscuro ? "#E7E9EC" : "#14161A"
  };
}

function sumarUnDia(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
  const d = new Date(f + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function construirEventosCalendario(alquileres, nombreClientes, serialesUnidades) {
  const colores = coloresCalendario();
  return alquileres.map(function (a) {
    const clase = clasificarAlquiler(a);
    const inicio = String(a.fechalquiler || "").slice(0, 10);
    const finProgramada = String(a.fechadevolucionprogramada || "").slice(0, 10);
    const colorInfo = colores[clase.clave] || colores.activo;
    const cliente = nombreClientes[Number(a.idcliente)] || ("Cliente #" + Number(a.idcliente));
    const unidad = serialesUnidades[Number(a.idunidad)] || ("Unidad #" + Number(a.idunidad));
    return {
      id: "alq-" + Number(a.idalquiler),
      title: "Contrato " + Number(a.idalquiler) + " · " + cliente,
      start: inicio,
      end: sumarUnDia(finProgramada),
      backgroundColor: colorInfo.backgroundColor,
      borderColor: colorInfo.borderColor,
      textColor: colorInfo.textColor,
      classNames: ["ev-" + clase.clave],
      extendedProps: {
        contrato: Number(a.idalquiler),
        cliente: cliente,
        unidad: unidad,
        estado: clase.etiqueta,
        inicio: inicio,
        fin: finProgramada,
        devueltoEl: a.fechadevolucionreal ? String(a.fechadevolucionreal).slice(0, 10) : null,
        valor: a.valortotal
      }
    };
  });
}

async function dibujarCalendario() {
  try {
    const resultados = await Promise.all([
      pedir("ALQUILERES", "GET", {}),
      pedir("CLIENTES", "GET", { pagina: 1, limite: 200 }),
      pedirPublico("MAQUINARIAS", "GET", {})
    ]);
    const respAlquileres = resultados[0];
    const respClientes = resultados[1];
    const respMaquinas = resultados[2];
    const alquileres = (datosRespuesta(respAlquileres) || []).slice();
    const envoltura = datosRespuesta(respClientes) || {};
    const clientes = Array.isArray(envoltura.clientes) ? envoltura.clientes : [];
    const maquinas = (datosRespuesta(respMaquinas) || []).slice();

    if (!respAlquileres.ok) {
      const el = document.getElementById("estadoCalendario");
      if (el) el.textContent = "No se pudieron leer los alquileres. Intente abrir el módulo de nuevo.";
      return;
    }

    const nombreClientes = {};
    clientes.forEach(function (c) { nombreClientes[Number(c.idcliente)] = String(c.nombre); });

    // Mapa idunidad -> serial (unidades por maquinaria, publico).
    const seriales = {};
    await Promise.all(maquinas.map(function (m) {
      return pedirPublico("UNIDADES", "POST", { idmaquinaria: Number(m.idmaquinaria) }).then(function (r) {
        const unidades = datosRespuesta(r) || [];
        unidades.forEach(function (u) { seriales[Number(u.idunidad)] = String(u.serial || ""); });
        return null;
      });
    }));

    const eventos = construirEventosCalendario(alquileres, nombreClientes, seriales);

    const contenedor = document.getElementById("calendarioAlquileres");
    if (!contenedor) return;
    if (typeof FullCalendar === "undefined") {
      const el2 = document.getElementById("estadoCalendario");
      if (el2) el2.textContent = "El calendario no se pudo cargar (vendor ausente).";
      return;
    }
    if (!calendarioInstancia) {
      calendarioInstancia = new FullCalendar.Calendar(contenedor, {
        locale: "es",
        firstDay: 1,
        height: "auto",
        fixedWeekCount: false,
        displayEventTime: false,
        dayMaxEventRows: 4,
        headerToolbar: { left: "prev,next today", center: "title", right: "" },
        buttonText: { today: "Hoy" },
        eventClick: function (info) {
          const p = info.event.extendedProps || {};
          const detalle = "Contrato " + p.contrato + " · " + p.estado +
            (p.devueltoEl ? " (devuelto el " + p.devueltoEl + ")" : (p.inicio + " → " + p.fin)) +
            " · " + p.cliente + " · " + p.unidad + (p.valor ? " · " + moneda(p.valor) : "");
          mostrarToast(detalle, p.estado === "Moroso" ? "mal" : p.estado === "Devuelto" ? "ok" : "aviso");
        },
        events: eventos
      });
      calendarioInstancia.render();
    } else {
      calendarioInstancia.setOption("events", eventos);
    }

    const contEl = document.getElementById("contCalendario");
    if (contEl) contEl.textContent = alquileres.length + " contrato(s) en el calendario.";
    const el = document.getElementById("estadoCalendario");
    if (el) el.textContent = "";
  } catch (e) {
    const el3 = document.getElementById("estadoCalendario");
    if (el3) el3.textContent = "Error cargando el calendario. Abra el módulo de nuevo.";
  }
}

function cargarCalendario() {
  if (typeof haySesion !== "function" || !haySesion()) return;
  dibujarCalendario();
}