require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const pool = require('./conexion');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// Sin CORS: este servicio lo llama solo el gateway servidor-a-servidor.
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

function respuesta(res, codigo, ok, mensaje, datos) {
  return res.status(codigo).json({ ok, codigo, mensaje, datos });
}

// N2 (DNS rebinding): peticiones con Host forjado se rechazan de entrada.
const HOSTS_PERMITIDOS = ['localhost:3002', '127.0.0.1:3002', '[::1]:3002'];
app.use((req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase();
  if (!HOSTS_PERMITIDOS.includes(host)) {
    return respuesta(res, 421, false, 'Host inválido.', null);
  }
  next();
});

function accesoInterno(req, res, next) {
  const ipsPermitidas = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (!ipsPermitidas.includes(req.ip)) {
    return respuesta(res, 403, false, 'Acceso denegado.', null);
  }
  const recibida = Buffer.from(req.header('x-clave-interna') || '', 'utf8');
  const esperada = Buffer.from(process.env.CLAVE_INTERNA_NODE || '', 'utf8');
  if (recibida.length === 0 || recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) {
    return respuesta(res, 403, false, 'Acceso denegado.', null);
  }
  next();
}

// Notificaciones operativas (tabla notificaciones, dueña exclusiva de esta API).
// Nunca rompe la respuesta principal: un fallo de notificacion no debe fallar el negocio.
async function registrarNotificacion(titulo, mensaje, rama, nivel) {
  try {
    const t = String(titulo || '').slice(0, 150);
    const m = String(mensaje || '').slice(0, 400);
    const r = String(rama || '').slice(0, 30);
    const n = ['info', 'exito', 'aviso', 'error'].includes(nivel) ? nivel : 'info';
    if (t.length < 1) return;
    await pool.query(
      'INSERT INTO notificaciones (titulo, mensaje, rama, nivel) VALUES (?, ?, ?, ?)',
      [t, m, r, n]);
    // GC liviano: conservar 60 dias; cap de filas atigado por inserciones reales.
    await pool.query('DELETE FROM notificaciones WHERE fecha < (NOW() - INTERVAL 60 DAY)');
  } catch (e) {
    // silencioso: la bitacora de negocio no depende de la campana
  }
}

function monedaAviso(n) {
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);
  } catch (e) {
    return '$' + Math.round(Number(n) || 0);
  }
}

function hoyBogota() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function esFechaReal(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const partes = s.split('-').map(Number);
  const d = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2]));
  return d.getUTCFullYear() === partes[0] && d.getUTCMonth() === partes[1] - 1 && d.getUTCDate() === partes[2];
}

function aMs(s) {
  const p = s.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}

function diferenciaDias(desde, hasta) {
  return Math.round((aMs(hasta) - aMs(desde)) / 86400000);
}

function sumarAnios(s, n) {
  const p = s.split('-').map(Number);
  let d = new Date(Date.UTC(p[0] + n, p[1] - 1, p[2]));
  if (d.getUTCMonth() !== p[1] - 1) d = new Date(Date.UTC(p[0] + n, p[1], 0));
  return d.toISOString().slice(0, 10);
}

function redondear2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function calcularAlquiler(fila, hoy) {
  const corte = fila.fechadevolucionreal || hoy;
  const diasServicio = diferenciaDias(fila.fechalquiler, fila.fechadevolucionprogramada) + 1;
  const diasretraso = Math.max(0, diferenciaDias(fila.fechadevolucionprogramada, corte));
  const diasalquiler = diasServicio + diasretraso;
  const tarifa = Number(fila.tarifa_pactada);
  const movilizacion = Number(fila.costo_movilizacion_pactado);
  const reparacion = Number(fila.valorreparacion || 0);
  const valordias = redondear2(diasServicio * tarifa);
  const valorretraso = redondear2(diasretraso * tarifa);
  const valormovilizacion = redondear2(movilizacion);
  const valorreparacion = redondear2(reparacion);
  const valortotal = redondear2(valordias + valorretraso + valormovilizacion + valorreparacion);
  let estado = 'activo';
  if (fila.fechadevolucionreal) estado = 'devuelto';
  else if (hoy > fila.fechadevolucionprogramada) estado = 'moroso';
  return { diasalquiler, diasretraso, valordias, valorretraso, valormovilizacion, valorreparacion, valortotal, estado };
}

