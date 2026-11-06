# Pruebas (23) paso a paso

Base: `POST https://127.0.0.1:3000/api` con `Origin: https://localhost:8443` y cuerpo `{TOKEN, dat:{RAMA, METODO, DATOS}}`. Todas las respuestas son `{ok, codigo, mensaje, datos}`. Verificado el 2026-10-28 con `scripts/verificar.ps1` (44/44) mas pruebas manuales abajo. Claves: la del admin inicial se genera en el primer arranque y queda en `basededatos/.admin-inicial.env` (exige cambio al primer ingreso); lector y operador se crean desde el panel con el módulo Usuarios (rama CUENTAS, solo admin).

**Automatizado:** `scripts/pruebas.ps1` ejecuta la suite contra el gateway (requiere entorno iniciado). Publicas siempre; autenticadas con `-Clave` o leyendo `basededatos/.admin-inicial.env`. Cierra con un resumen pasa/falla/saltadas y exit 1 si algo falla.

**Limpieza despues de una corrida de pruebas** (borra los datos que la suite deja y deja el proyecto como estaba; usa root de la instancia compartida si aplica):

```sql
DELETE i FROM inspecciones i JOIN alquileres a ON a.idalquiler=i.idalquiler WHERE a.clave_idempotencia LIKE 'prueba-' AND a.idalquiler>1;
DELETE FROM solicitudes WHERE nombre LIKE 'Solicitud de prueba %';
DELETE FROM alquileres WHERE clave_idempotencia LIKE 'prueba-' AND idalquiler>1;
DELETE FROM clientes WHERE nombre LIKE 'Prueba %' OR documento LIKE 't%';
DELETE FROM usuarios WHERE usuario LIKE 'prueba%';
DELETE FROM notificaciones;
```

## 1. Login correcto

- Pasos: `CAPTCHA POST {}` guarda `captcha_id` y `objetivo`; luego `USUARIOS POST {usuario:"admin", clave:"<clave inicial del .env>", captcha_id, captcha_respuesta:objetivo}` con `TOKEN:""`.
- Esperado: 200 `datos={idusuario, usuario, nombre, rol, token}` JWT 15 min. Verificado: `rol=admin`, token 321 caracteres.
## 2. Login incorrecto

- Pasos: captcha nuevo + `USUARIOS POST` con clave mala.
- Esperado: 401 credenciales invalidas, sin token. Verificado.

## 3. Bloqueo por intentos fallidos

- Pasos: 5 logins malos seguidos desde la misma IP.
- Esperado: 429 demasiados intentos (rate login 5/15 min) y cuenta bloqueada 15 min tras 5 fallos en PHP. Verificado: intentos 1-4 401, 5-6 429.

## 4. Token invalido

- Pasos: `CLIENTES GET` con `TOKEN:"invalido"`.
- Esperado: 401 token invalido o expirado. Verificado.

## 5. Token expirado

- Pasos: usar un JWT con `exp` pasado (o esperar 15 min).
- Esperado: 401 token invalido o expirado. La gateway valida `iss`, `aud` y `exp`.

## 6. Acceso sin token

- Pasos: `CLIENTES GET` con `TOKEN:""`.
- Esperado: 401 token requerido. Verificado. Excepcion: lectura publica (`CAPTCHA POST`, `MAQUINARIAS GET`, `FOTOS POST`, `UNIDADES POST`, `REPORTES GET`) permite `TOKEN:""` para la vitrina.

## 7. Rama invalida

- Pasos: `RAMA:"INVENTADA", METODO:"GET"`.
- Esperado: 404 rama no encontrada. Verificado.

## 8. Metodo no permitido

- Pasos: `RAMA:"CLIENTES", METODO:"DELETE"`.
- Esperado: 405 metodo no permitido. Verificado.

## 9. Rol sin permiso

- Pasos: login como lector; `CLIENTES POST` con su token.
- Esperado: 403 permiso denegado. Verificado. Operador `MAQUINARIAS DELETE` y `REPORTES DELETE` tambien 403.

## 10. Crear cliente

- Pasos: admin `CLIENTES POST {nombre, documento:"900123456", telefono, correo, direccion}`.
- Esperado: 201 `datos={idcliente:1}`. Verificado.

## 11. Cliente duplicado

- Pasos: repetir el mismo `documento`.
- Esperado: 409 documento ya registrado. Verificado.

## 12. Crear maquinaria pesada

