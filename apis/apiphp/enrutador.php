<?php
date_default_timezone_set('America/Bogota');

$raiz = __DIR__;
$rutaEnv = $raiz . DIRECTORY_SEPARATOR . '.env';
if (is_file($rutaEnv)) {
    $lineas = file($rutaEnv, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (is_array($lineas)) {
        foreach ($lineas as $linea) {
            $linea = trim((string)$linea);
            if ($linea === '' || $linea[0] === '#') {
                continue;
            }
            $pos = strpos($linea, '=');
            if ($pos === false) {
                continue;
            }
            $nombre = trim(substr($linea, 0, $pos));
            $valor = trim(substr($linea, $pos + 1));
            $largo = strlen($valor);
            if ($largo >= 2 && (($valor[0] === '"' && $valor[$largo - 1] === '"') || ($valor[0] === "'" && $valor[$largo - 1] === "'"))) {
                $valor = substr($valor, 1, $largo - 2);
            }
            if ($nombre !== '' && getenv($nombre) === false) {
                putenv($nombre . '=' . $valor);
                $_ENV[$nombre] = $valor;
            }
        }
    }
}

require_once $raiz . DIRECTORY_SEPARATOR . 'conexion.php';

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Content-Type: application/json; charset=utf-8');

function responder(int $codigo, string $mensaje, $datos = []): void
{
    http_response_code($codigo);
    echo json_encode(
        ['ok' => $codigo < 400, 'codigo' => $codigo, 'mensaje' => $mensaje, 'datos' => $datos],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
}

function esc($valor)
{
    if (is_string($valor)) {
        return htmlspecialchars($valor, ENT_QUOTES, 'UTF-8');
    }
    if (is_array($valor)) {
        $salida = [];
        foreach ($valor as $k => $v) {
            $salida[$k] = esc($v);
        }
        return $salida;
    }
    return $valor;
}

function textoPlano($valor): string
{
    if (is_string($valor)) {
        return trim($valor);
    }
    if (is_int($valor) || is_float($valor)) {
        return trim((string)$valor);
    }
    return '';
}

function enteroValido($valor): ?int
{
    if (is_int($valor)) {
        return $valor;
    }
    if (is_string($valor) && preg_match('/^-?\d+$/', trim($valor))) {
        return (int)trim($valor);
    }
    return null;
}

// Sin CORS: estas APIs solo las llama el gateway servidor-a-servidor.
// CORS controla respuestas para navegadores, que nunca llegan directo.
$metodo = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($metodo === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function claveRecibida(): string
{
    if (isset($_SERVER['HTTP_X_CLAVE_INTERNA'])) {
        return (string)$_SERVER['HTTP_X_CLAVE_INTERNA'];
    }
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $nombre => $valor) {
            if (strtolower((string)$nombre) === 'x-clave-interna') {
                return (string)$valor;
            }
        }
    }
    return '';
}

function rolRecibido(): string
{
    if (isset($_SERVER['HTTP_X_ROL'])) {
        return (string)$_SERVER['HTTP_X_ROL'];
    }
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $nombreCabecera => $valorCabecera) {
            if (strtolower((string)$nombreCabecera) === 'x-rol') {
                return (string)$valorCabecera;
            }
        }
    }
    return '';
}

$esperada = (string)(getenv('CLAVE_INTERNA_PHP') ?: '');
$recibida = claveRecibida();
if ($esperada === '' || $recibida === '' || !hash_equals($esperada, $recibida)) {
    responder(403, 'Acceso denegado.', []);
}

$ipRemota = (string)($_SERVER['REMOTE_ADDR'] ?? '');
if (!in_array($ipRemota, ['127.0.0.1', '::1', '::ffff:127.0.0.1'], true)) {
    responder(403, 'Acceso denegado.', []);
}

// N2 (DNS rebinding): solo Host del propio servicio PHP.
$hostRecibido = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
if (!in_array($hostRecibido, ['localhost:8000', '127.0.0.1:8000', '[::1]:8000'], true)) {
    responder(421, 'Host inválido.', []);
}

$ruta = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$ruta = '/' . trim((string)$ruta, '/');

