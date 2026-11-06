# Endpoints

Todas las peticiones del frontend van a `POST https://127.0.0.1:3000/api` con `Origin: https://localhost:8443` (gateway TLS) y cuerpo `{TOKEN, dat:{RAMA, METODO, DATOS}}`. Respuesta uniforme `{ok, codigo, mensaje, datos}`. Errores comunes: 400 estructura o validacion, 401 sin token o invalido, 403 sin permiso, 404 rama inexistente, 405 metodo no permitido, 409 duplicado o conflicto, 421 Host invalido, 429 rate limit, 502 API caida.

El gateway ademas obliga host igual al propio servicio (cabecera Host) y aplica cuotas por rama: general 100 req/min/IP, login 5 fallos/15 min/IP, fotos 20/15 min/IP, captcha 15/5 min/IP y solicitudes publicas 5/15 min/IP.

## CAPTCHA -> PHP 127.0.0.1:8000 (publica, sin token)

- `RAMA: CAPTCHA, METODO: POST, DATOS: {}`.
- Entrada: vacio. PHP genera `captcha_id` unico, expira 5 min, un solo uso, con cuota de 15 captchas activos por IP (429 al superar).
- Exito 201: `datos={captcha_id, objetivo, opciones:[4]}`.
- Errores: 429 cuota de captcha o de rama.
- Rol: publico.

## USUARIOS -> PHP 127.0.0.1:8000

- `RAMA: USUARIOS, METODO: POST, DATOS: {usuario, clave, captcha_id, captcha_respuesta}` (login, sin token).
- Exito 200: `datos={idusuario, usuario, nombre, rol, debe_cambiar_clave}`; el gateway agrega `token` (JWT HS256, 15 min, solo en memoria del cliente).
- Errores: 400 captcha incorrecto o reutilizado, 401 credenciales invalidas (mensaje unificado para no enumerar cuentas), 403 credenciales invalidas (cuenta inactiva o bloqueada), 429 intentos.
- `RAMA: USUARIOS, METODO: PUT, DATOS: {idusuario, actual, nueva}` (cambiar clave propia, con token).
- Exito 200. Errores 400/401/403/404. Roles: admin, operador, lector (cada quien la suya; PHP exige la clave actual).
- `RAMA: USUARIOS, METODO: PATCH, DATOS: {usuario, nueva}` (restablecer clave, admin-doble-check X-Rol). 200/403/404.

## CUENTAS -> PHP 127.0.0.1:8000 (solo admin)

- `RAMA: CUENTAS, METODO: GET, DATOS: {}` listado de cuentas.
- Exito 200: `[{idusuario, usuario, nombre, rol, activo, intentos_fallidos, bloqueado_hasta, debe_cambiar_clave, fecharegistro}]` (sin hashes).
- `RAMA: CUENTAS, METODO: POST, DATOS: {nombre, usuario, rol: operador|lector, clave}`.
- Exito 201: `datos={idusuario, usuario, rol}`; clave temporal bcrypt 12, `debe_cambiar_clave=1` (la obligatoria en el primer ingreso).
- Errores: 400 formato (usuario `^[a-z0-9_.-]{4,30}$`, clave 12-72), 409 usuario duplicado, 403 fuera de rol admin (double-check X-Rol en PHP).

## CLIENTES -> PHP 127.0.0.1:8000

