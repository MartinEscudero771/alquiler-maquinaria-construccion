# Instalación

## 1. Requisitos

- Windows 10/11 con PowerShell 7 o superior (`pwsh --version`).
- PHP 8 (`php --version`), con extensiones `mysqli` y `mbstring`.
- Node.js 18 o superior (`node --version`) con `npm`.
- Python 3.11 o superior (`python --version`) con `pip`.
- MariaDB mediante XAMPP. La ruta por defecto documentada es `C:\xampp`
  (instalación estándar de XAMPP: `C:\xampp\mysql\bin\my.ini`,
  `mysqld.exe`, `mysql.exe`, `mysqldump.exe`).
- Puertos libres: 3306 (BD), 8000 (PHP), 3002 (Node), 3003 (Python),
  3000 (gateway) y 8443 (frontend estático).

## 2. Variables de entorno

Cada API trae su plantilla. Cópiela sin cambiarle el nombre a la plantilla:

- `apis/apiphp/.env.example` → `apis/apiphp/.env`
- `apis/apinode/.env.example` → `apis/apinode/.env`
- `apis/apipython/.env.example` → `apis/apipython/.env`

Complete `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` y la
`CLAVE_INTERNA_*` correspondiente (una distinta por API). Los `.env` ya
están ignorados por Git; las plantillas `.env.example` sí se versionan.

## 3. Arranque

Ejecute `iniciar.bat` (o `pwsh -File scripts/iniciar.ps1`). El script:

0. Mata los procesos viejos del proyecto (PIDs de `logs/pids.json` y
   barrido por línea de comando con `enrutador.php`, `servidor.js`,
   `servidor:app`, `uvicorn` o la carpeta V2) y libera los puertos 3000,
   3002, 3003 y 8000. Solo detiene `php.exe`, `node.exe` y `python.exe`;
   nunca toca `pwsh`, el proyecto original V1 ni procesos ajenos: si un
   puerto lo ocupa otro programa, se detiene con un mensaje que indica
   el PID en lugar de matar al extraño.
1. Verifica `pwsh`, `php`, `node`, `python` y `mysql.exe`.
2. Inicia MariaDB de XAMPP solo si el puerto 3306 está libre (espera 30 s).
3. Aplica `basededatos/esquema.sql` solo si la base o los usuarios faltan
   (el esquema es idempotente: `IF NOT EXISTS`, `INSERT IGNORE`).
4. Ejecuta `npm install` en `api-gateway` y `apis/apinode` solo si falta
   `node_modules`, y `pip install -r requirements.txt` solo si falta `fastapi`.
5. Inicia PHP (`8000`), Node (`3002`), Python (`3003`) y gateway (`3000`)
   ocultos, guarda PIDs en `logs/pids.json` y registros en `logs/`.
6. Comprueba cada `/salud` durante 60 segundos.
7. Sirve `frontend/` en `127.0.0.1:8443`, guarda su PID y abre
   `http://localhost:8443` en Firefox (si está instalado; si no, en el
   navegador por defecto).

El frontend ya no se abre como archivo suelto: se sirve por HTTP para que
el origen sea `http://localhost:8443`, que es el `ORIGEN_FRONTEND`
autorizado por la gateway.

## 4. Verificación

Ejecute `pwsh -File scripts/verificar.ps1` para el reporte pasa/falla
(sintaxis PHP/Node/Python, `npm audit`, plantillas `.env`, estructura,
puertos, `/salud` y ausencia de `0.0.0.0`, `localStorage`,
`.sesiones.json` y secretos escritos).

## 5. Detener y respaldar

- `detener.bat`: detiene solo los PIDs de `logs/pids.json` más un barrido
  por línea de comando del proyecto; detiene MariaDB solo si la inició.
- `respaldar.bat`: genera `respaldos/controlalquiler_aaaa-MM-dd_HHmm.sql`
  con `mysqldump --single-transaction --routines --events --triggers
  --hex-blob`, tomando la clave de `DB_PASS` del entorno o del `.env`.
  Conserva los últimos 7 y nunca se sube a Git.
- `scripts/generar-integridad.ps1`: regenera `integridad.json` (SHA-256
  por archivo del frontend) tras cambiar archivos legítimos del
  frontend. Si no existe, `iniciar.ps1` la genera la primera vez.

## 5b. Instancia MariaDB compartida con otros proyectos

Si en la misma instancia de MariaDB conviven otras bases (p. ej. otro
sistema académico o comercial con sus usuarios `@'localhost'`), el
proyecto entra en **modo compartido** automáticamente: `iniciar.ps1`
detecta que root funciona con una clave distinta de la de
`basededatos/.root.env` y entonces **no rota la clave de root** (queda
la vigente de la instancia, p. ej. la de XAMPP) y **retira del esquema
los `SET GLOBAL`** (`event_scheduler`, `local_infile`) para no alterar
el comportamiento del resto de bases. Las claves de los tres usuarios
de esta aplicación (`usuariophp`, `usuarionode`, `usuariopython`) sí se
gestionan siempre desde su `.env` y se resincronizan con la BD en cada
arranque, porque son exclusivas de este sistema y no afectan a otros.
Si la instancia es exclusiva del proyecto, se aplica el endurecimiento
completo (root solo local con clave aleatoria en `.root.env`, sin
usuarios anónimos, `local_infile=0`).


## 6. Solución de problemas

| Síntoma | Causa probable | Acción |
|---------|----------------|--------|
| ` exit 1` por herramienta faltante | No está en el PATH | Instale y reabra la terminal |
| MariaDB no acepta conexiones | Otro MySQL en 3306 | Detenga el otro servicio o use el existente |
| `/salud` no responde | Puerto ocupado por otro programa | `iniciar.bat` libera solo lo del proyecto; si el ocupante es ajeno, deténgalo y revise `logs/*.error.log` |
| `iniciar.bat` dice puerto ocupado | Quedó un proceso viejo o corre el proyecto V1 | El script mata solo procesos viejos del V2; si es el V1 u otro programa, indica el PID y se detiene sin tocarlo |
| `npm install` falla | Sin red o Node < 18 | Verifique red y versión |
| `pip install` falla | Sin `fastapi` y sin red | Instale con red una vez |
| Respaldo vacío | Clave `DB_PASS` incorrecta | Defina `DB_PASS` en entorno o `.env` |
| Frontend no abre | No hay servidor en 8443 | Sirva `frontend/` en el puerto 8443 |
