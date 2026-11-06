// Servidor estatico propio (reemplaza python -m http.server).
// Sin dependencias. Solo GET/HEAD, sin listado de directorios, sin
// path traversal (incluye trucos de Windows), lista blanca de
// extensiones, archivos en memoria con verificacion de integridad
// SHA-256 y cabeceras de seguridad. Escucha solo en 127.0.0.1.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const RAIZ = path.resolve(__dirname, '..', 'frontend');
const PUERTO = Number(process.env.PUERTO_ESTATICO || 8443);
const HOST = '127.0.0.1';

// TLS: certificado local (se genera en iniciar.ps1 si falta).
function cargarTls() {
  const rutaPfx = process.env.RUTA_PFX || path.join(__dirname, '..', 'certificados', 'local.pfx');
  const archivoClave = process.env.ARCHIVO_CLAVE_PFX || path.join(__dirname, '..', 'certificados', '.clave.env');
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

const EXTENSIONES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

// Compresion gzip en memoria (solo textos grandes) y politica de cache:
// el HTML nunca se cachea (no-store); los demas recursos se guardan pero
// SIEMPRE revalidan con ETag (no-cache): en localhost es al instante y
// evita servir JS/CSS obsoletos al reiniciar tras un cambio de codigo.
const COMPRESIBLES = new Set(['.html', '.css', '.js', '.json', '.txt', '.svg']);
const MIN_GZIP = 1024;

function controlCacheDe(relativa) {
  if (relativa.toLowerCase().endsWith('.html')) {
    return 'no-store';
  }
  return 'no-cache';
}

// Nombres reservados de Windows y trucos de flujo alternos.
const RESERVADOS = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

const CABECERAS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=604800; includeSubDomains',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "font-src 'self' data:; connect-src 'self' https://localhost:3000 https://127.0.0.1:3000; " +
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; " +
    'upgrade-insecure-requests',
  'X-Powered-By': null // elimina cualquier cabecera de version
};

// ---------- Memoria de archivos + integridad ----------
/** Mapa rutaRelativa -> {contenido: Buffer, sha256: string, mtimeMs: number, gz: Buffer|null} */
const archivos = new Map();
const rutaIntegridad = path.join(__dirname, '..', 'integridad.json');
let integridadDeclarada = null;
try {
  integridadDeclarada = JSON.parse(fs.readFileSync(rutaIntegridad, 'utf8'));
} catch (e) {
  integridadDeclarada = null;
}

