<?php
date_default_timezone_set('America/Bogota');

function obtenerConexion(): mysqli
{
    $maquina = getenv('DB_HOST');
    if ($maquina === false || trim((string)$maquina) === '') {
        $maquina = '127.0.0.1';
    }
    $puertoCrudo = getenv('DB_PORT');
    $puerto = ($puertoCrudo === false || (int)$puertoCrudo <= 0) ? 3306 : (int)$puertoCrudo;
    $base = (string)(getenv('DB_NAME') ?: '');
    $usuario = (string)(getenv('DB_USER') ?: '');
    $clave = (string)(getenv('DB_PASS') ?: '');
    if ($base === '' || $usuario === '') {
        throw new RuntimeException('Faltan variables de entorno de base de datos.');
    }
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    $conexion = new mysqli(trim((string)$maquina), $usuario, $clave, $base, $puerto);
    $conexion->set_charset('utf8mb4');
    // Corta consultas lentas (p. ej. SLEEP/BENCHMARK inyectados).
    $conexion->query('SET SESSION max_statement_time = 5');
    return $conexion;
}
