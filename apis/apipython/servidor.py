"""API Python (FastAPI): maquinarias, unidades, fotos y reportes.

Arranque: uvicorn --host 127.0.0.1 --port 3003 servidor:app
Solo acepta peticiones del equipo local (127.0.0.1/::1) con la
clave interna del gateway (header x-clave-interna), excepto /salud.
"""

import base64
import hmac
import json
import os
import re
import unicodedata
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from mysql.connector import Error as MySQLError
from starlette.exceptions import HTTPException as StarletteHTTPException

from conexion import get_connection

load_dotenv()

CLAVE_INTERNA = os.getenv("CLAVE_INTERNA_PYTHON", "")

LIMITE_CUERPO = 3 * 1024 * 1024
LIMITE_FOTO = 2 * 1024 * 1024
MAX_TARIFA = 100000000
MAX_MOVILIZACION = 100000000
MAX_UNIDADES_TOTAL = 200

BASE_FOTOS = Path(__file__).resolve().parent / "fotos"
BASE_FOTOS.mkdir(parents=True, exist_ok=True)

IPS_LOCALES = ("127.0.0.1", "::1")
HOSTS_LOCALES = ("localhost:3003", "127.0.0.1:3003", "[::1]:3003")
ESTADOS_MANUALES = ("disponible", "en_inspeccion", "en_reparacion")
ESTADOS_OCUPADAS = ("alquilada", "en_inspeccion")
RE_RUTA_FOTO = re.compile(r"^[a-z0-9]+/[A-Za-z0-9_\-.]+\.(jpg|png)$")