function mapearAlquiler(fila, hoy) {
  const c = calcularAlquiler(fila, hoy);
  return {
    idalquiler: fila.idalquiler,
    idcliente: fila.idcliente,
    idunidad: fila.idunidad,
    fechalquiler: fila.fechalquiler,
    fechadevolucionprogramada: fila.fechadevolucionprogramada,
    fechadevolucionreal: fila.fechadevolucionreal,
    tarifa_pactada: Number(fila.tarifa_pactada),
    costo_movilizacion_pactado: Number(fila.costo_movilizacion_pactado),
    valorreparacion: c.valorreparacion,
    observaciones: fila.observaciones,
    clave_idempotencia: fila.clave_idempotencia,
    diasalquiler: c.diasalquiler,
    diasretraso: c.diasretraso,
    valordias: c.valordias,
    valorretraso: c.valorretraso,
    valormovilizacion: c.valormovilizacion,
    valortotal: c.valortotal,
    estado: c.estado,
    inspeccion: fila.idinspeccion ? {
      idinspeccion: fila.idinspeccion,
      estadofisico: fila.estadofisico,
      niveldesgaste: fila.niveldesgaste,
      descripciondanos: fila.descripciondanos,
      observaciones: fila.inspeccion_observaciones
    } : null
  };
}

function texto250(v) {
  if (v === undefined || v === null || v === '') return { valor: null };
  if (typeof v !== 'string' || v.length > 250) return { error: true };
  const t = v.trim();
  return { valor: t === '' ? null : t };
}

function estadoFinal(fisico, desgaste, danos, reparacion) {
  const tieneDanos = typeof danos === 'string' && danos.trim().length > 0;
  if (fisico === 'malo' || desgaste === 'alto' || tieneDanos || Number(reparacion) > 0) return 'en_reparacion';
  if (fisico === 'regular' || desgaste === 'medio') return 'en_inspeccion';
  return 'devuelto';
}

const SELECT_BASE = 'SELECT a.idalquiler, a.idcliente, a.idunidad, a.fechalquiler, a.fechadevolucionprogramada, ' +
  'a.fechadevolucionreal, a.tarifa_pactada, a.costo_movilizacion_pactado, a.valorreparacion, a.observaciones, ' +
  'a.clave_idempotencia, i.idinspeccion, i.estadofisico, i.niveldesgaste, i.descripciondanos, ' +
  'i.observaciones AS inspeccion_observaciones FROM alquileres a LEFT JOIN inspecciones i ON i.idalquiler = a.idalquiler';

app.get('/salud', (req, res) => respuesta(res, 200, true, 'Servicio en línea.', null));

app.use('/alquileres', accesoInterno);

app.get('/alquileres', async (req, res) => {
  try {
    const hoy = hoyBogota();
    const [filas] = await pool.query(SELECT_BASE + ' ORDER BY a.idalquiler DESC');
    return respuesta(res, 200, true, 'Alquileres obtenidos.', filas.map((f) => mapearAlquiler(f, hoy)));
  } catch (e) {
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  }
});

app.get('/alquileres/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuesta(res, 400, false, 'Identificador inválido.', null);
  }
  try {
    const hoy = hoyBogota();
    const [filas] = await pool.query(SELECT_BASE + ' WHERE a.idalquiler = ?', [id]);
    if (filas.length === 0) return respuesta(res, 404, false, 'Alquiler no encontrado.', null);
    return respuesta(res, 200, true, 'Alquiler obtenido.', mapearAlquiler(filas[0], hoy));
  } catch (e) {
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  }
});

