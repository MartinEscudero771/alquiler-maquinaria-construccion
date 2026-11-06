// Graficas del modulo Inicio con datos vivos de la base de datos.
// Todo se calcula en el navegador a partir de listas que ya expone el
// gateway (alquileres, maquinarias/unidades, clientes): el gateway sigue
// siendo un enrutador puro y las APIs no cambian. Chart.js vive en
// vendor/chart.umd.js (SRI) y la paleta es la del sistema de diseno.
let GRAFICAS = {};

function formatoCompacto(n) {
  try {
    return new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  } catch (e) {
    return String(Math.round(n));
  }
}

function paletaGraficas() {
  const oscuro = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    oscuro: oscuro,
    texto: oscuro ? "#A8AEB8" : "#4B5563",
    rejilla: oscuro ? "rgba(255,255,255,0.10)" : "rgba(20,22,26,0.08)",
    areaLinea: oscuro ? "rgba(255,184,0,0.18)" : "rgba(255,184,0,0.16)",
    amarillo: "#FFB800",
    acero: "#214F9E",
    exito: "#1E7B3A",
    error: "#B42318",
    grisOcupada: oscuro ? "#3A4049" : "#D9DCE1"
  };
}

function aplicarBaseGraficas(p) {
  if (typeof Chart === "undefined") return false;
  Chart.defaults.font.family = "Arial, Helvetica, sans-serif";
  Chart.defaults.color = p.texto;
  // Con movimiento reducido apagamos la animacion (coincide con el CSS).
  Chart.defaults.animation = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 450, easing: "easeOutQuart" };
  return true;
}

function cerrarGrafica(clave) {
  if (GRAFICAS[clave]) {
    GRAFICAS[clave].destroy();
    GRAFICAS[clave] = null;
  }
}

// Deduce el estado legible de un contrato con la misma regla que la tabla
// de alquileres (devuelto > moroso > activo).
function estadoContrato(a) {
  if (a.fechadevolucionreal) return "Devuelto";
  const e = String(a.estado || "").toLowerCase();
  if (e === "moroso") return "Moroso";
  return "Activo";
}

