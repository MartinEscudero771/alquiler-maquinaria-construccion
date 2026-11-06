require('dotenv').config();

function texto(variable, defecto) {
  const valor = process.env[variable];
  if (typeof valor === 'string' && valor.trim() !== '') {
    return valor.trim();
  }
  return defecto;
}

function listaTextos(variable, defectos) {
  const valor = texto(variable, '');
  const partes = (valor === '' ? [] : valor.split(','))
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s !== '');
  return partes.length > 0 ? partes : defectos;
}

// S7: el secreto JWT se exige aqui, al arrancar. Un proceso sin secreto
// util no debe quedar en pie firmando tokens falsificables.
const secretoJwt = texto('SECRETO_JWT', '');
if (secretoJwt.length < 32) {
  throw new Error(
    'SECRETO_JWT ausente o demasiado corto (minimo 32 caracteres). ' +
      'Genere uno con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
      'y mueva el valor a api-gateway/.env'
  );
}

const ORIGENES_DEFECTO = [
  'https://localhost:8443',
  'https://127.0.0.1:8443',
  'http://localhost:8443',
  'http://127.0.0.1:8443'
];

// El frontend se sirve por TLS en 8443; se aceptan las variantes https y
// http del mismo host para tolerar una instalacion sin certificado.
const origenFrontend = texto('ORIGEN_FRONTEND', '');

const entorno = {
  puerto: Number(process.env.PORT || 3000) || 3000,
  origenFrontend,
  origenesFrontend: listaTextos('ORIGEN_FRONTEND', ORIGENES_DEFECTO),
  secretoJwt,
  urlApiPhp: texto('URL_API_PHP', 'http://127.0.0.1:8000').replace(/\/+$/, ''),
  urlApiNode: texto('URL_API_NODE', 'http://127.0.0.1:3002').replace(/\/+$/, ''),
  urlApiPython: texto('URL_API_PYTHON', 'http://127.0.0.1:3003').replace(/\/+$/, ''),
  clavePhp: texto('CLAVE_INTERNA_PHP', ''),
  claveNode: texto('CLAVE_INTERNA_NODE', ''),
  clavePython: texto('CLAVE_INTERNA_PYTHON', '')
};

module.exports = entorno;