- `RAMA: CLIENTES, METODO: GET, DATOS: {busqueda, pagina, limite}` con token.
- Exito 200: `datos={total, pagina, limite, clientes:[{idcliente, nombre, documento, telefono, correo, direccion, fecharegistro}]}`.
- Búsqueda con comodines escapados: `q` trata `%`, `_` y `\` como literales (S13).
- `RAMA: CLIENTES, METODO: POST, DATOS: {nombre, documento, telefono?, correo?, direccion?}` (telefono o correo obligatorio).
- Exito 201: `datos={idcliente}`. Errores: 400 formato, 409 documento duplicado.
- Roles: GET admin/operador/lector; POST admin/operador.

## ALQUILERES -> Node 127.0.0.1:3002

- `RAMA: ALQUILERES, METODO: GET, DATOS: {}` con token.
- Exito 200: lista con `diasalquiler, diasretraso, valordias, valorretraso, valormovilizacion, valortotal, estado`.
- `RAMA: ALQUILERES, METODO: POST, DATOS: {idcliente, idunidad, fechalquiler, fechadevolucionprogramada, tarifa_pactada, costo_movilizacion_pactado?, observaciones?, clave_idempotencia}`.
- Exito 201: `datos={idalquiler, diasalquiler, valordias, valormovilizacion, valortotal}`; repetida 200 mismo id. Errores: 400 fechas/tarifa, 409 unidad con activo, 404 no existe.
- Roles: GET admin/operador/lector; POST admin/operador. Node calcula todo y no toca unidades.

## DEVOLUCION -> Node 127.0.0.1:3002

- `RAMA: DEVOLUCION, METODO: PUT, DATOS: {idalquiler, fechadevolucionreal, estadofisico, niveldesgaste, descripciondanos?, valorreparacion?, observaciones?}`.
- Exito 200: `datos={idunidad, diasalquiler, valordias, diasretraso, valorretraso, valorreparacion, valortotal, estadofinal}` y crea inspeccion en la misma transaccion.
- Errores: 400 fecha futura o anterior, 404 contrato inexistente, 409 devolucion ya registrada.
- `RAMA: DEVOLUCION, METODO: GET, DATOS: {idalquiler}` consulta inspeccion.
- Roles: PUT admin/operador; GET admin/operador/lector.

## MAQUINARIAS -> Python 127.0.0.1:3003

- `RAMA: MAQUINARIAS, METODO: GET, DATOS: {}` (publica para catalogo; con token para admin).
- Exito 200: `[{idmaquinaria, nombre, categoria, carpeta, tarifadiaria, activo, peso_toneladas?, costo_movilizacion?, ancho_metros?, apta_zona_urbana?, total_unidades, disponibles}]`.
- `POST {nombre, categoria, tarifadiaria, totalunidades, peso_toneladas?, costo_movilizacion?, ancho_metros?, apta_zona_urbana?, foto_base64?}` 201 `datos={idmaquinaria, carpeta}`; 409 duplicada; 400 categoria/valores/foto (JPG/PNG max 2 MB contenido real).
- `PATCH {idmaquinaria, activo?, tarifadiaria?, unidadesagregar?, costo_movilizacion?}` 200; 409 si desactiva con ocupadas.
- `DELETE {idmaquinaria}` baja logica solo admin; 403 operador/lector; 409 con ocupadas.
- Roles: GET todos (publico lectura); POST/PATCH admin/operador; DELETE admin.

## UNIDADES -> Python 127.0.0.1:3003

- `RAMA: UNIDADES, METODO: POST, DATOS: {idmaquinaria}` (publica para disponibles).
- Exito 200: `[{idunidad, serial, estado}]`.
- `RAMA: UNIDADES, METODO: PUT, DATOS: {idunidad, estado}` con token.
- Exito 200. Reglas: `disponible -> alquilada` permitido (flujo alquiler frontend); otra via a `alquilada` 409; desde `alquilada` 409; resto `disponible|en_inspeccion|en_reparacion` libre.
- Roles: POST todos; PUT admin/operador.

## FOTOS -> Python 127.0.0.1:3003

- `RAMA: FOTOS, METODO: POST, DATOS: {ruta:"carpeta/fotoNN.jpg"}` (publica lectura).
- Exito 200: `datos={contenido_base64, tipo}`. Errores: 400 traversal o tipo, 404 no existe.
- Subida: via `MAQUINARIAS POST foto_base64` (JPG/PNG max 2 MB, magic bytes, nombre generado backend en `apis/apipython/fotos/`).

## REPORTES -> Python 127.0.0.1:3003

- `RAMA: REPORTES, METODO: POST, DATOS: {}` resumen con tablas propias 200 `datos={fecha, total_maquinarias, unidades_totales, disponibles, ...}`; con `{titulo}` guarda y 201 `datos={idreporte}`.
- `RAMA: REPORTES, METODO: GET, DATOS: {}` lista guardados 200.
- `RAMA: REPORTES, METODO: DELETE, DATOS: {idreporte}` solo admin 200; operador/lector 403.
- Python nunca recibe contratos de Node; solo cuenta maquinarias/unidades.

## SOLICITUDES -> Node 127.0.0.1:3002

- RAMA SOLICITUDES POST (publica, sin token, cuota 5/15 min/IP + honeypot en el formulario): crea la solicitud. GET lista (admin/operador). PUT con accion aprobar/rechazar (admin/operador).
- Aprobar crea el alquiler en la misma transaccion de Node (tablas propias).

## USUARIOS PATCH (admin) -> PHP 127.0.0.1:8000
RAMA USUARIOS, METODO PATCH, DATOS {usuario, nueva}: restablece la clave sin pedir la actual. Solo rol admin en gateway y doble chequeo X-Rol en PHP. 200 o 403/404.

## NOTIFICACIONES -> Node 127.0.0.1:3002
- `RAMA: NOTIFICACIONES, METODO: GET, DATOS: {}`: lista las ultimas 100 avisos del equipo, del mas nuevo al mas viejo.
- Exito 200: `datos={no_leidas, notificaciones:[{idnotificacion, titulo, mensaje, rama, nivel, leida, fecha}]}` (nivel `info|exito|aviso|error`).
- `RAMA: NOTIFICACIONES, METODO: PUT, DATOS: {idnotificacion}`: marca una como leida (200; 404 si no existe). `DATOS: {todas: true}`: marca todas (200, `datos.actualizadas`).
- Roles: GET los tres; PUT admin/operador (lector 403).
- Generacion automatica (nodifica, sin llamadas entre APIs): contrato creado (exito), devolucion registrada (exito, o aviso si hubo retraso), nueva solicitud publica (aviso), solicitud aprobada (exito) o rechazada (info). GC automatico al insertar: borra avisos de mas de 60 dias.
- El frontend consulta cada 60 s con ocasion en la campana de la esquina superior derecha; al llegar avisos nuevos dispara toasts.