app.post('/alquileres', async (req, res) => {
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  const idcliente = Number(cuerpo.idcliente);
  const idunidad = Number(cuerpo.idunidad);
  if (!Number.isInteger(idcliente) || idcliente <= 0) {
    return respuesta(res, 400, false, 'El idcliente debe ser un entero mayor que cero.', null);
  }
  if (!Number.isInteger(idunidad) || idunidad <= 0) {
    return respuesta(res, 400, false, 'El idunidad debe ser un entero mayor que cero.', null);
  }
  if (!esFechaReal(cuerpo.fechalquiler) || !esFechaReal(cuerpo.fechadevolucionprogramada)) {
    return respuesta(res, 400, false, 'Las fechas deben tener formato YYYY-MM-DD válido.', null);
  }
  const hoy = hoyBogota();
  const maximo = sumarAnios(hoy, 5);
  const minimo = '2000-01-01';
  if (cuerpo.fechalquiler < minimo || cuerpo.fechalquiler > maximo ||
      cuerpo.fechadevolucionprogramada < minimo || cuerpo.fechadevolucionprogramada > maximo) {
    return respuesta(res, 400, false, 'Las fechas deben estar entre 2000-01-01 y hoy más cinco años.', null);
  }
  if (cuerpo.fechadevolucionprogramada < cuerpo.fechalquiler) {
    return respuesta(res, 400, false, 'La devolución programada no puede ser anterior al alquiler.', null);
  }
  if (diferenciaDias(cuerpo.fechalquiler, cuerpo.fechadevolucionprogramada) > 3650) {
    return respuesta(res, 400, false, 'La duración del alquiler no puede superar 3650 días.', null);
  }
  const tarifa = Number(cuerpo.tarifa_pactada);
  if (!Number.isFinite(tarifa) || tarifa < 1 || tarifa > 100000000) {
    return respuesta(res, 400, false, 'La tarifa pactada debe estar entre 1 y 100000000.', null);
  }
  const movilizacion = cuerpo.costo_movilizacion_pactado === undefined || cuerpo.costo_movilizacion_pactado === null || cuerpo.costo_movilizacion_pactado === ''
    ? 0 : Number(cuerpo.costo_movilizacion_pactado);
  if (!Number.isFinite(movilizacion) || movilizacion < 0 || movilizacion > 100000000) {
    return respuesta(res, 400, false, 'El costo de movilización debe estar entre 0 y 100000000.', null);
  }
  const obs = texto250(cuerpo.observaciones);
  if (obs.error) return respuesta(res, 400, false, 'Las observaciones no pueden superar 250 caracteres.', null);
  if (typeof cuerpo.clave_idempotencia !== 'string' || cuerpo.clave_idempotencia.length < 8 || cuerpo.clave_idempotencia.length > 64) {
    return respuesta(res, 400, false, 'La clave de idempotencia debe tener entre 8 y 64 caracteres.', null);
  }

  const diasalquiler = diferenciaDias(cuerpo.fechalquiler, cuerpo.fechadevolucionprogramada) + 1;
  const valordias = redondear2(diasalquiler * tarifa);
  const valormovilizacion = redondear2(movilizacion);

  let cn;
  try {
    cn = await pool.getConnection();
    await cn.beginTransaction();
    const [previos] = await cn.query('SELECT idalquiler FROM alquileres WHERE clave_idempotencia = ?', [cuerpo.clave_idempotencia]);
    if (previos.length > 0) {
      const [filas] = await cn.query('SELECT * FROM alquileres WHERE idalquiler = ?', [previos[0].idalquiler]);
      await cn.commit();
      const f = filas[0];
      const d = diferenciaDias(f.fechalquiler, f.fechadevolucionprogramada) + 1;
      const v = redondear2(d * Number(f.tarifa_pactada));
      const m = redondear2(Number(f.costo_movilizacion_pactado));
      return respuesta(res, 200, true, 'Alquiler ya registrado.', {
        idalquiler: f.idalquiler, diasalquiler: d, valordias: v, valormovilizacion: m, valortotal: redondear2(v + m)
      });
    }
    const [activos] = await cn.query(
      'SELECT idalquiler FROM alquileres WHERE idunidad = ? AND fechadevolucionreal IS NULL FOR UPDATE', [idunidad]);
    if (activos.length > 0) {
      await cn.rollback();
      return respuesta(res, 409, false, 'La unidad ya tiene un alquiler activo.', null);
    }
    const [r] = await cn.query(
      'INSERT INTO alquileres (idcliente, idunidad, fechalquiler, fechadevolucionprogramada, tarifa_pactada, costo_movilizacion_pactado, observaciones, clave_idempotencia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [idcliente, idunidad, cuerpo.fechalquiler, cuerpo.fechadevolucionprogramada, tarifa, movilizacion, obs.valor, cuerpo.clave_idempotencia]);
    await cn.commit();
    const total = redondear2(valordias + valormovilizacion);
    registrarNotificacion(
      'Contrato ' + r.insertId + ' creado',
      'Alquiler hasta el ' + cuerpo.fechadevolucionprogramada + ' por ' + monedaAviso(total) + '.',
      'ALQUILERES', 'exito');
    return respuesta(res, 201, true, 'Alquiler registrado.', {
      idalquiler: r.insertId, diasalquiler, valordias, valormovilizacion, valortotal: total
    });
  } catch (e) {
    if (cn) {
      try { await cn.rollback(); } catch (r2) { r2 = null; }
      if (e && e.code === 'ER_DUP_ENTRY') {
        try {
          const [filas] = await pool.query('SELECT * FROM alquileres WHERE clave_idempotencia = ?', [cuerpo.clave_idempotencia]);
          if (filas.length > 0) {
            const f = filas[0];
            const d = diferenciaDias(f.fechalquiler, f.fechadevolucionprogramada) + 1;
            const v = redondear2(d * Number(f.tarifa_pactada));
            const m = redondear2(Number(f.costo_movilizacion_pactado));
            return respuesta(res, 200, true, 'Alquiler ya registrado.', {
              idalquiler: f.idalquiler, diasalquiler: d, valordias: v, valormovilizacion: m, valortotal: redondear2(v + m)
            });
          }
        } catch (e2) { e2 = null; }
      }
    }
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  } finally {
    if (cn) cn.release();
  }
});

app.put('/alquileres/:id/devolucion', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuesta(res, 400, false, 'Identificador inválido.', null);
  }
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  if (!esFechaReal(cuerpo.fechadevolucionreal)) {
    return respuesta(res, 400, false, 'La fecha de devolución debe tener formato YYYY-MM-DD válido.', null);
  }
  const fisicos = ['bueno', 'regular', 'malo'];
  const desgastes = ['ninguno', 'bajo', 'medio', 'alto'];
  if (!fisicos.includes(cuerpo.estadofisico)) {
    return respuesta(res, 400, false, 'El estado físico debe ser bueno, regular o malo.', null);
  }
  if (!desgastes.includes(cuerpo.niveldesgaste)) {
    return respuesta(res, 400, false, 'El nivel de desgaste debe ser ninguno, bajo, medio o alto.', null);
  }
  const danos = texto250(cuerpo.descripciondanos);
  if (danos.error) return respuesta(res, 400, false, 'La descripción de daños no puede superar 250 caracteres.', null);
  const reparacion = cuerpo.valorreparacion === undefined || cuerpo.valorreparacion === null || cuerpo.valorreparacion === ''
    ? 0 : Number(cuerpo.valorreparacion);
  if (!Number.isFinite(reparacion) || reparacion < 0 || reparacion > 1000000) {
    return respuesta(res, 400, false, 'El valor de reparación debe estar entre 0 y 1000000.', null);
  }
  const obs = texto250(cuerpo.observaciones);
  if (obs.error) return respuesta(res, 400, false, 'Las observaciones no pueden superar 250 caracteres.', null);

  let cn;
  try {
    const hoy = hoyBogota();
    if (cuerpo.fechadevolucionreal > hoy) {
      return respuesta(res, 400, false, 'La fecha de devolución no puede ser futura.', null);
    }
    cn = await pool.getConnection();
    await cn.beginTransaction();
    const [filas] = await cn.query('SELECT * FROM alquileres WHERE idalquiler = ? FOR UPDATE', [id]);
    if (filas.length === 0) {
      await cn.rollback();
      return respuesta(res, 404, false, 'Alquiler no encontrado.', null);
    }
    const alquiler = filas[0];
    if (alquiler.fechadevolucionreal) {
      await cn.rollback();
      return respuesta(res, 409, false, 'Devolución ya registrada.', null);
    }
    if (cuerpo.fechadevolucionreal < alquiler.fechalquiler) {
      await cn.rollback();
      return respuesta(res, 400, false, 'La devolución no puede ser anterior al alquiler.', null);
    }
    try {
      await cn.query(
        'INSERT INTO inspecciones (idalquiler, estadofisico, niveldesgaste, descripciondanos, observaciones) VALUES (?, ?, ?, ?, ?)',
        [id, cuerpo.estadofisico, cuerpo.niveldesgaste, danos.valor, obs.valor]);
    } catch (e) {
      await cn.rollback();
      if (e && e.code === 'ER_DUP_ENTRY') {
        return respuesta(res, 409, false, 'Devolución ya registrada.', null);
      }
      return respuesta(res, 500, false, 'Error interno del servidor.', null);
    }
    await cn.query('UPDATE alquileres SET fechadevolucionreal = ?, valorreparacion = ? WHERE idalquiler = ?',
      [cuerpo.fechadevolucionreal, reparacion, id]);
    await cn.commit();
    const fila = {
      fechalquiler: alquiler.fechalquiler,
      fechadevolucionprogramada: alquiler.fechadevolucionprogramada,
      fechadevolucionreal: cuerpo.fechadevolucionreal,
      tarifa_pactada: alquiler.tarifa_pactada,
      costo_movilizacion_pactado: alquiler.costo_movilizacion_pactado,
      valorreparacion: reparacion
    };
    const c = calcularAlquiler(fila, hoy);
    const totalDev = c.valortotal;
    registrarNotificacion(
      'Devolución del contrato ' + id + ' registrada',
      'Estado final: ' + estadoFinal(cuerpo.estadofisico, cuerpo.niveldesgaste, danos.valor, reparacion) +
        (Number(c.diasretraso) > 0 ? ' · retraso de ' + c.diasretraso + ' día(s) por ' + monedaAviso(c.valorretraso) : '') +
        ' · total ' + monedaAviso(totalDev) + '.',
      'DEVOLUCION', Number(c.diasretraso) > 0 ? 'aviso' : 'exito');
    return respuesta(res, 200, true, 'Devolución registrada.', {
      idunidad: alquiler.idunidad,
      diasalquiler: c.diasalquiler,
      valordias: c.valordias,
      diasretraso: c.diasretraso,
      valorretraso: c.valorretraso,
      valorreparacion: c.valorreparacion,
      valortotal: c.valortotal,
      estadofinal: estadoFinal(cuerpo.estadofisico, cuerpo.niveldesgaste, danos.valor, reparacion)
    });
  } catch (e) {
    if (cn) { try { await cn.rollback(); } catch (r2) { r2 = null; } }
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  } finally {
    if (cn) cn.release();
  }
});

