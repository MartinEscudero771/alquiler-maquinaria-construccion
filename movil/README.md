# Prototipo móvil — Alquiler de Maquinaria (Anexo D)

Cliente móvil de demostración construido con **React Native + Expo** (el
enfoque **híbrido / multiplataforma** elegido en la sección de análisis
teórico). Consume el mismo **API Gateway** que la web (puerto 3000,
rama por tabla), sin tocar las APIs ni las tablas.

## Pantallas

| Pestaña | Rama del gateway | Qué hace |
|---|---|---|
| **Catálogo** | `MAQUINARIAS GET` | Lista las máquinas activas con tarifa y disponibilidad; búsqueda por nombre; pull-to-refresh |
| **Notificaciones** | `NOTIFICACIONES GET` / `NOTIFICACIONES PUT (todas)` | Lista los avisos del equipo con borde por nivel y permite "Marcar todas" como leídas |

## Puesta en marcha

```bash
cd movil
npm install          # instala expo, react, react-native
npx expo start       # abre el bundler; escanee el QR con Expo Go o use un emulador
```

## ¿Con qué URL consume el gateway?

| Entorno de demo | URL por definir en `App.js` (`URL_GATEWAY`) |
|---|---|
| **Emulador Android Studio** (recomendado) | `http://10.0.2.2:3000/api` — `10.0.2.2` es el alias del `127.0.0.1` del PC anfitrión, exactamente donde escucha el gateway |
| **Navegador web de Expo** | `https://localhost:3000/api` |
| **Teléfono físico en LAN** | `https://IP-DEL-PC:3000/api` (requiere aceptar el certificado local y que el firewall permita el puerto 3000) |

## Limitación documentada (fidelidad con el doc ↔ código)

El gateway valida la cabecera `Origin` o `Referer` por seguridad
(`api-gateway/src/middleware/seguridad.js`), porque la SPA oficial vive en
`https://localhost:8443`. Una app nativa no envía `Origin`, así que para
activar el cliente móvil en producción se requiere un cambio mínimo y
consciente en el gateway: incorporar el origen del build móvil (o una
cabecera-identidad `X-Cliente-Movil` con secreto) a la lista de orígenes
permitidos. Este prototipo NO modifica el gateway por decisión de
seguridad: queda listo y documentado como trabajo futuro inmediato.

## Por qué React Native + Expo (resumen del Anexo D)

- El equipo ya domina **JavaScript/ES6**: comparte lenguaje con el frontend y la API gateway, curva casi nula.
- Un único código JS para Android y web reduces el mantenimiento académico.
- Expo permite iterar sin Android Studio ni Xcode en la máquina de clase.
- El diseño de la app usa los MISMOS proveedores de UI del proyecto: componentes planos + paleta amarillo/negro; sin lógica de negocio duplicada (todo por el gateway).
