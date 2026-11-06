# Seguridad

La seguridad de este proyecto es **multicapa y verificable en el código**: cada medida de esta
lista se puede encontrar en los archivos de fuente citados. El principio rector es simple:

> El navegador nunca decide, las APIs de negocio nunca confían, y el único camino
> hacia los datos pasa por el Gateway.

Índice de las 14 defensas (S1–S14), con su ubicación en el código:

| Capa | Medida | Dónde |
|---|---|---|
| S1 | APIs internas solo en loopback + clave interna | `apis/*/` (bind `127.0.0.1`) |
| S2 | Host del Gateway en lista blanca (DNS rebinding) | `api-gateway/server.js` |
| S3 | CORS con orígenes exactos | `api-gateway/src/middleware/seguridad.js` |
| S4 | Verificación de `Origin`/`Referer` por petición | ídem |
| S5 | TLS 1.2+ con certificado local | gateway, frontend-server, `scripts/iniciar.ps1` |
| S6 | Rate limits por IP (4 capas) | `seguridad.js` del gateway |
| S7 | Captcha obligatorio, de un solo uso y con TTL | `apis/apiphp/enrutador.php` |
| S8 | Bloqueo de cuenta y cambio de clave forzado | PHP + tabla `usuarios` |
| S9 | JWT HS256 en memoria (sin `localStorage`) | `autenticacion.js` + `frontend/js/api.js` |
| S10 | RBAC por roles con matriz `RAMA:METODO` | `api-gateway/src/middleware/permisos.js` |
| S11 | Contraseñas con bcrypt | `basededatos/esquema.sql` + `scripts/iniciar.ps1` |
| S12 | Consultas parametrizadas (antifuerza-bruta de SQL) | las 3 APIs |
| S13 | Frontend: integridad SHA-256 + SRI + CSP | `frontend-server/server.js` |
| S14 | Cabeceras endurecidas en todas las respuestas | gateway + frontend-server |

## S1 · Punto de entrada único (loopback + clave interna)

Las tres APIs de negocio arrancan **atadas a `127.0.0.1`**. Aunque otra máquina tenga
conectividad IP hacia el puerto, el sistema operativo no permite abrir esas conexiones. En
cada petición además se exige el encabezado **`x-clave-interna`**, cuya clave vive solo en el
`.env` local del backend y del Gateway (`CLAVE_INTERNA_PHP/NODE/PYTHON`, generada al azar en
el primer arranque). Sin la clave correcta, el backend rechaza la petición. Resultado: ni con
acceso total a la red local se puede hablar con una API concreta sin pasar por el Gateway.

```http
POST http://127.0.0.1:3002/alquileres
x-clave-interna: <clave generada en .env>   ← sin esta cabecera: rechazo
```

El Gateway añade además `X-Rol` y `X-Usuario` (id y rol ya verificados) para que el backend
registre la acción en su bitácora sin volver a autenticar.

## S2 · Host en lista blanca (anti DNS rebinding)

El Gateway solo acepta `Host: localhost:3000`, `127.0.0.1:3000` o `[::1]:3000`. Una página
maliciosa que intente llegar por un dominio atacante con DNS rebinding obtiene `421`.

## S3 · CORS con orígenes exactos

La lista de orígenes válidos vive en `ORIGEN_FRONTEND` del `.env` del Gateway (por defecto
`https://localhost:8443` y `https://127.0.0.1:8443`). Cualquier otro dominio queda con la
respuesta sin credenciales y sin cabeceras de exposición.

## S4 · Verificación de origen por petición

Las cabeceras de CORS solo afectan navegadores y pueden omitirse; por eso el Gateway
**verifica el origen en cada petición**: extrae el origen desde `Origin` o `Referer`, lo
normaliza y compara contra la lista permitida. Sin origen válido, o con uno fuera de lista,
responde `403` **antes** de tocar base de datos o token.

## S5 · TLS de extremo a extremo local

Ambos puntos que hablan con el navegador (frontend-server y Gateway) arrancan en HTTPS con
`minVersion: 'TLSv1.2'`. El certificado (`certificados/local.pfx`) es **auto-generado por
`iniciar.ps1`** (RSA 2048, 1 año, nunca se sube al repo) y se confía en el almacén de Windows
del usuario local. Las APIs internas no están expuestas a la red y usan HTTP local: su
defensa es el aislamiento de S1/S2/S4, no TLS.

## S6 · Rate limiting en 4 capas (por IP, en memoria)

| Límite | Valor | Ámbito |
|---|---|---|
| General | **100 req/min/IP** | todas las peticiones de `/api` |
| Login | **5 fallos/15 min/IP** | solo `USUARIOS:POST` |
| Captcha | **15 req/5 min/IP** | solo `CAPTCHA:POST` |
| Fotos | **20 req/15 min/IP** | solo `FOTOS:POST` |

Todos responden `429` con cabecera `Retry-After` calculada. El contador de login registra
**fallos** (no peticiones) y se limpia con el éxito del login o al terminar la ventana.

## S7 · Captcha obligatorio (API PHP)

- El usuario recibe una pregunta visual: "seleccione la [maquinaria]" con 4 iconos.
- El id del captcha es **`bin2hex(random_bytes(16))`** (32 caracteres hexadecimales
  criptográficos).