async function cargarDashboard() {
  // El resumen solo tiene sentido con sesion (usa contratos y clientes).
  if (typeof haySesion !== "function" || !haySesion()) return;
  const estadoEl = document.getElementById("estadoGraficas");
  const escribirEstado = function (t) {
    if (estadoEl) estadoEl.textContent = t;
  };
  if (typeof Chart === "undefined") {
    escribirEstado("Las gráficas no se pudieron cargar (vendor/chart.umd.js ausente).");
    return;
  }
  try {
    // 1) Peticiones independientes en paralelo.
    const esperas = [
      pedir("ALQUILERES", "GET", {}),
      pedirPublico("MAQUINARIAS", "GET", {}),
      pedir("CLIENTES", "GET", { pagina: 1, limite: 200 })
    ];
    const resultados = await Promise.all(esperas);
    const respAlquileres = resultados[0];
    const respMaquinas = resultados[1];
    const respClientes = resultados[2];

    const alquileres = (datosRespuesta(respAlquileres) || []).slice();
    const maquinas = (datosRespuesta(respMaquinas) || []).slice();
    const envolturaClientes = datosRespuesta(respClientes) || {};
    const clientes = Array.isArray(envolturaClientes.clientes) ? envolturaClientes.clientes : [];

    if (!respAlquileres.ok || !respMaquinas.ok || !respClientes.ok) {
      escribirEstado("No se pudieron leer los datos de la base. Intente recargar.");
      return;
    }

    // 2) Mapa idunidad -> maquinaria (UNIDADES:POST es de vitrina, publica).
    const mapaUnidades = {};
    await Promise.all(maquinas.map(function (m) {
      return pedirPublico("UNIDADES", "POST", { idmaquinaria: Number(m.idmaquinaria) }).then(function (r) {
        const unidades = datosRespuesta(r) || [];
        unidades.forEach(function (u) {
          mapaUnidades[Number(u.idunidad)] = { nombre: String(m.nombre), categoria: String(m.categoria) };
        });
        return null;
      });
    }));

    const p = paletaGraficas();
    if (!aplicarBaseGraficas(p)) return;

    // 3a) Ingresos facturados por fecha (sumando valortotal por fecha de alquiler).
    const porFecha = {};
    alquileres.forEach(function (a) {
      const f = String(a.fechalquiler || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return;
      porFecha[f] = (porFecha[f] || 0) + Number(a.valortotal || 0);
    });
    const fechas = Object.keys(porFecha).sort();
    let etiquetasIngresos, valoresIngresos;
    if (fechas.length > 31) {
      // Historial largo: compresion mensual para mantener la grafica legible.
      const porMes = {};
      fechas.forEach(function (f) {
        const k = f.slice(0, 7);
        porMes[k] = (porMes[k] || 0) + porFecha[f];
      });
      etiquetasIngresos = Object.keys(porMes).sort().map(function (k) { return k.split("-").reverse().join("/"); });
      valoresIngresos = Object.keys(porMes).sort().map(function (k) { return porMes[k]; });
    } else {
      etiquetasIngresos = fechas.map(function (f) { return f.slice(8) + "/" + f.slice(5, 7); });
      valoresIngresos = fechas.map(function (f) { return porFecha[f]; });
    }

    // 3b) Estado de los contratos.
    const conteoEstado = { "Activo": 0, "Moroso": 0, "Devuelto": 0 };
    alquileres.forEach(function (a) {
      const e = estadoContrato(a);
      if (conteoEstado[e] !== undefined) conteoEstado[e] += 1;
    });

    // 3c) Disponibilidad por familia de maquinaria (datos de la vitrina).
    const familia = {
      pesada: { total: 0, libres: 0 },
      liviana: { total: 0, libres: 0 }
    };
    maquinas.forEach(function (m) {
      const cat = String(m.categoria || "");
      const total = Number(m.total_unidades || 0);
      // El backend expone el campo como unidades_disponibles; se acepta
      // tambien 'disponibles' por robustez de versiones.
      const libresCrudo = (m.unidades_disponibles !== undefined) ? m.unidades_disponibles : m.disponibles;
      const libres = Number(libresCrudo || 0);
      if (familia[cat]) {
        familia[cat].total += total;
        familia[cat].libres += libres;
      }
    });

    // 3d) Maquinas con mas contratos (una unidad resume su maquinaria).
    const contratosPorMaquina = {};
    alquileres.forEach(function (a) {
      const info = mapaUnidades[Number(a.idunidad)];
      if (!info) return;
      contratosPorMaquina[info.nombre] = (contratosPorMaquina[info.nombre] || 0) + 1;
    });
    const ranking = Object.keys(contratosPorMaquina)
      .map(function (nombre) { return { nombre: nombre, contratos: contratosPorMaquina[nombre] }; })
      .sort(function (x, y) { return y.contratos - x.contratos; })
      .slice(0, 10);

    // 4) Pintar. Se destruyen las graficas previas para no reutilizar canvas.
    escribirEstado("");

    cerrarGrafica("ingresos");
    GRAFICAS.ingresos = new Chart(document.getElementById("graficaIngresos"), {
      type: "line",
      data: {
        labels: etiquetasIngresos,
        datasets: [{
          label: "Ingresos",
          data: valoresIngresos,
          borderColor: p.amarillo,
          backgroundColor: p.areaLinea,
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: p.amarillo,
          pointBorderColor: p.oscuro ? "#15171C" : "#FFFFFF",
          tension: 0.25,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return " Facturado: " + moneda(ctx.parsed.y); } } }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: p.rejilla }, ticks: { callback: function (v) { return formatoCompacto(v); } } },
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } }
        }
      }
    });

    cerrarGrafica("estados");
    GRAFICAS.estados = new Chart(document.getElementById("graficaEstados"), {
      type: "doughnut",
      data: {
        labels: ["Activos", "Morosos", "Devueltos"],
        datasets: [{
          data: [conteoEstado["Activo"], conteoEstado["Moroso"], conteoEstado["Devuelto"]],
          backgroundColor: [p.amarillo, p.error, p.exito],
          borderColor: p.oscuro ? "#15171C" : "#FFFFFF",
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "58%",
        plugins: { legend: { position: "bottom" } }
      }
    });

    cerrarGrafica("disponibilidad");
    GRAFICAS.disponibilidad = new Chart(document.getElementById("graficaDisponibilidad"), {
      type: "bar",
      data: {
        labels: ["Pesadas", "Livianas"],
        datasets: [
          { label: "Disponibles", data: [familia.pesada.libres, familia.liviana.libres], backgroundColor: p.exito },
          {
            label: "Ocupadas",
            data: [
              Math.max(familia.pesada.total - familia.pesada.libres, 0),
              Math.max(familia.liviana.total - familia.liviana.libres, 0)
            ],
            backgroundColor: p.grisOcupada
          }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: { x: { stacked: true, beginAtZero: true, grid: { color: p.rejilla }, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false } } }
      }
    });

    cerrarGrafica("maquinas");
    GRAFICAS.maquinas = new Chart(document.getElementById("graficaMaquinas"), {
      type: "bar",
      data: {
        labels: ranking.map(function (r) { return r.nombre; }),
        datasets: [{
          label: "Contratos",
          data: ranking.map(function (r) { return r.contratos; }),
          backgroundColor: p.acero,
          borderRadius: 3
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, grid: { color: p.rejilla }, ticks: { precision: 0 } }, y: { grid: { display: false } } }
      }
    });

    const totalContratos = alquileres.length;
    if (totalContratos === 0) {
      escribirEstado("La base no tiene contratos todavía: las gráficas se llenan al registrar alquileres.");
    }
    // El resumen de clientes por mes quedó fuera para no saturar la vista inicial.
  } catch (e) {
    escribirEstado("Error calculando las gráficas. Intente recargar el módulo.");
  }
}

// Si cambia el esquema de color, re-pintar con la paleta del nuevo tema.
try {
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      if (document.getElementById("graficaIngresos") && GRAFICAS.ingresos) {
        cerrarGrafica("ingresos"); cerrarGrafica("estados");
        cerrarGrafica("disponibilidad"); cerrarGrafica("maquinas");
        cargarDashboard();
      }
    });
  }
} catch (e) {
  // Navegadores sin addEventListener en MediaQueryList: sin listener no pasa nada.
}
