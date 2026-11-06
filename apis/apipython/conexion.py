"""Conexion a MySQL con pool para la API Python.

Lee la configuracion desde .env (DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS).
Toda consulta debe usar marcadores %s (consultas preparadas).
La conexion se entrega por peticion y debe cerrarse con try/finally.
"""

import os

from dotenv import load_dotenv
from mysql.connector import pooling

load_dotenv()

_POOL = None


def _obtener_pool():
    """Crea (una sola vez) el pool de 5 conexiones."""
    global _POOL
    if _POOL is None:
        _POOL = pooling.MySQLConnectionPool(
            pool_name="poolpython",
            pool_size=5,
            pool_reset_session=True,
            host=os.getenv("DB_HOST", "127.0.0.1"),
            port=int(os.getenv("DB_PORT", "3306")),
            database=os.getenv("DB_NAME", "controlalquiler"),
            user=os.getenv("DB_USER", ""),
            password=os.getenv("DB_PASS", ""),
        )
    return _POOL


def get_connection():
    """Entrega una conexion del pool. Cerrar con try/finally o with."""
    conn = _obtener_pool().get_connection()
    try:
        # Corta consultas lentas (p. ej. SLEEP/BENCHMARK inyectados).
        cur = conn.cursor()
        cur.execute("SET SESSION max_statement_time = 5")
        cur.close()
    except Exception:
        pass
    return conn