- Pasos: admin `MAQUINARIAS POST {nombre:"Bulldozer D8", categoria:"pesada", tarifadiaria:1800000, totalunidades:1, peso_toneladas:22.5, costo_movilizacion:900000}`.
- Esperado: 201 `datos={idmaquinaria:4, carpeta:"bulldozerd8"}`. Verificado.

## 13. Crear maquinaria liviana

- Pasos: admin `MAQUINARIAS POST {nombre:"Compactador X1", categoria:"liviana", tarifadiaria:430000, totalunidades:2, ancho_metros:1.5, apta_zona_urbana:1}`.
- Esperado: 201 `datos={idmaquinaria:5}`. Verificado.

## 14. Foto invalida

- Pasos: `FOTOS POST {ruta:"../xampp/mysql/data"}` o extension no jpg/png.
- Esperado: 400 ruta de foto invalida. Verificado. Valida: `FOTOS POST {ruta:"excavadora/foto01.jpg"}` devuelve 200 con base64.

## 15. Crear alquiler

- Pasos: admin `ALQUILERES POST {idcliente:1, idunidad:1, fechalquiler:"2026-10-28", fechadevolucionprogramada:"2026-11-05", tarifa_pactada:1450000, costo_movilizacion_pactado:800000, clave_idempotencia:uuid}`.
- Esperado: 201 `datos={idalquiler:1, diasalquiler:9, valordias:13050000, valortotal:13850000}`. Node calcula todo. Verificado.

## 16. Doble clic en crear alquiler genera un solo contrato

- Pasos: dos clics rapidos con distinta `clave_idempotencia` sobre la misma unidad ocupada; el boton se deshabilita con `ejecutarAccion`.
- Esperado: primera 201, segunda 409 unidad ya tiene alquiler activo. Un clic = una accion. Verificado.

## 17. Idempotencia con la misma clave

- Pasos: repetir el `ALQUILERES POST` con la misma `clave_idempotencia`.
- Esperado: 200 `datos={idalquiler:1,...}` identico, sin crear otro. Verificado.

## 18. Devolucion duplicada devuelve 409

- Pasos: `DEVOLUCION PUT {idalquiler:1, fechadevolucionreal:"2026-10-28", estadofisico:"regular", niveldesgaste:"medio", valorreparacion:0}` dos veces.
- Esperado: primera 200 `datos={diasalquiler:1, valortotal:2250000, estadofinal:"en_reparacion"}`; segunda 409 devolucion ya registrada. Verificado.

## 19. Cambio de estado de unidad

- Pasos: `UNIDADES POST {idmaquinaria:1}` lista; `UNIDADES PUT {idunidad:1, estado:"en_reparacion"}` 200; `PUT {estado:"alquilada"}` desde disponible 200 (flujo alquiler), desde otro estado 409; desde `alquilada` 409.
- Esperado: 200/400/409 segun regla. Verificado.

## 20. Reporte guardado y borrado solo por admin

- Pasos: admin `REPORTES POST {titulo:"Borrable"}` 201 `idreporte`; admin `REPORTES DELETE {idreporte}` 200; operador `REPORTES DELETE` 403.
- Esperado: lector `REPORTES GET` 200, operador borrar 403, admin borrar 200. Verificado.

## 21. Cierre de sesion invalida el acceso posterior

- Pasos: el frontend borra `TOKEN_MEMORIA` al pulsar Cierre de sesion (sin `localStorage`); reintentar `CLIENTES GET` con `TOKEN:""`.
- Esperado: 401 token requerido y pantalla de login. JWT stateless de 15 min sin refresh; no hay lista negra porque la ventana es corta y el token vive solo en memoria.

## 22. Lector recibe 403 en acciones de escritura

- Pasos: login lector; `ALQUILERES POST`, `DEVOLUCION PUT`, `MAQUINARIAS POST`, `REPORTES POST` con su token.
- Esperado: 403 en todas; `MAQUINARIAS GET`, `FOTOS POST`, `REPORTES GET`, `CLIENTES GET`, `ALQUILERES GET` 200. Verificado.

## 23. Gestion de cuentas (CUENTAS, solo admin)

- Pasos: login admin; `CUENTAS GET` lista; `CUENTAS POST {nombre, usuario, rol:"lector", clave}` con usuario nuevo y repite el mismo usuario.
- Esperado: lista 200; crear 201 con `debe_cambiar_clave=1` (clave temporal bcrypt 12); repetir 409 usuario duplicado; con lector u operador, `CUENTAS GET/POST` 403. El usuario creado ingresa con la clave temporal y el sistema exige cambiarla. Verificado por `scripts/pruebas.ps1`.