app.use('/solicitudes', accesoInterno);

function validarDocumento(doc) {
  return typeof doc === 'string' && /^[A-Za-z0-9.\-]{4,20}$/.test(doc.trim());
}

function validarTelefono(tel) {
  return typeof tel === 'string' && /^[0-9+() \-.]{7,20}$/.test(tel.trim());
}

function validarCorreo(correo) {
  if (typeof correo !== 'string') return false;
  const c = correo.trim();
  return c.length > 0 && c.length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c);
}

function validarFechasSolicitud(fechalquiler, fechadevolucionprogramada) {
  if (!esFechaReal(fechalquiler) || !esFechaReal(fechadevolucionprogramada)) {
    return 'Las fechas deben tener formato YYYY-MM-DD válido.';
  }
  const hoy = hoyBogota();
  const maximo = sumarAnios(hoy, 5);
  const minimo = '2000-01-01';
  if (fechalquiler < minimo || fechalquiler > maximo ||
      fechadevolucionprogramada < minimo || fechadevolucionprogramada > maximo) {
    return 'Las fechas deben estar entre 2000-01-01 y hoy más cinco años.';
  }
  if (fechadevolucionprogramada < fechalquiler) {
    return 'La devolución programada no puede ser anterior al alquiler.';
  }
  if (diferenciaDias(fechalquiler, fechadevolucionprogramada) > 3650) {
    return 'La duración no puede superar 3650 días.';
  }
  return null;
}