function sha256De(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function registrarAlerta(texto) {
  const linea = new Date().toISOString() + ' ' + texto + '\n';
  try {
    fs.mkdirSync(path.join(__dirname, '..', 'logs'), { recursive: true });
    fs.appendFileSync(path.join(__dirname, '..', 'logs', 'seguridad.log'), linea);
  } catch (e) {
    // Nunca rompe el servicio por fallo de log.
  }
  console.error('[SEGURIDAD] ' + texto);
}

function escanear(raiz, base) {
  let entradas = [];
  try {
    entradas = fs.readdirSync(raiz, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const entrada of entradas) {
    if (entrada.name.startsWith('.')) continue; // ocultos: fuera
    const rutaCompleta = path.join(raiz, entrada.name);
    if (entrada.isDirectory()) {
      escanear(rutaCompleta, base);
      continue;
    }
    if (!entrada.isFile()) continue;
    const ext = path.extname(entrada.name).toLowerCase();
    if (!EXTENSIONES[ext]) continue;
    const relativa = path.relative(base, rutaCompleta).replace(/\\/g, '/');
    try {
      const contenido = fs.readFileSync(rutaCompleta);
      const st = fs.statSync(rutaCompleta);
      const extCarga = path.extname(rutaCompleta).toLowerCase();
      archivos.set(relativa, {
        contenido,
        sha256: sha256De(contenido),
        mtimeMs: st.mtimeMs,
        gz: COMPRESIBLES.has(extCarga) && contenido.length >= MIN_GZIP ? zlib.gzipSync(contenido, { level: 6 }) : null
      });
    } catch (e) {
      registrarAlerta('No se pudo cargar ' + relativa);
    }
  }
}

function verificarIntegridad() {
  if (!integridadDeclarada) return;
  const claves = typeof integridadDeclarada === 'object' && integridadDeclarada !== null
    ? Object.keys(integridadDeclarada)
    : [];
  for (const relativa of claves) {
    const esperado = integridadDeclarada[relativa];
    if (typeof esperado !== 'string') continue;
    const actual = archivos.get(relativa);
    if (!actual) {
      registrarAlerta('FALTA archivo declarado en integridad.json: ' + relativa);
    } else if (actual.sha256 !== esperado) {
      registrarAlerta('MODIFICADO vs integridad.json: ' + relativa);
    }
  }
}

function observarCambios() {
  const vigilar = [RAIZ, path.join(__dirname, '..', 'api-gateway', 'src'), path.join(__dirname, '..', 'apis')];
  for (const dir of vigilar) {
    try {
      fs.watch(dir, { recursive: true }, (evento, nombre) => {
        if (!nombre) return;
        registrarAlerta('Cambio detectado en disco (' + evento + '): ' + String(nombre));
      });
    } catch (e) {
      // fs.watch recursivo puede no estar disponible; lo cubre la comprobacion periodica.
    }
  }
  setInterval(() => {
    // Recompara contra la memoria cargada en arranque (lo servido NO cambia
    // hasta reiniciar; aqui solo se alerta).
    for (const [relativa, dato] of archivos) {
      try {
        const st = fs.statSync(path.join(RAIZ, relativa));
        if (Math.abs(st.mtimeMs - dato.mtimeMs) > 1) {
          registrarAlerta('Archivo alterado en disco (no se sirve hasta reiniciar): ' + relativa);
          dato.mtimeMs = st.mtimeMs;
        }
      } catch (e) {
        registrarAlerta('Archivo eliminado en disco: ' + relativa);
      }
    }
  }, 60000).unref();
}

// ---------- Validacion de ruta ----------
function rutaSegura(url) {
  let decodificada;
  try {
    decodificada = decodeURIComponent(url);
  } catch (e) {
    return null;
  }
  // Trucos de Windows: barra invertida, dos puntos, flujos alternos, %00.
  if (decodificada.includes('\\') || decodificada.includes(':') || decodificada.includes('\0')) return null;
  if (/%00/i.test(url) || /%2e%2e/i.test(url) || /%2f/i.test(url) || /%5c/i.test(url)) return null;
  const partes = decodificada.split('/').filter((p) => p !== '');
  for (const parte of partes) {
    if (parte === '..') return null;
    if (RESERVADOS.test(parte)) return null;
    if (parte.includes(':')) return null;
  }
  const relativa = partes.join('/');
  if (relativa === '') return 'index.html';
  if (relativa.includes('..')) return null;
  // Solo se sirve lo que este en memoria (lista blanca real).
  if (!archivos.has(relativa)) {
    // Un archivo con extension valida pero no cargado = no existe para nosotros.
    const ext = path.extname(relativa).toLowerCase();
    if (!EXTENSIONES[ext]) return null;
    return null;
  }
  return relativa;
}

// ---------- Servidor ----------
function cabecerasBase() {
  return Object.assign({}, CABECERAS);
}

function enviarCabeceras(res, extra) {
  const cabeceras = Object.assign({}, CABECERAS, extra);
  for (const clave of Object.keys(cabeceras)) {
    if (cabeceras[clave] === null) continue;
    res.setHeader(clave, cabeceras[clave]);
  }
}

function responder(res, codigo, cuerpo, tipo) {
  enviarCabeceras(res, {
    'Cache-Control': 'no-store',
    'Content-Type': tipo,
    'Content-Length': Buffer.byteLength(cuerpo)
  });
  res.statusCode = codigo;
  res.end(cuerpo);
}

function aceptaGzip(req) {
  const ac = String(req.headers['accept-encoding'] || '');
  return /\bgzip\b/.test(ac);
}

function controlarHost(req, res) {
  const host = String(req.headers.host || '');
  const permitidos = ['localhost:' + PUERTO, '127.0.0.1:' + PUERTO, '[::1]:' + PUERTO, 'localhost', '127.0.0.1', '[::1]'];
  if (!permitidos.includes(host)) {
    responder(res, 421, JSON.stringify({ ok: false, codigo: 421, mensaje: 'Host invalido.', datos: [] }), 'application/json; charset=utf-8');
    return false;
  }
  return true;
}

const atender = (req, res) => {
  if (!controlarHost(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    responder(res, 405, JSON.stringify({ ok: false, codigo: 405, mensaje: 'Metodo no permitido.', datos: [] }), 'application/json; charset=utf-8');
    return;
  }
  const url = String(req.url || '/').split('?')[0].split('#')[0];
  if (url.includes('..') || /%2e/i.test(url)) {
    responder(res, 400, JSON.stringify({ ok: false, codigo: 400, mensaje: 'Ruta invalida.', datos: [] }), 'application/json; charset=utf-8');
    return;
  }
  const relativa = rutaSegura(url);
  if (!relativa) {
    responder(res, 404, JSON.stringify({ ok: false, codigo: 404, mensaje: 'Recurso no encontrado.', datos: [] }), 'application/json; charset=utf-8');
    return;
  }
  const dato = archivos.get(relativa);
  if (!dato) {
    responder(res, 404, JSON.stringify({ ok: false, codigo: 404, mensaje: 'Recurso no encontrado.', datos: [] }), 'application/json; charset=utf-8');
    return;
  }
  const tipo = EXTENSIONES[path.extname(relativa).toLowerCase()] || 'application/octet-stream';
  const etag = '"' + dato.sha256 + '"';
  const cacheControl = controlCacheDe(relativa);
  const comprimible = dato.gz !== null && aceptaGzip(req);

  // Revalidacion con ETag (.condicional): no reenvia cuerpo si sigue igual.
  const inm = String(req.headers['if-none-match'] || '').trim();
  if (req.method === 'GET' && inm !== '' && inm === etag) {
    enviarCabeceras(res, { 'Cache-Control': cacheControl, 'ETag': etag });
    res.statusCode = 304;
    res.end();
    return;
  }

  const cuerpoEnviar = comprimible ? dato.gz : dato.contenido;
  const extra = {
    'Cache-Control': cacheControl,
    'ETag': etag,
    'Content-Type': tipo,
    'Vary': 'Accept-Encoding',
    'Content-Length': cuerpoEnviar.length
  };
  if (comprimible) {
    extra['Content-Encoding'] = 'gzip';
  }

  if (req.method === 'HEAD') {
    enviarCabeceras(res, extra);
    res.statusCode = 200;
    res.end();
    return;
  }
  enviarCabeceras(res, extra);
  res.statusCode = 200;
  res.end(cuerpoEnviar);
};

const tls = cargarTls();
const servidor = tls
  ? https.createServer({ pfx: tls.pfx, passphrase: tls.passphrase, minVersion: 'TLSv1.2' }, atender)
  : http.createServer(atender);

servidor.headersTimeout = 15000;
servidor.requestTimeout = 30000;
servidor.keepAliveTimeout = 5000;
servidor.maxHeadersCount = 50;
servidor.maxConnections = 200;

if (require.main === module) {
  escanear(RAIZ, RAIZ);
  verificarIntegridad();
  observarCambios();
  servidor.listen(PUERTO, HOST, () => {
    console.log((tls ? 'Frontend estatico TLS en https://127.0.0.1:' : 'Frontend estatico (SIN TLS) en http://127.0.0.1:') + PUERTO + ' (archivos en memoria: ' + archivos.size + ')');
    if (!tls) console.error('[SEGURIDAD] Sin certificado TLS: el servicio quedo en HTTP.');
  });
}

module.exports = servidor;
