CREATE DATABASE IF NOT EXISTS controlalquiler CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Sin base de pruebas de MariaDB.
DROP DATABASE IF EXISTS test;
USE controlalquiler;
CREATE TABLE IF NOT EXISTS clientes (
idcliente INT AUTO_INCREMENT PRIMARY KEY,
nombre VARCHAR(100) NOT NULL,
documento VARCHAR(20) NOT NULL,
telefono VARCHAR(20) NULL,
correo VARCHAR(100) NULL,
direccion VARCHAR(150) NULL,
fecharegistro DATE NOT NULL,
CONSTRAINT uq_clientes_documento UNIQUE (documento),
CONSTRAINT ck_clientes_contacto CHECK (telefono IS NOT NULL OR correo IS NOT NULL),
INDEX ix_clientes_correo (correo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS usuarios (
idusuario INT AUTO_INCREMENT PRIMARY KEY,
usuario VARCHAR(60) NOT NULL,
nombre VARCHAR(100) NOT NULL,
clave VARCHAR(255) NOT NULL,
rol ENUM('admin','operador') NOT NULL DEFAULT 'operador',
activo TINYINT(1) NOT NULL DEFAULT 1,
intentos_fallidos INT NOT NULL DEFAULT 0,
bloqueado_hasta DATETIME NULL,
debe_cambiar_clave TINYINT(1) NOT NULL DEFAULT 0,
fecharegistro DATE NOT NULL,
CONSTRAINT uq_usuarios_usuario UNIQUE (usuario),
CONSTRAINT ck_usuarios_activo CHECK (activo IN (0,1)),
CONSTRAINT ck_usuarios_intentos CHECK (intentos_fallidos >= 0),
CONSTRAINT ck_usuarios_cambio CHECK (debe_cambiar_clave IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Migracion para bases creadas antes de la columna (idempotente).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_clave TINYINT(1) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS bitacoraacciones (
idbitacora INT AUTO_INCREMENT PRIMARY KEY,
fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
idusuario INT NULL,
rama VARCHAR(30) NOT NULL,
metodo VARCHAR(10) NOT NULL,
codigo SMALLINT NOT NULL,
ip VARCHAR(45) NOT NULL,
CONSTRAINT fk_bitacora_usuario FOREIGN KEY (idusuario) REFERENCES usuarios (idusuario) ON DELETE SET NULL ON UPDATE CASCADE,
INDEX ix_bitacora_fecha (fecha),
INDEX ix_bitacora_usuario (idusuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS captchas (
idcaptcha VARCHAR(64) NOT NULL PRIMARY KEY,
respuesta VARCHAR(30) NOT NULL,
expira DATETIME NOT NULL,
usado TINYINT(1) NOT NULL DEFAULT 0,
ip VARCHAR(45) NOT NULL,
creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT ck_captchas_usado CHECK (usado IN (0,1)),
INDEX ix_captchas_expira (expira)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
clave_idempotencia VARCHAR(64) NULL,
CONSTRAINT uq_alquileres_clave UNIQUE (clave_idempotencia),
CONSTRAINT ck_alquileres_fechas CHECK (fechadevolucionprogramada >= fechalquiler),
CONSTRAINT ck_alquileres_real CHECK (fechadevolucionreal IS NULL OR fechadevolucionreal >= fechalquiler),
CONSTRAINT ck_alquileres_tarifa CHECK (tarifa_pactada > 0),
CONSTRAINT ck_alquileres_movilizacion CHECK (costo_movilizacion_pactado >= 0),
CONSTRAINT ck_alquileres_reparacion CHECK (valorreparacion >= 0),
INDEX ix_alquileres_cliente (idcliente),
INDEX ix_alquileres_unidad_activo (idunidad, fechadevolucionreal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS inspecciones (
idinspeccion INT AUTO_INCREMENT PRIMARY KEY,
idalquiler INT NOT NULL,
estadofisico ENUM('bueno','regular','malo') NOT NULL,
niveldesgaste ENUM('ninguno','bajo','medio','alto') NOT NULL,
descripciondanos VARCHAR(250) NULL,
observaciones VARCHAR(250) NULL,
CONSTRAINT uq_inspecciones_alquiler UNIQUE (idalquiler),
CONSTRAINT fk_inspecciones_alquiler FOREIGN KEY (idalquiler) REFERENCES alquileres (idalquiler) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
estado ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
motivo_rechazo VARCHAR(250) NULL,
idalquiler INT NULL,
fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT ck_solicitudes_contacto CHECK (telefono IS NOT NULL OR correo IS NOT NULL),
CONSTRAINT ck_solicitudes_fechas CHECK (fechadevolucionprogramada >= fechalquiler),
INDEX ix_solicitudes_estado (estado),
INDEX ix_solicitudes_fecha (fecha_creacion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS maquinarias (
idmaquinaria INT AUTO_INCREMENT PRIMARY KEY,
nombre VARCHAR(100) NOT NULL,
categoria ENUM('pesada','liviana') NOT NULL,
carpeta VARCHAR(50) NOT NULL,
tarifadiaria DECIMAL(12,2) NOT NULL,
activo TINYINT(1) NOT NULL DEFAULT 1,
CONSTRAINT uq_maquinarias_nombre UNIQUE (nombre),
CONSTRAINT uq_maquinarias_carpeta UNIQUE (carpeta),
CONSTRAINT ck_maquinarias_tarifa CHECK (tarifadiaria > 0),
CONSTRAINT ck_maquinarias_activo CHECK (activo IN (0,1)),
INDEX ix_maquinarias_categoria (categoria, activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS maquinariaspesadas (
idmaquinaria INT NOT NULL PRIMARY KEY,
peso_toneladas DECIMAL(5,2) NOT NULL,
costo_movilizacion DECIMAL(12,2) NOT NULL DEFAULT 0.00,
CONSTRAINT ck_pesadas_peso CHECK (peso_toneladas > 0),
CONSTRAINT ck_pesadas_costo CHECK (costo_movilizacion >= 0),
CONSTRAINT fk_pesadas_maquinaria FOREIGN KEY (idmaquinaria) REFERENCES maquinarias (idmaquinaria) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS maquinariaslivianas (
idmaquinaria INT NOT NULL PRIMARY KEY,
ancho_metros DECIMAL(4,2) NOT NULL,
apta_zona_urbana TINYINT(1) NOT NULL DEFAULT 1,
CONSTRAINT ck_livianas_ancho CHECK (ancho_metros > 0),
CONSTRAINT ck_livianas_apta CHECK (apta_zona_urbana IN (0,1)),
CONSTRAINT fk_livianas_maquinaria FOREIGN KEY (idmaquinaria) REFERENCES maquinarias (idmaquinaria) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unidades (
idunidad INT AUTO_INCREMENT PRIMARY KEY,
idmaquinaria INT NOT NULL,
serial VARCHAR(50) NOT NULL,
estado ENUM('disponible','alquilada','en_inspeccion','en_reparacion') NOT NULL DEFAULT 'disponible',
estadodesde DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT uq_unidades_serial UNIQUE (serial),
CONSTRAINT fk_unidades_maquinaria FOREIGN KEY (idmaquinaria) REFERENCES maquinarias (idmaquinaria) ON DELETE RESTRICT ON UPDATE CASCADE,
INDEX ix_unidades_maquina_estado (idmaquinaria, estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS reportesguardados (
idreporte INT AUTO_INCREMENT PRIMARY KEY,
fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
titulo VARCHAR(150) NOT NULL,
total_contratos INT NOT NULL DEFAULT 0,
contratos_activos INT NOT NULL DEFAULT 0,
contratos_morosos INT NOT NULL DEFAULT 0,
ingresos DECIMAL(12,2) NOT NULL DEFAULT 0.00,
maquina_mas_alquilada VARCHAR(100) NULL,
unidades_pesadas INT NOT NULL DEFAULT 0,
disponibles_pesadas INT NOT NULL DEFAULT 0,
unidades_livianas INT NOT NULL DEFAULT 0,
disponibles_livianas INT NOT NULL DEFAULT 0,
CONSTRAINT ck_reportes_totales CHECK (total_contratos >= 0 AND contratos_activos >= 0 AND contratos_morosos >= 0),
CONSTRAINT ck_reportes_ingresos CHECK (ingresos >= 0),
CONSTRAINT ck_reportes_unidades CHECK (unidades_pesadas >= 0 AND disponibles_pesadas >= 0 AND unidades_livianas >= 0 AND disponibles_livianas >= 0),
INDEX ix_reportes_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET GLOBAL event_scheduler = ON;
DROP EVENT IF EXISTS purga_bitacora;
CREATE EVENT purga_bitacora ON SCHEDULE EVERY 1 DAY STARTS CURRENT_TIMESTAMP + INTERVAL 1 DAY DO DELETE FROM controlalquiler.bitacoraacciones WHERE fecha < (NOW() - INTERVAL 180 DAY);
INSERT IGNORE INTO usuarios (idusuario, usuario, nombre, clave, rol, activo, intentos_fallidos, debe_cambiar_clave, fecharegistro) VALUES (1, 'admin', 'Administrador', '@HASH_ADMIN@', 'admin', 1, 0, 1, '2026-10-28');
INSERT IGNORE INTO maquinarias (idmaquinaria, nombre, categoria, carpeta, tarifadiaria, activo) VALUES (1, 'Excavadora hidraulica', 'pesada', 'excavadora', 1450000.00, 1),(2, 'Minicargador', 'liviana', 'minicargador', 650000.00, 1),(3, 'Montacargas', 'liviana', 'montacargas', 380000.00, 1),(4, 'Bulldozer D9', 'pesada', 'bulldozer', 1800000.00, 1),(5, 'Cargador Frontal', 'pesada', 'cargadorfrontal', 1200000.00, 1),(6, 'Compactador Rolo', 'pesada', 'compactador', 750000.00, 1),(7, 'Grua Movil', 'pesada', 'gruamovil', 2200000.00, 1),(8, 'Miniexcavadora', 'liviana', 'miniexcavadora', 520000.00, 1),(9, 'Motoniveladora', 'pesada', 'motoniveladora', 1600000.00, 1),(10, 'Plataforma Cama Baja', 'liviana', 'plataforma', 480000.00, 1),(11, 'Retroexcavadora', 'pesada', 'retroexcavadora', 950000.00, 1),(12, 'Volqueta', 'pesada', 'volqueta', 900000.00, 1);
INSERT IGNORE INTO maquinariaspesadas (idmaquinaria, peso_toneladas, costo_movilizacion) VALUES (1, 20.50, 800000.00),(4, 24.50, 900000.00),(5, 18.00, 700000.00),(6, 12.00, 450000.00),(7, 30.00, 1100000.00),(9, 19.00, 850000.00),(11, 8.50, 400000.00),(12, 15.00, 500000.00);
INSERT IGNORE INTO maquinariaslivianas (idmaquinaria, ancho_metros, apta_zona_urbana) VALUES (2, 1.80, 1),(3, 1.20, 1),(8, 1.50, 1),(10, 2.40, 1);
INSERT IGNORE INTO unidades (idunidad, idmaquinaria, serial, estado) VALUES (1, 1, 'excavadora-01', 'disponible'),(2, 1, 'excavadora-02', 'disponible'),(3, 1, 'excavadora-03', 'disponible'),(4, 2, 'minicargador-01', 'disponible'),(5, 2, 'minicargador-02', 'disponible'),(6, 2, 'minicargador-03', 'disponible'),(7, 3, 'montacargas-01', 'disponible'),(8, 3, 'montacargas-02', 'disponible'),(9, 3, 'montacargas-03', 'disponible'),(10, 4, 'bulldozer-01', 'disponible'),(11, 4, 'bulldozer-02', 'disponible'),(12, 5, 'cargadorfrontal-01', 'disponible'),(13, 5, 'cargadorfrontal-02', 'disponible'),(14, 6, 'compactador-01', 'disponible'),(15, 6, 'compactador-02', 'disponible'),(16, 7, 'gruamovil-01', 'disponible'),(17, 7, 'gruamovil-02', 'disponible'),(18, 8, 'miniexcavadora-01', 'disponible'),(19, 8, 'miniexcavadora-02', 'disponible'),(20, 9, 'motoniveladora-01', 'disponible'),(21, 9, 'motoniveladora-02', 'disponible'),(22, 10, 'plataforma-01', 'disponible'),(23, 10, 'plataforma-02', 'disponible'),(24, 11, 'retroexcavadora-01', 'disponible'),(25, 11, 'retroexcavadora-02', 'disponible'),(26, 12, 'volqueta-01', 'disponible'),(27, 12, 'volqueta-02', 'disponible');
CREATE USER IF NOT EXISTS 'usuariophp'@'localhost' IDENTIFIED BY '@CLAVE_PHP@';
CREATE USER IF NOT EXISTS 'usuariophp'@'127.0.0.1' IDENTIFIED BY '@CLAVE_PHP@';
CREATE USER IF NOT EXISTS 'usuarionode'@'localhost' IDENTIFIED BY '@CLAVE_NODE@';
CREATE USER IF NOT EXISTS 'usuarionode'@'127.0.0.1' IDENTIFIED BY '@CLAVE_NODE@';
CREATE USER IF NOT EXISTS 'usuariopython'@'localhost' IDENTIFIED BY '@CLAVE_PYTHON@';
CREATE USER IF NOT EXISTS 'usuariopython'@'127.0.0.1' IDENTIFIED BY '@CLAVE_PYTHON@';
-- Sincroniza la clave de cada usuario con la del .env (CREATE USER IF NOT
-- EXISTS no rota claves de usuarios existentes; ALTER USER si). Ejecutar
-- esquema.sql por iniciar.ps1 re-alinea BD y .env cada arranque.
ALTER USER 'usuariophp'@'localhost' IDENTIFIED BY '@CLAVE_PHP@';
ALTER USER 'usuariophp'@'127.0.0.1' IDENTIFIED BY '@CLAVE_PHP@';
ALTER USER 'usuarionode'@'localhost' IDENTIFIED BY '@CLAVE_NODE@';
ALTER USER 'usuarionode'@'127.0.0.1' IDENTIFIED BY '@CLAVE_NODE@';
ALTER USER 'usuariopython'@'localhost' IDENTIFIED BY '@CLAVE_PYTHON@';
ALTER USER 'usuariopython'@'127.0.0.1' IDENTIFIED BY '@CLAVE_PYTHON@';
GRANT SELECT, INSERT, UPDATE ON controlalquiler.clientes TO 'usuariophp'@'localhost', 'usuariophp'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON controlalquiler.usuarios TO 'usuariophp'@'localhost', 'usuariophp'@'127.0.0.1';
GRANT SELECT, INSERT ON controlalquiler.bitacoraacciones TO 'usuariophp'@'localhost', 'usuariophp'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON controlalquiler.captchas TO 'usuariophp'@'localhost', 'usuariophp'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON controlalquiler.alquileres TO 'usuarionode'@'localhost', 'usuarionode'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON controlalquiler.inspecciones TO 'usuarionode'@'localhost', 'usuarionode'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON controlalquiler.solicitudes TO 'usuarionode'@'localhost', 'usuarionode'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON controlalquiler.maquinarias TO 'usuariopython'@'localhost', 'usuariopython'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON controlalquiler.maquinariaspesadas TO 'usuariopython'@'localhost', 'usuariopython'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON controlalquiler.maquinariaslivianas TO 'usuariopython'@'localhost', 'usuariopython'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON controlalquiler.unidades TO 'usuariopython'@'localhost', 'usuariopython'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON controlalquiler.reportesguardados TO 'usuariopython'@'localhost', 'usuariopython'@'127.0.0.1';

-- Notificaciones operativas (rama NOTIFICACIONES, unica dueña: apinode).
-- Se generan al crear contrato, registrar devolucion y al entrar/aprobar/
-- rechazar solicitudes. Las leen los tres roles; marcarlas leidas lo
-- pueden operador y admin (la aplicación es de un equipo pequeno).
CREATE TABLE IF NOT EXISTS notificaciones (
  idnotificacion INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(150) NOT NULL,
  mensaje VARCHAR(400) NOT NULL DEFAULT '',
  rama VARCHAR(30) NOT NULL DEFAULT '',
  nivel ENUM('info','exito','aviso','error') NOT NULL DEFAULT 'info',
  leida TINYINT(1) NOT NULL DEFAULT 0,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_notif_titulo CHECK (CHAR_LENGTH(titulo) BETWEEN 1 AND 150),
  CONSTRAINT ck_notif_mensaje CHECK (CHAR_LENGTH(mensaje) <= 400),
  INDEX ix_notif_leida (leida),
  INDEX ix_notif_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
GRANT SELECT, INSERT, UPDATE, DELETE ON controlalquiler.notificaciones TO 'usuarionode'@'localhost', 'usuarionode'@'127.0.0.1';

-- Endurecimiento de la instancia (idempotente).

-- Root solo local, con la clave que sustituye iniciar.ps1 (@CLAVE_ROOT@).
CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '@CLAVE_ROOT@';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;
ALTER USER 'root'@'localhost' IDENTIFIED BY '@CLAVE_ROOT@';
ALTER USER 'usuariophp'@'localhost' WITH MAX_USER_CONNECTIONS 20;
ALTER USER 'usuariophp'@'127.0.0.1' WITH MAX_USER_CONNECTIONS 20;
ALTER USER 'usuarionode'@'localhost' WITH MAX_USER_CONNECTIONS 20;
ALTER USER 'usuarionode'@'127.0.0.1' WITH MAX_USER_CONNECTIONS 20;
ALTER USER 'usuariopython'@'localhost' WITH MAX_USER_CONNECTIONS 20;
ALTER USER 'usuariopython'@'127.0.0.1' WITH MAX_USER_CONNECTIONS 20;
-- Sin usuarios anónimos, sin root remoto, sin base de pruebas.
DROP USER IF EXISTS ''@'localhost';
DROP USER IF EXISTS ''@'%';
DROP USER IF EXISTS 'root'@'%';
DROP DATABASE IF EXISTS test;
-- Sin carga de archivos externos (LOAD DATA LOCAL INFILE).
SET GLOBAL local_infile = 0;
FLUSH PRIVILEGES;
