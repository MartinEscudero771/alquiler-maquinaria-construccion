require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const express = require('express');
const cors = require('cors');
const entorno = require('./src/config/environment');
const { cabecerasSeguridad, controlAcceso } = require('./src/middleware/seguridad');
const rutasApi = require('./src/routes/api');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

app.use(cabecerasSeguridad);

// N2 (DNS rebinding): solo se acepta el Host de este servicio. La IP ya
// esta acotada a loopback; esto cierra peticiones con Host forjado.
const PUERTO_GATEWAY = Number(entorno.puerto) || 3000;
const HOSTS_PERMITIDOS = [
  'localhost:' + PUERTO_GATEWAY,
  '127.0.0.1:' + PUERTO_GATEWAY,
  '[::1]:' + PUERTO_GATEWAY,
  'localhost',
  '127.0.0.1',
  '[::1]'
];

function hostPermitido(req, res, next) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!HOSTS_PERMITIDOS.includes(host)) {
    return res.status(421).json({ ok: false, codigo: 421, mensaje: 'Host inválido.', datos: [] });
  }
  next();
}

app.use(hostPermitido);
app.use(cors({ origin: entorno.origenesFrontend }));
app.use(express.json({ limit: '1mb' }));

function responder(res, codigo, mensaje, datos) {
  return res.status(codigo).json({
    ok: codigo < 400,
    codigo,
    mensaje,
    datos: datos === undefined ? [] : datos
  });
}

app.get('/salud', controlAcceso, (req, res) => {
  return responder(res, 200, 'Servicio disponible.', {
    servicio: 'api-gateway',
    hora: new Date().toISOString()
  });
});

app.use(rutasApi);

app.use((req, res) => {
  return responder(res, 404, 'Recurso no encontrado.', []);
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
    return responder(res, 413, 'Solicitud demasiado grande.', []);
  }
  if (err && err.type === 'entity.parse.failed') {
    return responder(res, 400, 'Cuerpo JSON inválido.', []);
  }
  const codigo = err && (err.status || err.statusCode) ? err.status || err.statusCode : 400;
  const final = codigo >= 400 && codigo < 600 ? codigo : 400;
  return responder(res, final, 'Solicitud inválida.', []);
});

const PUERTO = PUERTO_GATEWAY;

// TLS: certificado local generado por iniciar.ps1 (si falta, queda en HTTP y se avisa).
function cargarTls() {
  const raizProyecto = path.resolve(__dirname, '..');
  const rutaPfx = process.env.RUTA_PFX || path.join(raizProyecto, 'certificados', 'local.pfx');
  const archivoClave = process.env.ARCHIVO_CLAVE_PFX || path.join(raizProyecto, 'certificados', '.clave.env');
  try {
    let pass = process.env.CLAVE_PFX || '';
    if (!pass && fs.existsSync(archivoClave)) {
      const linea = fs.readFileSync(archivoClave, 'utf8').split(/\r?\n/).find((l) => /^CLAVE_PFX\s*=/.test(l));
      if (linea) pass = linea.replace(/^CLAVE_PFX\s*=\s*/, '').trim();
    }
    if (!pass || !fs.existsSync(rutaPfx)) return null;
    return { pfx: fs.readFileSync(rutaPfx), passphrase: pass };
  } catch (e) {
    return null;
  }
}

if (require.main === module) {
  const tls = cargarTls();
  const manejar = (req, res) => app(req, res);
  const servidor = tls
    ? https.createServer({ pfx: tls.pfx, passphrase: tls.passphrase, minVersion: 'TLSv1.2' }, manejar)
    : require('http').createServer(manejar);
  servidor.headersTimeout = 15000;
  servidor.requestTimeout = 30000;
  servidor.keepAliveTimeout = 5000;
  servidor.maxHeadersCount = 50;
  servidor.maxConnections = 200;
  servidor.listen(PUERTO, '127.0.0.1', () => {
    console.log((tls ? 'Gateway TLS en https://127.0.0.1:' : 'Gateway (SIN TLS) en http://127.0.0.1:') + PUERTO);
    if (!tls) console.error('[SEGURIDAD] Sin certificado TLS: el gateway quedo en HTTP.');
  });
}

module.exports = app;