function mapearSolicitud(f) {
  return {
    idsolicitud: f.idsolicitud,
    nombre: f.nombre,
    documento: f.documento,
    telefono: f.telefono,
    correo: f.correo,
    idmaquinaria: f.idmaquinaria,
    fechalquiler: f.fechalquiler,
    fechadevolucionprogramada: f.fechadevolucionprogramada,
    observaciones: f.observaciones,
    estado: f.estado,
    motivo_rechazo: f.motivo_rechazo,
    idalquiler: f.idalquiler,
    fecha_creacion: f.fecha_creacion
  };
}

app.post('/solicitudes', async (req, res) => {
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : '';
  if (nombre.length < 3 || nombre.length > 100) {
    return respuesta(res, 400, false, 'El nombre debe tener entre 3 y 100 caracteres.', null);
  }
  if (!validarDocumento(cuerpo.documento)) {
    return respuesta(res, 400, false, 'El documento debe tener entre 4 y 20 caracteres alfanuméricos.', null);
  }
  const telefono = cuerpo.telefono === undefined || cuerpo.telefono === null || cuerpo.telefono === '' ? null : String(cuerpo.telefono).trim();
  const correo = cuerpo.correo === undefined || cuerpo.correo === null || cuerpo.correo === '' ? null : String(cuerpo.correo).trim();
  if (telefono === null && correo === null) {
    return respuesta(res, 400, false, 'Indique teléfono o correo.', null);
  }
  if (telefono !== null && !validarTelefono(telefono)) {
    return respuesta(res, 400, false, 'El teléfono no es válido.', null);
  }
  if (correo !== null && !validarCorreo(correo)) {
    return respuesta(res, 400, false, 'El correo no es válido.', null);
  }
  const idmaquinaria = Number(cuerpo.idmaquinaria);
  if (!Number.isInteger(idmaquinaria) || idmaquinaria <= 0) {
    return respuesta(res, 400, false, 'Seleccione una maquinaria válida.', null);
  }
  const errorFechas = validarFechasSolicitud(cuerpo.fechalquiler, cuerpo.fechadevolucionprogramada);
  if (errorFechas) return respuesta(res, 400, false, errorFechas, null);
  const obs = texto250(cuerpo.observaciones);
  if (obs.error) return respuesta(res, 400, false, 'Las observaciones no pueden superar 250 caracteres.', null);

  let cn;
  try {
    cn = await pool.getConnection();
    const [r] = await cn.query(
      'INSERT INTO solicitudes (nombre, documento, telefono, correo, idmaquinaria, fechalquiler, fechadevolucionprogramada, observaciones, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'pendiente\')',
      [nombre, cuerpo.documento.trim(), telefono, correo, idmaquinaria, cuerpo.fechalquiler, cuerpo.fechadevolucionprogramada, obs.valor]);
    await cn.commit().catch(() => null);
    registrarNotificacion(
      'Nueva solicitud de ' + nombre,
      'Maquinaria ' + idmaquinaria + ' del ' + cuerpo.fechalquiler + ' al ' + cuerpo.fechadevolucionprogramada + '. Pendiente de gestionar.',
      'SOLICITUDES', 'aviso');
    return respuesta(res, 201, true, 'Solicitud registrada. Le contactaremos pronto.', { idsolicitud: r.insertId });
  } catch (e) {
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  } finally {
    if (cn) cn.release();
  }
});