- Es de **un solo uso** (`usado=1` al validarse) y expira por TTL (`expira < NOW()`, limpieza
  automática de expirados).
- **Cuota adicional por IP**: la API PHP además cuenta los captchas activos sin usar por IP y
  responde `429` si se inunda la tabla desde un mismo origen.
- La respuesta correcta **nunca viaja al cliente**: el servidor compara su objetivo contra la
  selección enviada y solo al coincidir se confirma el login.

## S8 · Bloqueo de cuenta y cambio de clave forzado

- La tabla `usuarios` cuenta `intentos_fallidos` (con CHECK de no-negatividad) y
  `debe_cambiar_clave`. Tras N fallidos, el acceso queda temporalmente bloqueado.
- Al sembrar el admin inicial, `debe_cambiar_clave` queda en `1`: el primer login fuerza el
  cambio de contraseña (nada de claves demo permanentes).

## S9 · Token JWT en memoria (anti-XSS de persistencia)

- El frontend guarda el JWT en una variable de JavaScript (`TOKEN_MEMORIA`) y **nunca** en
  `localStorage` / `sessionStorage` / cookies. Un XSS que intente robar la sesión no la
  encuentra después de cerrar la pestaña, porque la sesión muere con el documento.
- El token es **HS256** con `issuer`/`audience` exigidos y expiración de **15 minutos**; el
  Gateway usa `algorithms: ['HS256']` (fija el algoritmo y bloquea los ataques de alg:none
  y confusión RS/HS).
- Rutas públicas acotadas (catálogo y autenticación); todo lo demás exige token válido.

## S10 · RBAC con matriz de permisos

| Rol | Alcance |
|---|---|
| `admin` | `*` — todas las ramas y métodos |
| `operador` | 21 acciones con token (operación diaria) |
| `CUENTAS` (crear/listar usuarios) | **solo** admin |

La matriz vive en `permisos.js`; el Gateway aplica el rol ya verificado y cada backend
recibe el rol en una cabecera interna confiable.

## S11 · Contraseñas con bcrypt

El seeding genera la contraseña del admin de forma aleatoria (PowerShell `Nueva-Clave`), la
**hashea con `password_hash` PHP (PASSWORD_BCRYPT)** y guarda directamente el hash en
`usuarios.clave` (VARCHAR 255). La validación usa `password_verify`. La contraseña en texto
plano solo queda guardada en `basededatos/.admin-inicial.env` (local, excluida del repo).

## S12 · Consultas parametrizadas en las 3 APIs

- **PHP** (`mysqli`): consultas con `prepare`/`bind_param` — nunca concatenar SQL.
- **Node** (`mysql2`): placeholders `?` con arrays de valores — nunca construir SQL con el
  usuario.
- **Python** (`mysql-connector`): cursores con `prepared=True`.

Las entradas además pasan saneo de tipo/largo («textoPlano», coerción de enteros) y el
Gateway valida la forma del sobre antes de reenviarla.

## S13 · Frontend con integridad verificable

- **El servidor conoce sus archivos**: arranca leyendo `integridad.json` (huellas SHA-256 de
  los 154 archivos del frontend) y sirve **desde memoria**. Si un archivo cambia en disco
  (edición accidental o alteración intencionada), el cambio se detecta, el archivo **deja de
  servirse** y el incidente queda en `logs/seguridad.log` hasta reiniciar con el manifiesto
  regenerado (`scripts/generar-integridad.ps1`).
- **SRI (Subresource Integrity)**: cada librería de `vendor/` se pide en el HTML con
  `integrity="sha384-…"`; si el archivo servido no corresponde al hash, el navegador lo
  bloquea. Cubre la sustitución del archivo en el camino o en disco.
- **CSP estricta**: `default-src 'none'` y única excepción por tipo de recurso; no se permiten
  manejadores inline (el respaldo de imágenes usa delegación de `addEventListener`, no
  atributos `onerror`).
- HTML sin cachear (`no-store`); el resto se revalida con ETag.

## S14 · Cabeceras endurecidas

En el Gateway (API) y en el frontend-server (web):

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-site
Strict-Transport-Security: max-age=604800; includeSubDomains
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'   (solo API)
Cache-Control: no-store
```

## ¿Qué NO hace este sistema (y por qué)

- **No incluye OAuth/Auth0 ni IAM externo**: la vía fue estudiar y controlar mecanismos de
  autenticación "clásicos" (sesión + captcha + JWT corto + RBAC) mejorados capa por capa.
- **No cifra en reposo ni a nivel de campo**: es una aplicación de demostración local;
  MariaDB/InnoDB corre en el mismo equipo y el secreto mayor vive en archivos locales.
- **No se despliega en la nube**: la mitad de la fortaleza (loopback + lista de hosts +
  TLS autofirmado local) es a propósito para el aula; al exponerlo en internet habría que
  sustituir esas decisiones por las de un despliegue real.

## Nota académica

Este proyecto se desarrolla con propósitos educativos (Universidad Cooperativa de Colombia,
Anexo D). Si decides desplegarlo más allá de tu equipo, revisa la generación de certificados,
los dominios de CORS y la gestión de secretos con estándares de producción.