$cuerpo = file_get_contents('php://input');
$entrada = [];
if (is_string($cuerpo) && trim($cuerpo) !== '') {
    $decodificado = json_decode($cuerpo, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($decodificado)) {
        responder(400, 'Cuerpo JSON inválido.', []);
    }
    $entrada = $decodificado;
}

try {
    $conexion = obtenerConexion();
} catch (Throwable $e) {
    responder(500, 'Error interno del servidor.', []);
}

try {
    if ($ruta === '/salud' && $metodo === 'GET') {
        responder(200, 'Servicio disponible.', ['servicio' => 'apiphp', 'hora' => date('Y-m-d H:i:s')]);
    }

    if ($ruta === '/captcha/generar' && $metodo === 'POST') {
        $catalogo = ['aplanadora', 'cargador', 'compactadora', 'excavadora', 'grua', 'mezcladora'];
        $objetivo = $catalogo[random_int(0, count($catalogo) - 1)];
        $familiaPluma = ['compactadora', 'excavadora', 'grua'];
        if (in_array($objetivo, $familiaPluma, true)) {
            $resto = array_values(array_diff($catalogo, $familiaPluma));
        } else {
            $resto = array_values(array_diff($catalogo, [$objetivo]));
        }
        shuffle($resto);
        $opciones = array_slice($resto, 0, 3);
        $opciones[] = $objetivo;
        shuffle($opciones);
        $idcaptcha = bin2hex(random_bytes(16));
        // S11: cuota por IP de captchas activos (no usados y no expirados).
        // Detiene la inundacion de la tabla captchas desde un solo origen.
        $cuenta = $conexion->prepare('SELECT COUNT(*) AS total FROM captchas WHERE ip = ? AND usado = 0 AND expira > NOW()');
        $cuenta->bind_param('s', $ipRemota);
        $cuenta->execute();
        $total = (int)($cuenta->get_result()->fetch_assoc()['total'] ?? 0);
        $cuenta->close();
        if ($total >= 15) {
            responder(429, 'Demasiados captchas pendientes desde esta IP.', []);
        }
        $limpieza = $conexion->prepare('DELETE FROM captchas WHERE expira < NOW()');
        $limpieza->execute();
        $limpieza->close();
        $insercion = $conexion->prepare('INSERT INTO captchas (idcaptcha, respuesta, expira, usado, ip) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), 0, ?)');
        $insercion->bind_param('sss', $idcaptcha, $objetivo, $ipRemota);
        $insercion->execute();
        $insercion->close();
        responder(201, 'Captcha generado.', ['captcha_id' => $idcaptcha, 'objetivo' => $objetivo, 'opciones' => $opciones]);
    }

    if ($ruta === '/usuarios/login' && $metodo === 'POST') {
        $usuario = textoPlano($entrada['usuario'] ?? '');
        $clave = isset($entrada['clave']) && (is_string($entrada['clave']) || is_int($entrada['clave']) || is_float($entrada['clave'])) ? (string)$entrada['clave'] : '';
        $captchaId = textoPlano($entrada['captcha_id'] ?? '');
        $captchaResp = isset($entrada['captcha_respuesta']) && (is_string($entrada['captcha_respuesta']) || is_int($entrada['captcha_respuesta']) || is_float($entrada['captcha_respuesta'])) ? (string)$entrada['captcha_respuesta'] : '';
        if ($usuario === '' || $clave === '' || $captchaId === '' || trim($captchaResp) === '') {
            responder(400, 'Datos incompletos.', []);
        }
        if (mb_strlen($usuario, 'UTF-8') > 60 || mb_strlen($captchaId, 'UTF-8') > 64 || mb_strlen(trim($captchaResp), 'UTF-8') > 30) {
            responder(400, 'Datos inválidos.', []);
        }
        $consulta = $conexion->prepare('SELECT respuesta, expira, usado FROM captchas WHERE idcaptcha = ? LIMIT 1');
        $consulta->bind_param('s', $captchaId);
        $consulta->execute();
        $filaCaptcha = $consulta->get_result()->fetch_assoc();
        $consulta->close();
        $fallaCaptcha = false;
        if (!is_array($filaCaptcha)) {
            $fallaCaptcha = true;
        } else {
            $esperadaResp = strtolower(trim((string)$filaCaptcha['respuesta']));
            $dadaResp = strtolower(trim($captchaResp));
            if ((int)$filaCaptcha['usado'] !== 0) {
                $fallaCaptcha = true;
            } elseif (strtotime((string)$filaCaptcha['expira']) < time()) {
                $fallaCaptcha = true;
            } elseif ($esperadaResp === '' || $dadaResp === '' || !hash_equals($esperadaResp, $dadaResp)) {
                $fallaCaptcha = true;
            }
        }
        if ($fallaCaptcha) {
            if (is_array($filaCaptcha)) {
                $marca = $conexion->prepare('UPDATE captchas SET usado = 1 WHERE idcaptcha = ?');
                $marca->bind_param('s', $captchaId);
                $marca->execute();
                $marca->close();
            }
            responder(400, 'Captcha incorrecto. Intente de nuevo.', []);
        }
        $marca = $conexion->prepare('UPDATE captchas SET usado = 1 WHERE idcaptcha = ?');
        $marca->bind_param('s', $captchaId);
        $marca->execute();
        $marca->close();
        $consultaU = $conexion->prepare('SELECT idusuario, usuario, nombre, clave, rol, activo, intentos_fallidos, bloqueado_hasta FROM usuarios WHERE usuario = ? LIMIT 1');
        $consultaU->bind_param('s', $usuario);
        $consultaU->execute();
        $filaU = $consultaU->get_result()->fetch_assoc();
        $consultaU->close();
        $hashFalso = '$2y$12$m3dMC//bjV8Biq1rypogNu7oX4jQsRbhgiD2WeuNbcfweliHraYu6';
        // N5: la verificacion de la clave va primero (hash senyuelo cuando el
        // usuario no existe) y TODAS las fallas autenticativas devuelven el
        // mismo mensaje, para que el login no sirva para enumerar cuentas ni
        // deducir bloqueos desde fuera.
        if (!is_array($filaU)) {
            password_verify($clave, $hashFalso);
            responder(401, 'Credenciales inválidas.', []);
        }
        if (!password_verify($clave, (string)$filaU['clave'])) {
            // El incremento y el bloqueo se manejan como antes; el mensaje no
            // revela si la cuenta quedo bloqueada o si solo fallo una vez.
            $idusuarioF = (int)$filaU['idusuario'];
            if ((int)$filaU['intentos_fallidos'] >= 4) {
                $bloqueo = $conexion->prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE idusuario = ?');
                $bloqueo->bind_param('i', $idusuarioF);
                $bloqueo->execute();
                $bloqueo->close();
            } else {
                $intentos = (int)$filaU['intentos_fallidos'] + 1;
                $fallo = $conexion->prepare('UPDATE usuarios SET intentos_fallidos = ? WHERE idusuario = ?');
                $fallo->bind_param('ii', $intentos, $idusuarioF);
                $fallo->execute();
                $fallo->close();
            }
            responder(401, 'Credenciales inválidas.', []);
        }
        if ((int)$filaU['activo'] !== 1) {
            responder(403, 'Credenciales inválidas.', []);
        }
        if ($filaU['bloqueado_hasta'] !== null && strtotime((string)$filaU['bloqueado_hasta']) > time()) {
            responder(403, 'Credenciales inválidas.', []);
        }
        $idusuarioOk = (int)$filaU['idusuario'];
        $exito = $conexion->prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE idusuario = ?');
        $exito->bind_param('i', $idusuarioOk);
        $exito->execute();
        $exito->close();
        $consultaCambio = $conexion->prepare('SELECT debe_cambiar_clave FROM usuarios WHERE idusuario = ? LIMIT 1');
        $consultaCambio->bind_param('i', $idusuarioOk);
        $consultaCambio->execute();
        $debeCambiar = (int)($consultaCambio->get_result()->fetch_assoc()['debe_cambiar_clave'] ?? 0);
        $consultaCambio->close();
        responder(200, 'Acceso correcto.', esc([
            'idusuario' => $idusuarioOk,
            'usuario' => (string)$filaU['usuario'],
            'nombre' => (string)$filaU['nombre'],
            'rol' => (string)$filaU['rol'],
            'debe_cambiar_clave' => $debeCambiar,
        ]));
    }

    if ($ruta === '/usuarios/clave' && $metodo === 'PUT') {
        $idusuario = enteroValido($entrada['idusuario'] ?? null);
        $actual = isset($entrada['actual']) && is_string($entrada['actual']) ? $entrada['actual'] : '';
        $nueva = isset($entrada['nueva']) && is_string($entrada['nueva']) ? $entrada['nueva'] : '';
        if ($idusuario === null || $idusuario <= 0 || $actual === '' || $nueva === '') {
            responder(400, 'Datos incompletos.', []);
        }
        if (mb_strlen($nueva, 'UTF-8') < 12 || mb_strlen($nueva, 'UTF-8') > 72) {
            responder(400, 'La clave nueva debe tener entre 12 y 72 caracteres.', []);
        }
        if (mb_strlen($actual, 'UTF-8') > 72) {
            responder(400, 'Datos inválidos.', []);
        }
        $consulta = $conexion->prepare('SELECT clave, activo FROM usuarios WHERE idusuario = ? LIMIT 1');
        $consulta->bind_param('i', $idusuario);
        $consulta->execute();
        $fila = $consulta->get_result()->fetch_assoc();
        $consulta->close();
        if (!is_array($fila)) {
            responder(404, 'Usuario no encontrado.', []);
        }
        if ((int)$fila['activo'] !== 1) {
            responder(403, 'Usuario inactivo.', []);
        }
        if (!password_verify($actual, (string)$fila['clave'])) {
            responder(400, 'La clave actual es incorrecta.', []);
        }
        $nuevoHash = password_hash($nueva, PASSWORD_BCRYPT, ['cost' => 12]);
        $cambio = $conexion->prepare('UPDATE usuarios SET clave = ?, debe_cambiar_clave = 0 WHERE idusuario = ?');
        $cambio->bind_param('si', $nuevoHash, $idusuario);
        $cambio->execute();
        $cambio->close();
        responder(200, 'Clave actualizada.', []);
    }

    if ($ruta === '/usuarios/clave-admin' && $metodo === 'PATCH') {
        if (rolRecibido() !== 'admin') {
            responder(403, 'Se requiere rol admin.', []);
        }
        $usuario = textoPlano($entrada['usuario'] ?? '');
        $nueva = isset($entrada['nueva']) && is_string($entrada['nueva']) ? $entrada['nueva'] : '';
        if ($usuario === '' || $nueva === '') {
            responder(400, 'Datos incompletos.', []);
        }
        if (mb_strlen($usuario, 'UTF-8') > 60 || mb_strlen($nueva, 'UTF-8') < 12 || mb_strlen($nueva, 'UTF-8') > 72) {
            responder(400, 'Usuario inválido o clave fuera de 12 a 72 caracteres.', []);
        }
        $consulta = $conexion->prepare('SELECT idusuario, activo FROM usuarios WHERE usuario = ? LIMIT 1');
        $consulta->bind_param('s', $usuario);
        $consulta->execute();
        $fila = $consulta->get_result()->fetch_assoc();
        $consulta->close();
        if (!is_array($fila)) {
            responder(404, 'Usuario no encontrado.', []);
        }
        if ((int)$fila['activo'] !== 1) {
            responder(403, 'Usuario inactivo.', []);
        }
        $nuevoHash = password_hash($nueva, PASSWORD_BCRYPT, ['cost' => 12]);
        $idDestino = (int)$fila['idusuario'];
        $cambio = $conexion->prepare('UPDATE usuarios SET clave = ?, debe_cambiar_clave = 1 WHERE idusuario = ?');
        $cambio->bind_param('si', $nuevoHash, $idDestino);
        $cambio->execute();
        $cambio->close();
        responder(200, 'Clave restablecida.', []);
    }

    if ($ruta === '/usuarios/lista' && $metodo === 'GET') {
        // CUENTAS:GET — listado de cuentas del sistema, exclusivo de admin.
        // Nunca expone hashes ni campos sensibles de autenticacion.
        if (rolRecibido() !== 'admin') {
            responder(403, 'Se requiere rol admin.', []);
        }
        $resultado = $conexion->query('SELECT idusuario, usuario, nombre, rol, activo, intentos_fallidos, bloqueado_hasta, debe_cambiar_clave, fecharegistro FROM usuarios ORDER BY idusuario ASC');
        $usuarios = [];
        while ($filaL = $resultado->fetch_assoc()) {
            $filaL['idusuario'] = (int)$filaL['idusuario'];
            $filaL['activo'] = (int)$filaL['activo'];
            $filaL['intentos_fallidos'] = (int)$filaL['intentos_fallidos'];
            $filaL['debe_cambiar_clave'] = (int)$filaL['debe_cambiar_clave'];
            $usuarios[] = esc($filaL);
        }
        $resultado->close();
        responder(200, 'Usuarios obtenidos.', $usuarios);
    }

    if ($ruta === '/usuarios/crear' && $metodo === 'POST') {
        // CUENTAS:POST — crea cuenta de operador, exclusivo de admin.
        if (rolRecibido() !== 'admin') {
            responder(403, 'Se requiere rol admin.', []);
        }
        $nombre = textoPlano($entrada['nombre'] ?? '');
        $usuario = strtolower(textoPlano($entrada['usuario'] ?? ''));
        $clave = isset($entrada['clave']) && is_string($entrada['clave']) ? $entrada['clave'] : '';
        $rol = strtolower(textoPlano($entrada['rol'] ?? 'operador'));
        if ($nombre === '' || mb_strlen($nombre, 'UTF-8') > 100) {
            responder(400, 'Nombre inválido. Entre 1 y 100 caracteres.', []);
        }
        if (!preg_match('/^[a-z0-9_.\-]{4,30}$/', $usuario)) {
            responder(400, 'Usuario inválido. 4 a 30 caracteres entre letras minúsculas, números, punto, guion o guion bajo.', []);
        }
        if ($rol !== 'operador') {
            responder(400, 'Rol inválido. Solo operador.', []);
        }
        if (mb_strlen($clave, 'UTF-8') < 12 || mb_strlen($clave, 'UTF-8') > 72) {
            responder(400, 'La clave debe tener entre 12 y 72 caracteres.', []);
        }
        $existe = $conexion->prepare('SELECT idusuario FROM usuarios WHERE usuario = ? LIMIT 1');
        $existe->bind_param('s', $usuario);
        $existe->execute();
        $duplicadoU = $existe->get_result()->fetch_assoc();
        $existe->close();
        if (is_array($duplicadoU)) {
            responder(409, 'El usuario ya está registrado.', []);
        }
        $nuevoHash = password_hash($clave, PASSWORD_BCRYPT, ['cost' => 12]);
        $fecha = date('Y-m-d');
        try {
            // debe_cambiar_clave = 1: la clave temporal solo vale el primer ingreso.
            $insercionU = $conexion->prepare('INSERT INTO usuarios (usuario, nombre, clave, rol, activo, debe_cambiar_clave, fecharegistro) VALUES (?, ?, ?, ?, 1, 1, ?)');
            $insercionU->bind_param('sssss', $usuario, $nombre, $nuevoHash, $rol, $fecha);
            $insercionU->execute();
            $nuevoIdU = $conexion->insert_id;
            $insercionU->close();
        } catch (mysqli_sql_exception $e) {
            if ((int)$e->getCode() === 1062) {
                responder(409, 'El usuario ya está registrado.', []);
            }
            throw $e;
        }
        responder(201, 'Usuario creado. Deberá cambiar su clave temporal al ingresar.', ['idusuario' => (int)$nuevoIdU, 'usuario' => $usuario, 'rol' => $rol]);
    }

    if ($ruta === '/clientes' && $metodo === 'GET') {
        $q = textoPlano($_GET['q'] ?? '');
        if (mb_strlen($q, 'UTF-8') > 100) {
            responder(400, 'Búsqueda demasiado larga.', []);
        }
        $paginaCruda = $_GET['pagina'] ?? 1;
        $limiteCrudo = $_GET['limite'] ?? 20;
        $pagina = enteroValido($paginaCruda);
        $limite = enteroValido($limiteCrudo);
        if ($pagina === null || $pagina < 1) {
            responder(400, 'Página inválida.', []);
        }
        if ($limite === null || $limite < 1 || $limite > 200) {
            responder(400, 'El límite debe estar entre 1 y 200.', []);
        }
        // S13: se remplaza la busqueda vacia por comodin y se escapan los
        // comodines literales del usuario (% _ \) para que buscar "50%"
        // no termine en un escaneo de todas las filas.
        $limpio = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q);
        $like = '%' . $limpio . '%';
        $conteo = $conexion->prepare('SELECT COUNT(*) AS total FROM clientes WHERE nombre LIKE ? OR documento LIKE ? OR correo LIKE ?');
        $conteo->bind_param('sss', $like, $like, $like);
        $conteo->execute();
        $total = (int)($conteo->get_result()->fetch_assoc()['total'] ?? 0);
        $conteo->close();
        $desplazamiento = ($pagina - 1) * $limite;
        $lista = $conexion->prepare('SELECT idcliente, nombre, documento, telefono, correo, direccion, fecharegistro FROM clientes WHERE nombre LIKE ? OR documento LIKE ? OR correo LIKE ? ORDER BY idcliente DESC LIMIT ? OFFSET ?');
        $lista->bind_param('sssii', $like, $like, $like, $limite, $desplazamiento);
        $lista->execute();
        $resultado = $lista->get_result();
        $clientes = [];
        while ($fila = $resultado->fetch_assoc()) {
            $fila['idcliente'] = (int)$fila['idcliente'];
            $clientes[] = esc($fila);
        }
        $lista->close();
        responder(200, 'Clientes obtenidos.', ['total' => $total, 'pagina' => $pagina, 'limite' => $limite, 'clientes' => $clientes]);
    }

    if (preg_match('/^\/clientes\/(\d+)$/', $ruta, $partes) === 1 && $metodo === 'GET') {
        $idcliente = (int)$partes[1];
        if ($idcliente <= 0) {
            responder(400, 'Identificador inválido.', []);
        }
        $consulta = $conexion->prepare('SELECT idcliente, nombre, documento, telefono, correo, direccion, fecharegistro FROM clientes WHERE idcliente = ? LIMIT 1');
        $consulta->bind_param('i', $idcliente);
        $consulta->execute();
        $fila = $consulta->get_result()->fetch_assoc();
        $consulta->close();
        if (!is_array($fila)) {
            responder(404, 'Cliente no encontrado.', []);
        }
        $fila['idcliente'] = (int)$fila['idcliente'];
        responder(200, 'Cliente obtenido.', esc($fila));
    }

    if ($ruta === '/clientes' && $metodo === 'POST') {
        $nombre = textoPlano($entrada['nombre'] ?? '');
        $documento = textoPlano($entrada['documento'] ?? '');
        $telefonoCrudo = array_key_exists('telefono', $entrada) ? $entrada['telefono'] : null;
        $correoCrudo = array_key_exists('correo', $entrada) ? $entrada['correo'] : null;
        $direccionCruda = array_key_exists('direccion', $entrada) ? $entrada['direccion'] : null;
        $telefono = is_string($telefonoCrudo) ? trim($telefonoCrudo) : null;
        $correo = is_string($correoCrudo) ? trim($correoCrudo) : null;
        $direccion = is_string($direccionCruda) ? trim($direccionCruda) : null;
        if ($telefono === '') {
            $telefono = null;
        }
        if ($correo === '') {
            $correo = null;
        }
        if ($direccion === '') {
            $direccion = null;
        }
        if ($nombre === '' || mb_strlen($nombre, 'UTF-8') > 100) {
            responder(400, 'Nombre inválido. Debe tener entre 1 y 100 caracteres.', []);
        }
        if (!preg_match('/^[A-Za-z0-9.\-]{4,20}$/', $documento)) {
            responder(400, 'Documento inválido. Use entre 4 y 20 caracteres alfanuméricos, puntos o guiones.', []);
        }
        if ($telefono !== null && !preg_match('/^[0-9+() \-.]{7,20}$/', $telefono)) {
            responder(400, 'Teléfono inválido.', []);
        }
        if ($correo !== null && (mb_strlen($correo, 'UTF-8') > 100 || filter_var($correo, FILTER_VALIDATE_EMAIL) === false)) {
            responder(400, 'Correo inválido.', []);
        }
        if ($direccion !== null && mb_strlen($direccion, 'UTF-8') > 150) {
            responder(400, 'Dirección inválida. Máximo 150 caracteres.', []);
        }
        if ($telefono === null && $correo === null) {
            responder(400, 'Debe registrar teléfono o correo.', []);
        }
        $existe = $conexion->prepare('SELECT idcliente FROM clientes WHERE documento = ? LIMIT 1');
        $existe->bind_param('s', $documento);
        $existe->execute();
        $duplicado = $existe->get_result()->fetch_assoc();
        $existe->close();
        if (is_array($duplicado)) {
            responder(409, 'El documento ya está registrado.', []);
        }
        $fecha = date('Y-m-d');
        try {
            $insercion = $conexion->prepare('INSERT INTO clientes (nombre, documento, telefono, correo, direccion, fecharegistro) VALUES (?, ?, ?, ?, ?, ?)');
            $insercion->bind_param('ssssss', $nombre, $documento, $telefono, $correo, $direccion, $fecha);
            $insercion->execute();
            $nuevoId = $conexion->insert_id;
            $insercion->close();
        } catch (mysqli_sql_exception $e) {
            if ((int)$e->getCode() === 1062) {
                responder(409, 'El documento ya está registrado.', []);
            }
            throw $e;
        }
        responder(201, 'Cliente registrado.', ['idcliente' => (int)$nuevoId]);
    }

    if ($ruta === '/bitacora' && $metodo === 'POST') {
        $rama = textoPlano($entrada['rama'] ?? '');
        $metodoAccion = isset($entrada['metodo']) ? strtoupper(textoPlano($entrada['metodo'])) : '';
        $codigo = enteroValido($entrada['codigo'] ?? null);
        $ip = textoPlano($entrada['ip'] ?? '');
        $idusuarioBit = array_key_exists('idusuario', $entrada) ? enteroValido($entrada['idusuario']) : null;
        if ($rama === '' || mb_strlen($rama, 'UTF-8') > 30) {
            responder(400, 'Rama inválida. Máximo 30 caracteres.', []);
        }
        if ($metodoAccion === '' || mb_strlen($metodoAccion, 'UTF-8') > 10 || !preg_match('/^[A-Z]+$/', $metodoAccion)) {
            responder(400, 'Método inválido.', []);
        }
        if ($codigo === null || $codigo < -32768 || $codigo > 32767) {
            responder(400, 'Código inválido.', []);
        }
        if ($ip === '' || mb_strlen($ip, 'UTF-8') > 45 || filter_var($ip, FILTER_VALIDATE_IP) === false) {
            responder(400, 'IP inválida.', []);
        }
        if (array_key_exists('idusuario', $entrada)) {
            if ($idusuarioBit === null || $idusuarioBit <= 0) {
                responder(400, 'Usuario inválido.', []);
            }
            $verifica = $conexion->prepare('SELECT idusuario FROM usuarios WHERE idusuario = ? LIMIT 1');
            $verifica->bind_param('i', $idusuarioBit);
            $verifica->execute();
            $existeU = $verifica->get_result()->fetch_assoc();
            $verifica->close();
            if (!is_array($existeU)) {
                responder(404, 'Usuario no encontrado.', []);
            }
        }
        $insercion = $conexion->prepare('INSERT INTO bitacoraacciones (idusuario, rama, metodo, codigo, ip) VALUES (?, ?, ?, ?, ?)');
        $insercion->bind_param('issis', $idusuarioBit, $rama, $metodoAccion, $codigo, $ip);
        $insercion->execute();
        $nuevoId = $conexion->insert_id;
        $insercion->close();
        responder(201, 'Bitácora registrada.', ['idbitacora' => (int)$nuevoId]);
    }

    $rutasConocidas = ['/salud', '/captcha/generar', '/usuarios/login', '/usuarios/clave', '/usuarios/clave-admin', '/usuarios/lista', '/usuarios/crear', '/clientes', '/bitacora'];
    if (in_array($ruta, $rutasConocidas, true) || preg_match('/^\/clientes\/\d+$/', $ruta) === 1) {
        responder(405, 'Método no permitido.', []);
    }
    responder(404, 'Recurso no encontrado.', []);
} catch (mysqli_sql_exception $e) {
    responder(500, 'Error interno del servidor.', []);
} catch (Throwable $e) {
    responder(500, 'Error interno del servidor.', []);
}