app.get('/solicitudes', async (req, res) => {
  const estados = ['pendiente', 'aprobada', 'rechazada'];
  const filtro = typeof req.query.estado === 'string' ? req.query.estado : '';
  let cn;
  try {
    cn = await pool.getConnection();
    let filas;
    if (filtro !== '' && estados.includes(filtro)) {
      [filas] = await cn.query('SELECT * FROM solicitudes WHERE estado = ? ORDER BY fecha_creacion DESC', [filtro]);
    } else {
      [filas] = await cn.query('SELECT * FROM solicitudes ORDER BY fecha_creacion DESC');
    }
    return respuesta(res, 200, true, 'Solicitudes.', filas.map(mapearSolicitud));
  } catch (e) {
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  } finally {
    if (cn) cn.release();
  }
});

app.get('/solicitudes/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuesta(res, 400, false, 'Identificador inválido.', null);
  }
  let cn;
  try {
    cn = await pool.getConnection();
    const [filas] = await cn.query('SELECT * FROM solicitudes WHERE idsolicitud = ?', [id]);
    if (filas.length === 0) {
      return respuesta(res, 404, false, 'Solicitud no encontrada.', null);
    }
    return respuesta(res, 200, true, 'Solicitud.', mapearSolicitud(filas[0]));
  } catch (e) {
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  } finally {
    if (cn) cn.release();
  }
});