# S9a: sin /docs ni /openapi.json. La superficie de documentacion no
# aporta a un servicio interno y solo ampliaria el ataque.
app = FastAPI(
    title="API Python - Maquinarias",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


def _respuesta(ok, codigo, mensaje, datos=None):
    """Respuesta uniforme {ok, codigo, mensaje, datos}."""
    return JSONResponse(
        status_code=codigo,
        content={"ok": ok, "codigo": codigo, "mensaje": mensaje, "datos": datos},
    )


@app.middleware("http")
async def middleware_acceso(request: Request, call_next):
    """Host local + IP local + clave interna + limite de cuerpo (solo /salud libre)."""
    ruta = request.url.path
    if ruta == "/salud":
        return await call_next(request)
    host = request.headers.get("host", "").lower()
    if host not in HOSTS_LOCALES:
        return _respuesta(False, 421, "Host invalido", None)
    largo = request.headers.get("content-length")
    if largo:
        try:
            if int(largo) > LIMITE_CUERPO:
                return _respuesta(False, 413, "Cuerpo demasiado grande", None)
        except ValueError:
            pass
    cliente = request.client.host if request.client else ""
    if cliente not in IPS_LOCALES:
        return _respuesta(False, 403, "Acceso denegado", None)
    clave = request.headers.get("x-clave-interna", "")
    if not CLAVE_INTERNA or not hmac.compare_digest(clave, CLAVE_INTERNA):
        return _respuesta(False, 403, "Clave interna invalida", None)
    return await call_next(request)


@app.middleware("http")
async def middleware_seguridad(request: Request, call_next):
    """Cabeceras de seguridad en todas las respuestas."""
    respuesta = await call_next(request)
    respuesta.headers["X-Content-Type-Options"] = "nosniff"
    respuesta.headers["X-Frame-Options"] = "DENY"
    respuesta.headers["Referrer-Policy"] = "no-referrer"
    return respuesta


@app.exception_handler(StarletteHTTPException)
async def _manejador_http(request: Request, exc: StarletteHTTPException):
    mensaje = exc.detail if isinstance(exc.detail, str) else "Error"
    return _respuesta(False, exc.status_code, mensaje, None)


@app.exception_handler(RequestValidationError)
async def _manejador_validacion(request: Request, exc: RequestValidationError):
    return _respuesta(False, 422, "Solicitud invalida", None)


@app.exception_handler(Exception)
async def _manejador_general(request: Request, exc: Exception):
    return _respuesta(False, 500, "Error interno del servidor", None)


@contextmanager
def _conexion():
    """Conexion del pool por peticion, cerrada con try/finally."""
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


async def _leer_cuerpo(request: Request):
    """Devuelve dict del JSON, {} si no hay cuerpo, None si es invalido."""
    crudo = await request.body()
    if not crudo.strip():
        return {}
    try:
        datos = json.loads(crudo.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    return datos if isinstance(datos, dict) else None


def _convertir(valor):
    if isinstance(valor, Decimal):
        return float(valor)
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    return valor


def _normalizar_fila(fila):
    return {clave: _convertir(valor) for clave, valor in fila.items()}


def _es_entero(valor):
    return isinstance(valor, int) and not isinstance(valor, bool)


def _es_numero(valor):
    return isinstance(valor, (int, float)) and not isinstance(valor, bool)


def generar_slug(nombre):
    """Minusculas, sin tildes, solo [a-z0-9]."""
    descompuesto = unicodedata.normalize("NFKD", nombre)
    sin_tildes = "".join(
        letra for letra in descompuesto if not unicodedata.combining(letra)
    )
    return re.sub(r"[^a-z0-9]+", "", sin_tildes.lower())[:40]


def _detectar_foto(binarios):
    """Valida magic bytes: JPG (FFD8FF...FFD9) o PNG (...IEND)."""
    if binarios.startswith(b"\xff\xd8\xff") and binarios.rstrip().endswith(b"\xff\xd9"):
        return "jpg"
    if binarios.startswith(b"\x89PNG\r\n\x1a\n") and b"IEND" in binarios[-16:]:
        return "png"
    return ""


def _decodificar_foto(foto_base64):
    """Valida base64 JPG/PNG de maximo 2MB. Devuelve (bytes, extension)."""
    if not isinstance(foto_base64, str):
        return None, ""
    texto = "".join(foto_base64.split())
    if texto.startswith("data:") and "," in texto:
        texto = texto.split(",", 1)[1]
    try:
        binarios = base64.b64decode(texto, validate=True)
    except ValueError:
        return None, ""
    if len(binarios) == 0 or len(binarios) > LIMITE_FOTO:
        return None, ""
    tipo = _detectar_foto(binarios)
    if not tipo:
        return None, ""
    return binarios, tipo


def _requiere_admin(request: Request):
    return request.headers.get("x-rol", "") == "admin"


@app.get("/salud")
async def salud():
    return {
        "ok": True,
        "codigo": 200,
        "mensaje": "Servicio Python operativo",
        "datos": {"servicio": "apipython", "estado": "activo"},
    }


@app.get("/maquinarias")
async def listar_maquinarias():
    try:
        with _conexion() as conn:
            cur = conn.cursor(dictionary=True, prepared=True)
            try:
                cur.execute(
                    "SELECT m.idmaquinaria, m.nombre, m.categoria, m.carpeta, "
                    "m.tarifadiaria, m.activo, "
                    "(SELECT p.peso_toneladas FROM maquinariaspesadas p "
                    "WHERE p.idmaquinaria = m.idmaquinaria) AS peso_toneladas, "
                    "(SELECT p.costo_movilizacion FROM maquinariaspesadas p "
                    "WHERE p.idmaquinaria = m.idmaquinaria) AS costo_movilizacion, "
                    "(SELECT l.ancho_metros FROM maquinariaslivianas l "
                    "WHERE l.idmaquinaria = m.idmaquinaria) AS ancho_metros, "
                    "(SELECT l.apta_zona_urbana FROM maquinariaslivianas l "
                    "WHERE l.idmaquinaria = m.idmaquinaria) AS apta_zona_urbana, "
                    "(SELECT COUNT(*) FROM unidades u "
                    "WHERE u.idmaquinaria = m.idmaquinaria) AS total_unidades, "
                    "(SELECT COUNT(*) FROM unidades u "
                    "WHERE u.idmaquinaria = m.idmaquinaria "
                    "AND u.estado = %s) AS unidades_disponibles "
                    "FROM maquinarias m ORDER BY m.idmaquinaria ASC",
                    ("disponible",),
                )
                filas = [_normalizar_fila(fila) for fila in cur.fetchall()]
            finally:
                cur.close()
    except MySQLError:
        return _respuesta(False, 500, "Error de base de datos", None)
    return _respuesta(True, 200, "Maquinarias", filas)


@app.post("/maquinarias", status_code=201)
async def crear_maquinaria(request: Request):
    datos = await _leer_cuerpo(request)
    if not isinstance(datos, dict):
        return _respuesta(False, 400, "Cuerpo JSON invalido", None)

    nombre = datos.get("nombre", "")
    if not isinstance(nombre, str):
        return _respuesta(False, 400, "Nombre invalido (3-100 caracteres)", None)
    nombre = nombre.strip()
    if len(nombre) < 3 or len(nombre) > 100:
        return _respuesta(False, 400, "Nombre invalido (3-100 caracteres)", None)

    categoria = datos.get("categoria", "")
    if categoria not in ("pesada", "liviana"):
        return _respuesta(False, 400, "Categoria invalida (pesada|liviana)", None)

    tarifa = datos.get("tarifadiaria")
    if not _es_numero(tarifa) or not 1 <= float(tarifa) <= MAX_TARIFA:
        return _respuesta(False, 400, "Tarifa diaria invalida (1-100000000)", None)
    tarifa = float(tarifa)

    total = datos.get("totalunidades")
    if not _es_entero(total) or not 1 <= total <= MAX_UNIDADES_TOTAL:
        return _respuesta(False, 400, "Total de unidades invalido (1-200)", None)

    peso = costo = ancho = apta = None
    if categoria == "pesada":
        peso = datos.get("peso_toneladas")
        if not _es_numero(peso) or float(peso) <= 0:
            return _respuesta(False, 400, "Peso en toneladas invalido (>0)", None)
        costo = datos.get("costo_movilizacion")
        if not _es_numero(costo) or not 0 <= float(costo) <= MAX_MOVILIZACION:
            return _respuesta(
                False, 400, "Costo de movilizacion invalido (0-100000000)", None
            )
        peso = float(peso)
        costo = float(costo)
    else:
        ancho = datos.get("ancho_metros")
        if not _es_numero(ancho) or float(ancho) <= 0:
            return _respuesta(False, 400, "Ancho en metros invalido (>0)", None)
        apta = datos.get("apta_zona_urbana")
        if not _es_entero(apta) or apta not in (0, 1):
            return _respuesta(False, 400, "apta_zona_urbana invalido (0|1)", None)
        ancho = float(ancho)

    binarios = None
    tipo_foto = ""
    if datos.get("foto_base64") is not None:
        binarios, tipo_foto = _decodificar_foto(datos.get("foto_base64"))
        if binarios is None:
            return _respuesta(False, 400, "Foto invalida (JPG/PNG maximo 2MB)", None)

    carpeta = generar_slug(nombre)
    if not carpeta:
        return _respuesta(
            False, 400, "No se pudo generar la carpeta desde el nombre", None
        )

    seriales = [f"{carpeta}-{indice:02d}" for indice in range(1, total + 1)]

    foto_guardada = None
    if binarios is not None:
        destino_dir = BASE_FOTOS / carpeta
        destino_dir.mkdir(parents=True, exist_ok=True)
        foto_guardada = destino_dir / ("foto01." + tipo_foto)
        foto_guardada.write_bytes(binarios)

    resultado = None
    idmaquinaria = None
    try:
        with _conexion() as conn:
            cur = conn.cursor(dictionary=True, prepared=True)
            try:
                conn.start_transaction()
                cur.execute(
                    "SELECT idmaquinaria FROM maquinarias WHERE nombre = %s",
                    (nombre,),
                )
                if cur.fetchone():
                    conn.rollback()
                    resultado = _respuesta(
                        False, 409, "Nombre de maquinaria duplicado", None
                    )
                else:
                    cur.execute(
                        "SELECT idmaquinaria FROM maquinarias WHERE carpeta = %s",
                        (carpeta,),
                    )
                    if cur.fetchone():
                        conn.rollback()
                        resultado = _respuesta(
                            False, 409, "Carpeta de maquinaria duplicada", None
                        )
                    else:
                        cur.execute(
                            "INSERT INTO maquinarias "
                            "(nombre, categoria, carpeta, tarifadiaria, activo) "
                            "VALUES (%s, %s, %s, %s, 1)",
                            (nombre, categoria, carpeta, tarifa),
                        )
                        idmaquinaria = cur.lastrowid
                        if categoria == "pesada":
                            cur.execute(
                                "INSERT INTO maquinariaspesadas "
                                "(idmaquinaria, peso_toneladas, costo_movilizacion) "
                                "VALUES (%s, %s, %s)",
                                (idmaquinaria, peso, costo),
                            )
                        else:
                            cur.execute(
                                "INSERT INTO maquinariaslivianas "
                                "(idmaquinaria, ancho_metros, apta_zona_urbana) "
                                "VALUES (%s, %s, %s)",
                                (idmaquinaria, ancho, apta),
                            )
                        for serial in seriales:
                            cur.execute(
                                "INSERT INTO unidades "
                                "(idmaquinaria, serial, estado) "
                                "VALUES (%s, %s, 'disponible')",
                                (idmaquinaria, serial),
                            )
                        conn.commit()
            except MySQLError as exc:
                try:
                    conn.rollback()
                except MySQLError:
                    pass
                if getattr(exc, "errno", None) == 1062:
                    resultado = _respuesta(False, 409, "Registro duplicado", None)
                else:
                    resultado = _respuesta(
                        False, 500, "Error de base de datos", None
                    )
            finally:
                cur.close()
    except MySQLError:
        resultado = _respuesta(False, 500, "Error de base de datos", None)

    if resultado is not None:
        if foto_guardada is not None:
            try:
                foto_guardada.unlink(missing_ok=True)
            except OSError:
                pass
        return resultado

    return _respuesta(
        True,
        201,
        "Maquinaria creada",
        {
            "idmaquinaria": idmaquinaria,
            "nombre": nombre,
            "categoria": categoria,
            "carpeta": carpeta,
            "totalunidades": total,
        },
    )


@app.patch("/maquinarias/{idmaquinaria}")
async def actualizar_maquinaria(idmaquinaria: int, request: Request):
    datos = await _leer_cuerpo(request)
    if not isinstance(datos, dict):
        return _respuesta(False, 400, "Cuerpo JSON invalido", None)
    permitidas = {"activo", "tarifadiaria", "unidadesagregar", "costo_movilizacion"}
    cambios = {clave: datos[clave] for clave in permitidas if clave in datos}
    if not cambios:
        return _respuesta(False, 400, "Sin cambios validos", None)
    if "activo" in cambios and (
        not _es_entero(cambios["activo"]) or cambios["activo"] not in (0, 1)
    ):
        return _respuesta(False, 400, "activo invalido (0|1)", None)
    if "tarifadiaria" in cambios and (
        not _es_numero(cambios["tarifadiaria"])
        or not 1 <= float(cambios["tarifadiaria"]) <= MAX_TARIFA
    ):
        return _respuesta(False, 400, "Tarifa diaria invalida (1-100000000)", None)
    if "unidadesagregar" in cambios and (
        not _es_entero(cambios["unidadesagregar"])
        or not 0 <= cambios["unidadesagregar"] <= MAX_UNIDADES_TOTAL
    ):
        return _respuesta(False, 400, "unidadesagregar invalido (0-200)", None)
    if "costo_movilizacion" in cambios and (
        not _es_numero(cambios["costo_movilizacion"])
        or not 0 <= float(cambios["costo_movilizacion"]) <= MAX_MOVILIZACION
    ):
        return _respuesta(
            False, 400, "Costo de movilizacion invalido (0-100000000)", None
        )

    try:
        with _conexion() as conn:
            cur = conn.cursor(dictionary=True, prepared=True)
            try:
                cur.execute(
                    "SELECT idmaquinaria, categoria, carpeta, tarifadiaria, activo "
                    "FROM maquinarias WHERE idmaquinaria = %s",
                    (idmaquinaria,),
                )
                maquina = cur.fetchone()
                if maquina is None:
                    return _respuesta(False, 404, "Maquinaria no encontrada", None)
                if cambios.get("activo") == 0 and maquina["activo"] == 1:
                    cur.execute(
                        "SELECT estado FROM unidades WHERE idmaquinaria = %s",
                        (idmaquinaria,),
                    )
                    estados = [fila["estado"] for fila in cur.fetchall()]
                    if any(estado in ESTADOS_OCUPADAS for estado in estados):
                        return _respuesta(
                            False,
                            409,
                            "No se puede desactivar: tiene unidades "
                            "alquiladas o en inspeccion",
                            None,
                        )
                if (
                    "costo_movilizacion" in cambios
                    and maquina["categoria"] != "pesada"
                ):
                    return _respuesta(
                        False,
                        400,
                        "costo_movilizacion solo aplica a maquinaria pesada",
                        None,
                    )
                total_base = None
                nuevos_seriales = []
                if cambios.get("unidadesagregar"):
                    cur.execute(
                        "SELECT COUNT(*) AS total FROM unidades "
                        "WHERE idmaquinaria = %s",
                        (idmaquinaria,),
                    )
                    total_base = cur.fetchone()["total"]
                    if total_base + cambios["unidadesagregar"] > MAX_UNIDADES_TOTAL:
                        return _respuesta(
                            False, 400, "El total de unidades no puede superar 200", None
                        )
                    nuevos_seriales = [
                        f"{maquina['carpeta']}-{indice:02d}"
                        for indice in range(
                            total_base + 1,
                            total_base + cambios["unidadesagregar"] + 1,
                        )
                    ]
                try:
                    if "activo" in cambios:
                        cur.execute(
                            "UPDATE maquinarias SET activo = %s "
                            "WHERE idmaquinaria = %s",
                            (cambios["activo"], idmaquinaria),
                        )
                    if "tarifadiaria" in cambios:
                        cur.execute(
                            "UPDATE maquinarias SET tarifadiaria = %s "
                            "WHERE idmaquinaria = %s",
                            (float(cambios["tarifadiaria"]), idmaquinaria),
                        )
                    if "costo_movilizacion" in cambios:
                        cur.execute(
                            "UPDATE maquinariaspesadas SET costo_movilizacion = %s "
                            "WHERE idmaquinaria = %s",
                            (float(cambios["costo_movilizacion"]), idmaquinaria),
                        )
                    for serial in nuevos_seriales:
                        cur.execute(
                            "INSERT INTO unidades "
                            "(idmaquinaria, serial, estado) "
                            "VALUES (%s, %s, 'disponible')",
                            (idmaquinaria, serial),
                        )
                    conn.commit()
                except MySQLError as exc:
                    try:
                        conn.rollback()
                    except MySQLError:
                        pass
                    if getattr(exc, "errno", None) == 1062:
                        return _respuesta(
                            False, 409, "Serial de unidad duplicado", None
                        )
                    raise
                if nuevos_seriales:
                    total_final = total_base + len(nuevos_seriales)
                else:
                    cur.execute(
                        "SELECT COUNT(*) AS total FROM unidades "
                        "WHERE idmaquinaria = %s",
                        (idmaquinaria,),
                    )
                    total_final = cur.fetchone()["total"]
                if "activo" in cambios:
                    activo_final = cambios["activo"]
                else:
                    activo_final = maquina["activo"]
                if "tarifadiaria" in cambios:
                    tarifa_final = float(cambios["tarifadiaria"])
                else:
                    tarifa_final = float(maquina["tarifadiaria"])
            finally:
                cur.close()
    except MySQLError:
        return _respuesta(False, 500, "Error de base de datos", None)

    return _respuesta(
        True,
        200,
        "Maquinaria actualizada",
        {
            "idmaquinaria": idmaquinaria,
            "activo": activo_final,
            "tarifadiaria": tarifa_final,
            "total_unidades": total_final,
        },
    )


@app.delete("/maquinarias/{idmaquinaria}")
async def eliminar_maquinaria(idmaquinaria: int, request: Request):
    if not _requiere_admin(request):
        return _respuesta(False, 403, "Se requiere rol admin", None)
    try:
        with _conexion() as conn:
            cur = conn.cursor(dictionary=True, prepared=True)
            try:
                cur.execute(
                    "SELECT idmaquinaria FROM maquinarias WHERE idmaquinaria = %s",
                    (idmaquinaria,),
                )
                if cur.fetchone() is None:
                    return _respuesta(False, 404, "Maquinaria no encontrada", None)
                cur.execute(
                    "SELECT estado FROM unidades WHERE idmaquinaria = %s",
                    (idmaquinaria,),
                )
                estados = [fila["estado"] for fila in cur.fetchall()]
                if any(estado in ESTADOS_OCUPADAS for estado in estados):
                    return _respuesta(
                        False,
                        409,
                        "No se puede eliminar: tiene unidades "
                        "alquiladas o en inspeccion",
                        None,
                    )
                cur.execute(
                    "UPDATE maquinarias SET activo = %s WHERE idmaquinaria = %s",
                    (0, idmaquinaria),
                )
                conn.commit()
            finally:
                cur.close()
    except MySQLError:
        return _respuesta(False, 500, "Error de base de datos", None)
    return _respuesta(
        True, 200, "Maquinaria desactivada", {"idmaquinaria": idmaquinaria}
    )


@app.post("/unidades/pormaquina")
async def unidades_por_maquina(request: Request):
    datos = await _leer_cuerpo(request)
    if not isinstance(datos, dict):
        return _respuesta(False, 400, "Cuerpo JSON invalido", None)
    idmaquinaria = datos.get("idmaquinaria")
    if not _es_entero(idmaquinaria) or idmaquinaria <= 0:
        return _respuesta(False, 400, "idmaquinaria invalido", None)
    try:
        with _conexion() as conn:
            cur = conn.cursor(dictionary=True, prepared=True)
            try:
                cur.execute(
                    "SELECT idmaquinaria FROM maquinarias WHERE idmaquinaria = %s",
                    (idmaquinaria,),
                )
                if cur.fetchone() is None:
                    return _respuesta(False, 404, "Maquinaria no encontrada", None)
                cur.execute(
                    "SELECT idunidad, serial, estado FROM unidades "
                    "WHERE idmaquinaria = %s ORDER BY idunidad ASC",
                    (idmaquinaria,),
                )
                filas = [_normalizar_fila(fila) for fila in cur.fetchall()]
            finally:
                cur.close()
    except MySQLError:
        return _respuesta(False, 500, "Error de base de datos", None)
    return _respuesta(True, 200, "Unidades", filas)


@app.put("/unidades/{idunidad}/estado")
async def cambiar_estado_unidad(idunidad: int, request: Request):
    datos = await _leer_cuerpo(request)
    if not isinstance(datos, dict):
        return _respuesta(False, 400, "Cuerpo JSON invalido", None)
    estado = datos.get("estado", "")
    if estado not in ("disponible", "en_inspeccion", "en_reparacion", "alquilada"):
        return _respuesta(
            False, 400, "Estado invalido (disponible|en_inspeccion|en_reparacion)", None
        )
    try:
        with _conexion() as conn:
            cur = conn.cursor(dictionary=True, prepared=True)
            try:
                cur.execute(
                    "SELECT idunidad, estado FROM unidades WHERE idunidad = %s",
                    (idunidad,),
                )
                unidad = cur.fetchone()
                if unidad is None:
                    return _respuesta(False, 404, "Unidad no encontrada", None)
                if unidad["estado"] == "alquilada":
                    return _respuesta(
                        False,
                        409,
                        "No se puede cambiar manualmente una unidad alquilada",
                        None,
                    )
                if estado == "alquilada" and unidad["estado"] != "disponible":
                    return _respuesta(
                        False,
                        409,
                        "Solo una unidad disponible puede pasar a alquilada",
                        None,
                    )
                cur.execute(
                    "UPDATE unidades SET estado = %s, estadodesde = NOW() "
                    "WHERE idunidad = %s",
                    (estado, idunidad),
                )
                conn.commit()
                anterior = unidad["estado"]
            finally:
                cur.close()
    except MySQLError:
        return _respuesta(False, 500, "Error de base de datos", None)
    return _respuesta(
        True,
        200,
        "Estado actualizado",
        {"idunidad": idunidad, "estado_anterior": anterior, "estado": estado},
    )


@app.post("/fotos")
async def leer_foto(request: Request):
    datos = await _leer_cuerpo(request)
    if not isinstance(datos, dict):
        return _respuesta(False, 400, "Cuerpo JSON invalido", None)
    ruta = datos.get("ruta", "")
    if not isinstance(ruta, str) or not RE_RUTA_FOTO.match(ruta):
        return _respuesta(False, 400, "Ruta de foto invalida", None)
    base = str(BASE_FOTOS)
    normalizada = os.path.normpath(os.path.join(base, ruta))
    if os.path.commonpath([base, normalizada]) != base:
        return _respuesta(False, 400, "Ruta de foto invalida", None)
    if not os.path.isfile(normalizada):
        return _respuesta(False, 404, "Foto no encontrada", None)
    try:
        with open(normalizada, "rb") as archivo:
            binarios = archivo.read()
    except OSError:
        return _respuesta(False, 500, "No se pudo leer la foto", None)
    if normalizada.lower().endswith(".png"):
        tipo = "image/png"
    else:
        tipo = "image/jpeg"
    return _respuesta(
        True,
        200,
        "Foto",
        {
            "contenido_base64": base64.b64encode(binarios).decode("ascii"),
            "tipo": tipo,
        },
    )


@app.post("/reportes/resumen")
async def resumen_reportes(request: Request):
    datos = await _leer_cuerpo(request)
    if datos is None:
        return _respuesta(False, 400, "Cuerpo JSON invalido", None)
    try:
        with _conexion() as conn:
            cur = conn.cursor(dictionary=True, prepared=True)
            try:
                cur.execute("SELECT COUNT(*) AS total FROM maquinarias")
                total_maquinarias = cur.fetchone()["total"]
                cur.execute("SELECT COUNT(*) AS total FROM unidades")
                unidades_totales = cur.fetchone()["total"]
                cur.execute(
                    "SELECT COUNT(*) AS total FROM unidades WHERE estado = %s",
                    ("disponible",),
                )
                disponibles = cur.fetchone()["total"]
                cur.execute(
                    "SELECT COUNT(*) AS total FROM unidades u WHERE "
                    "(SELECT m.categoria FROM maquinarias m "
                    "WHERE m.idmaquinaria = u.idmaquinaria) = %s",
                    ("pesada",),
                )
                pesadas = cur.fetchone()["total"]
                cur.execute(
                    "SELECT COUNT(*) AS total FROM unidades u WHERE "
                    "(SELECT m.categoria FROM maquinarias m "
                    "WHERE m.idmaquinaria = u.idmaquinaria) = %s",
                    ("liviana",),
                )
                livianas = cur.fetchone()["total"]
                cur.execute(
                    "SELECT m.idmaquinaria, m.nombre, m.categoria, m.activo, "
                    "(SELECT COUNT(*) FROM unidades u "
                    "WHERE u.idmaquinaria = m.idmaquinaria) AS total_unidades, "
                    "(SELECT COUNT(*) FROM unidades u "
                    "WHERE u.idmaquinaria = m.idmaquinaria "
                    "AND u.estado = %s) AS disponibles "
                    "FROM maquinarias m ORDER BY m.idmaquinaria ASC",
                    ("disponible",),
                )
                maquinas = [_normalizar_fila(fila) for fila in cur.fetchall()]
            finally:
                cur.close()
    except MySQLError:
        return _respuesta(False, 500, "Error de base de datos", None)
    resumen = {
        "fecha": datetime.now().isoformat(),
        "total_maquinarias": total_maquinarias,
        "unidades_totales": unidades_totales,
        "disponibles": disponibles,
        "pesadas": pesadas,
        "livianas": livianas,
        "maquinas": maquinas,
    }
    return _respuesta(True, 200, "Resumen", resumen)


@app.get("/reportes/guardados")
async def listar_reportes():
    try:
        with _conexion() as conn:
            cur = conn.cursor(dictionary=True, prepared=True)
            try:
                cur.execute(
                    "SELECT idreporte, fecha, titulo, total_contratos, "
                    "contratos_activos, contratos_morosos, ingresos, "
                    "maquina_mas_alquilada, unidades_pesadas, "
                    "disponibles_pesadas, unidades_livianas, disponibles_livianas "
                    "FROM reportesguardados "
                    "ORDER BY fecha DESC, idreporte DESC"
                )
                filas = [_normalizar_fila(fila) for fila in cur.fetchall()]
            finally:
                cur.close()
    except MySQLError:
        return _respuesta(False, 500, "Error de base de datos", None)
    return _respuesta(True, 200, "Reportes guardados", filas)


@app.post("/reportes/guardados", status_code=201)
async def guardar_reporte(request: Request):
    datos = await _leer_cuerpo(request)
    if not isinstance(datos, dict):
        return _respuesta(False, 400, "Cuerpo JSON invalido", None)
    titulo = datos.get("titulo", "")
    if not isinstance(titulo, str):
        return _respuesta(False, 400, "Titulo invalido (maximo 150)", None)
    titulo = titulo.strip()
    if len(titulo) == 0 or len(titulo) > 150:
        return _respuesta(False, 400, "Titulo invalido (maximo 150)", None)
    anidados = datos.get("datos")
    if isinstance(anidados, dict):
        fuente = anidados
    else:
        fuente = datos
    campos = {}
    for campo in (
        "unidades_pesadas",
        "disponibles_pesadas",
        "unidades_livianas",
        "disponibles_livianas",
    ):
        valor = fuente.get(campo, 0)
        if not _es_entero(valor) or valor < 0:
            return _respuesta(False, 400, f"{campo} invalido (>=0)", None)
        campos[campo] = valor
    try:
        with _conexion() as conn:
            cur = conn.cursor(dictionary=True, prepared=True)
            try:
                cur.execute(
                    "INSERT INTO reportesguardados "
                    "(titulo, total_contratos, contratos_activos, "
                    "contratos_morosos, ingresos, maquina_mas_alquilada, "
                    "unidades_pesadas, disponibles_pesadas, "
                    "unidades_livianas, disponibles_livianas) "
                    "VALUES (%s, 0, 0, 0, %s, NULL, %s, %s, %s, %s)",
                    (
                        titulo,
                        0.00,
                        campos["unidades_pesadas"],
                        campos["disponibles_pesadas"],
                        campos["unidades_livianas"],
                        campos["disponibles_livianas"],
                    ),
                )
                conn.commit()
                idreporte = cur.lastrowid
            finally:
                cur.close()
    except MySQLError:
        return _respuesta(False, 500, "Error de base de datos", None)
    return _respuesta(
        True,
        201,
        "Reporte guardado",
        {"idreporte": idreporte, "titulo": titulo, **campos},
    )


@app.delete("/reportes/guardados/{idreporte}")
async def eliminar_reporte(idreporte: int, request: Request):
    if not _requiere_admin(request):
        return _respuesta(False, 403, "Se requiere rol admin", None)
    try:
        with _conexion() as conn:
            cur = conn.cursor(dictionary=True, prepared=True)
            try:
                cur.execute(
                    "SELECT idreporte FROM reportesguardados WHERE idreporte = %s",
                    (idreporte,),
                )
                if cur.fetchone() is None:
                    return _respuesta(False, 404, "Reporte no encontrado", None)
                cur.execute(
                    "DELETE FROM reportesguardados WHERE idreporte = %s",
                    (idreporte,),
                )
                conn.commit()
            finally:
                cur.close()
    except MySQLError:
        return _respuesta(False, 500, "Error de base de datos", None)
    return _respuesta(True, 200, "Reporte eliminado", {"idreporte": idreporte})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("servidor:app", host="127.0.0.1", port=3003)
