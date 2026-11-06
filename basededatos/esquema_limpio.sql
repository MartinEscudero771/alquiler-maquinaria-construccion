CREATE DATABASE IF NOT EXISTS controlalquiler CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE controlalquiler;

CREATE TABLE IF NOT EXISTS clientes (
  idcliente INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  documento VARCHAR(20) NOT NULL UNIQUE,
  telefono VARCHAR(20) NULL,
  correo VARCHAR(100) NULL,
  direccion VARCHAR(150) NULL,
  fecharegistro DATE NOT NULL,
  CHECK (telefono IS NOT NULL OR correo IS NOT NULL),
  INDEX ix_clientes_correo (correo)
);

CREATE TABLE IF NOT EXISTS usuarios (
  idusuario INT AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(60) NOT NULL UNIQUE,
  nombre VARCHAR(100) NOT NULL,
  clave VARCHAR(255) NOT NULL,
  rol ENUM('admin', 'operador') NOT NULL DEFAULT 'operador',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueado_hasta DATETIME NULL,
  debe_cambiar_clave TINYINT(1) NOT NULL DEFAULT 0,
  fecharegistro DATE NOT NULL,
  CHECK (activo IN (0, 1) AND intentos_fallidos >= 0 AND debe_cambiar_clave IN (0, 1))
);

CREATE TABLE IF NOT EXISTS bitacoraacciones (
  idbitacora INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  idusuario INT NULL,
  rama VARCHAR(30) NOT NULL,
  metodo VARCHAR(10) NOT NULL,
  codigo SMALLINT NOT NULL,
  ip VARCHAR(45) NOT NULL,
  INDEX ix_bitacora_fecha (fecha),
  INDEX ix_bitacora_usuario (idusuario)
);

CREATE TABLE IF NOT EXISTS captchas (
  idcaptcha VARCHAR(64) PRIMARY KEY,
  respuesta VARCHAR(30) NOT NULL,
  expira DATETIME NOT NULL,
  usado TINYINT(1) NOT NULL DEFAULT 0,
  ip VARCHAR(45) NOT NULL,
  creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_captchas_expira (expira)
);

CREATE TABLE IF NOT EXISTS alquileres (
  idalquiler INT AUTO_INCREMENT PRIMARY KEY,
  idcliente INT NOT NULL,
  idunidad INT NOT NULL,
  fechalquiler DATE NOT NULL,
  fechadevolucionprogramada DATE NOT NULL,
  fechadevolucionreal DATE NULL,
  tarifa_pactada DECIMAL(12,2) NOT NULL,
  costo_movilizacion_pactado DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  valorreparacion DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  observaciones VARCHAR(250) NULL,
  clave_idempotencia VARCHAR(64) NOT NULL UNIQUE,
  CHECK (fechadevolucionprogramada >= fechalquiler),
  CHECK (tarifa_pactada > 0 AND costo_movilizacion_pactado >= 0 AND valorreparacion >= 0),
  INDEX ix_alquileres_unidad (idunidad, fechadevolucionreal)
);

CREATE TABLE IF NOT EXISTS inspecciones (
  idinspeccion INT AUTO_INCREMENT PRIMARY KEY,
  idalquiler INT NOT NULL UNIQUE,
  estadofisico ENUM('bueno', 'regular', 'malo') NOT NULL,
  niveldesgaste ENUM('ninguno', 'bajo', 'medio', 'alto') NOT NULL,
  descripciondanos VARCHAR(250) NULL,
  observaciones VARCHAR(250) NULL,
  FOREIGN KEY (idalquiler) REFERENCES alquileres(idalquiler) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS solicitudes (
  idsolicitud INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  documento VARCHAR(20) NOT NULL,
  telefono VARCHAR(20) NULL,
  correo VARCHAR(100) NULL,
  idmaquinaria INT NOT NULL,
  fechalquiler DATE NOT NULL,
  fechadevolucionprogramada DATE NOT NULL,
  observaciones VARCHAR(250) NULL,
  estado ENUM('pendiente', 'aprobada', 'rechazada') NOT NULL DEFAULT 'pendiente',
  motivo_rechazo VARCHAR(250) NULL,
  idalquiler INT NULL,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (telefono IS NOT NULL OR correo IS NOT NULL),
  CHECK (fechadevolucionprogramada >= fechalquiler),
  INDEX ix_solicitudes_estado (estado),
  INDEX ix_solicitudes_fecha (fecha_creacion)
);

CREATE TABLE IF NOT EXISTS maquinarias (
  idmaquinaria INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  categoria ENUM('pesada', 'liviana') NOT NULL,
  carpeta VARCHAR(50) NOT NULL UNIQUE,
  tarifadiaria DECIMAL(12,2) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  CHECK (tarifadiaria > 0),
  INDEX ix_maquinarias_cat (categoria, activo)
);

CREATE TABLE IF NOT EXISTS maquinariaspesadas (
  idmaquinaria INT PRIMARY KEY,
  peso_toneladas DECIMAL(5,2) NOT NULL,
  costo_movilizacion DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  CHECK (peso_toneladas > 0 AND costo_movilizacion >= 0),
  FOREIGN KEY (idmaquinaria) REFERENCES maquinarias(idmaquinaria) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS maquinariaslivianas (
  idmaquinaria INT PRIMARY KEY,
  ancho_metros DECIMAL(4,2) NOT NULL,
  apta_zona_urbana TINYINT(1) NOT NULL DEFAULT 1,
  CHECK (ancho_metros > 0 AND apta_zona_urbana IN (0, 1)),
  FOREIGN KEY (idmaquinaria) REFERENCES maquinarias(idmaquinaria) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS unidades (
  idunidad INT AUTO_INCREMENT PRIMARY KEY,
  idmaquinaria INT NOT NULL,
  serial VARCHAR(50) NOT NULL UNIQUE,
  estado ENUM('disponible', 'alquilada', 'en_inspeccion', 'en_reparacion') NOT NULL DEFAULT 'disponible',
  estadodesde DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (idmaquinaria) REFERENCES maquinarias(idmaquinaria) ON DELETE RESTRICT,
  INDEX ix_unidades_maq (idmaquinaria, estado)
);

CREATE TABLE IF NOT EXISTS reportesguardados (
  idreporte INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  titulo VARCHAR(150) NOT NULL,
  total_contratos INT NOT NULL DEFAULT 0,
  contratos_activos INT,
  contratos_morosos INT,
  ingresos DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  maquina_mas_alquilada VARCHAR(100) NULL,
  unidades_pesadas INT NOT NULL DEFAULT 0,
  disponibles_pesadas INT NOT NULL DEFAULT 0,
  unidades_livianas INT NOT NULL DEFAULT 0,
  disponibles_livianas INT NOT NULL DEFAULT 0,
  CHECK (total_contratos >= 0 AND ingresos >= 0),
  INDEX ix_reportes_fecha (fecha)
);

CREATE TABLE IF NOT EXISTS notificaciones (
  idnotificacion INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(150) NOT NULL,
  mensaje VARCHAR(400) NOT NULL DEFAULT '',
  rama VARCHAR(30) NOT NULL DEFAULT '',
  nivel ENUM('info', 'exito', 'aviso', 'error') NOT NULL DEFAULT 'info',
  leida TINYINT(1) NOT NULL DEFAULT 0,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (CHAR_LENGTH(titulo) BETWEEN 1 AND 150),
  CHECK (CHAR_LENGTH(mensaje) <= 400),
  INDEX ix_notif_leida (leida),
  INDEX ix_notif_fecha (fecha)
);