app.put('/solicitudes/:id/aprobar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuesta(res, 400, false, 'Identificador inválido.', null);
  }
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  const idcliente = Number(cuerpo.idcliente);
  const idunidad = Number(cuerpo.idunidad);
  if (!Number.isInteger(idcliente) || idcliente <= 0) {
    return respuesta(res, 400, false, 'Seleccione el cliente para el contrato.', null);
  }
  if (!Number.isInteger(idunidad) || idunidad <= 0) {
    return respuesta(res, 400, false, 'Seleccione la unidad disponible para el contrato.', null);
  }
  const tarifa = Number(cuerpo.tarifa_pactada);
  if (!Number.isFinite(tarifa) || tarifa < 1 || tarifa > 100000000) {
    return respuesta(res, 400, false, 'La tarifa pactada debe estar entre 1 y 100000000.', null);
  }
  const movilizacion = cuerpo.costo_movilizacion_pactado === undefined || cuerpo.costo_movilizacion_pactado === null || cuerpo.costo_movilizacion_pactado === ''
    ? 0 : Number(cuerpo.costo_movilizacion_pactado);
  if (!Number.isFinite(movilizacion) || movilizacion < 0 || movilizacion > 100000000) {
    return respuesta(res, 400, false, 'El costo de movilización debe estar entre 0 y 100000000.', null);
  }
  const obs = texto250(cuerpo.observaciones);
  if (obs.error) return respuesta(res, 400, false, 'Las observaciones no pueden superar 250 caracteres.', null);
  const clave = 'sol-' + id;

  let cn;
  try {
    cn = await pool.getConnection();
    await cn.beginTransaction();
    const [filas] = await cn.query('SELECT * FROM solicitudes WHERE idsolicitud = ? FOR UPDATE', [id]);
    if (filas.length === 0) {
      await cn.rollback();
      return respuesta(res, 404, false, 'Solicitud no encontrada.', null);
    }
    const sol = filas[0];
    if (sol.estado !== 'pendiente') {
      await cn.rollback();
      return respuesta(res, 409, false, 'La solicitud ya fue gestionada.', null);
    }
    const [activos] = await cn.query(
      'SELECT idalquiler FROM alquileres WHERE idunidad = ? AND fechadevolucionreal IS NULL FOR UPDATE', [idunidad]);
    if (activos.length > 0) {
      await cn.rollback();
      return respuesta(res, 409, false, 'La unidad ya tiene un alquiler activo.', null);
    }
    const dias = diferenciaDias(sol.fechalquiler, sol.fechadevolucionprogramada) + 1;
    const valordias = redondear2(dias * tarifa);
    const valormov = redondear2(movilizacion);
    const [r] = await cn.query(
      'INSERT INTO alquileres (idcliente, idunidad, fechalquiler, fechadevolucionprogramada, tarifa_pactada, costo_movilizacion_pactado, observaciones, clave_idempotencia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [idcliente, idunidad, sol.fechalquiler, sol.fechadevolucionprogramada, tarifa, movilizacion, obs.valor, clave]);
    await cn.query('UPDATE solicitudes SET estado = \'aprobada\', idalquiler = ?, motivo_rechazo = NULL WHERE idsolicitud = ?', [r.insertId, id]);
    await cn.commit();
    registrarNotificacion(
      'Solicitud ' + id + ' aprobada',
      'Se creó el contrato ' + r.insertId + ' por ' + monedaAviso(redondear2(valordias + valormov)) + '.',
      'SOLICITUDES', 'exito');
    return respuesta(res, 201, true, 'Solicitud aprobada y alquiler creado.', {
      idsolicitud: id, idalquiler: r.insertId, diasalquiler: dias, valordias, valormovilizacion: valormov, valortotal: redondear2(valordias + valormov)
    });
  } catch (e) {
    if (cn) {
      try { await cn.rollback(); } catch (r2) { r2 = null; }
      if (e && e.code === 'ER_DUP_ENTRY') {
        return respuesta(res, 409, false, 'La solicitud ya fue gestionada.', null);
      }
    }
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  } finally {
    if (cn) cn.release();
  }
});

app.put('/solicitudes/:id/rechazar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuesta(res, 400, false, 'Identificador inválido.', null);
  }
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  const motivo = texto250(cuerpo.motivo);
  if (motivo.error || motivo.valor === null || motivo.valor.length < 3) {
    return respuesta(res, 400, false, 'Indique el motivo del rechazo (mínimo 3 caracteres).', null);
  }
  let cn;
  try {
    cn = await pool.getConnection();
    await cn.beginTransaction();
    const [filas] = await cn.query('SELECT idsolicitud, estado FROM solicitudes WHERE idsolicitud = ? FOR UPDATE', [id]);
    if (filas.length === 0) {
      await cn.rollback();
      return respuesta(res, 404, false, 'Solicitud no encontrada.', null);
    }
    if (filas[0].estado !== 'pendiente') {
      await cn.rollback();
      return respuesta(res, 409, false, 'La solicitud ya fue gestionada.', null);
    }
    await cn.query('UPDATE solicitudes SET estado = \'rechazada\', motivo_rechazo = ? WHERE idsolicitud = ?', [motivo.valor, id]);
    await cn.commit();
    registrarNotificacion(
      'Solicitud ' + id + ' rechazada',
      'Motivo: ' + String(motivo.valor).slice(0, 200) + '.',
      'SOLICITUDES', 'info');
    return respuesta(res, 200, true, 'Solicitud rechazada.', { idsolicitud: id });
  } catch (e) {
    if (cn) { try { await cn.rollback(); } catch (r2) { r2 = null; } }
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  } finally {
    if (cn) cn.release();
  }
});

app.use('/notificaciones', accesoInterno);

app.get('/notificaciones/lista', async (req, res) => {
  let cn;
  try {
    cn = await pool.getConnection();
    const [filas] = await cn.query(
      'SELECT idnotificacion, titulo, mensaje, rama, nivel, leida, fecha FROM notificaciones ORDER BY fecha DESC, idnotificacion DESC LIMIT 100');
    let sinLeer = 0;
    filas.forEach((f) => { if (Number(f.leida) !== 1) sinLeer += 1; });
    const lista = filas.map((f) => ({
      idnotificacion: Number(f.idnotificacion),
      titulo: String(f.titulo),
      mensaje: String(f.mensaje || ''),
      rama: String(f.rama || ''),
      nivel: String(f.nivel || 'info'),
      leida: Number(f.leida) === 1,
      fecha: String(f.fecha || '').slice(0, 19)
    }));
    return respuesta(res, 200, true, 'Notificaciones obtenidas.', { no_leidas: sinLeer, notificaciones: lista });
  } catch (e) {
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  } finally {
    if (cn) cn.release();
  }
});

app.put('/notificaciones/:id/leida', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuesta(res, 400, false, 'Identificador inválido.', null);
  }
  let cn;
  try {
    cn = await pool.getConnection();
    const [r] = await cn.query('UPDATE notificaciones SET leida = 1 WHERE idnotificacion = ?', [id]);
    if (r.affectedRows === 0) {
      return respuesta(res, 404, false, 'Notificación no encontrada.', null);
    }
    return respuesta(res, 200, true, 'Notificación marcada como leída.', { idnotificacion: id });
  } catch (e) {
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  } finally {
    if (cn) cn.release();
  }
});

app.put('/notificaciones/leer-todas', async (req, res) => {
  let cn;
  try {
    cn = await pool.getConnection();
    const [r] = await cn.query('UPDATE notificaciones SET leida = 1 WHERE leida = 0');
    return respuesta(res, 200, true, 'Notificaciones marcadas como leídas.', { actualizadas: r.affectedRows });
  } catch (e) {
    return respuesta(res, 500, false, 'Error interno del servidor.', null);
  } finally {
    if (cn) cn.release();
  }
});

app.use((req, res) => respuesta(res, 404, false, 'Recurso no encontrado.', null));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const codigo = err && (err.status || err.statusCode) ? err.status || err.statusCode : 400;
  const final = codigo >= 400 && codigo < 600 ? codigo : 400;
  return respuesta(res, final, false, final === 413 ? 'Solicitud demasiado grande.' : 'Solicitud inválida.', null);
});

const PUERTO = Number(process.env.PUERTO || 3002);
app.listen(PUERTO, '127.0.0.1');

module.exports = app;
