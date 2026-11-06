// Prototipo móvil del Sistema de Alquiler de Maquinaria (Anexo D).
// Dos pantallas: Catálogo (MAQUINARIAS:GET) y Notificaciones
// (NOTIFICACIONES:GET, NOTIFICACIONES:PUT con todas:true).
// Todo pasa ÚNICAMENTE por el API Gateway como en la web.
//
// NOTA DE INTEGRACIÓN (fidelidad con el documento):
//   el gateway exige cabecera Origen exacto (seguridad.js) porque la web
//   corre en localhost:8443. Para el teléfono en producción se agrega un
//   origen permitido o una cabecera-cliente (X-Cliente-Movil) al gateway.
//   Para la DEMO local se recomienda el emulador Android:
//   10.0.2.2 = 127.0.0.1 del PC, misma dirección de loopback del gateway.
import { useState, useEffect, useCallback } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, FlatList, TextInput, Pressable,
  StyleSheet, ActivityIndicator, RefreshControl
} from 'react-native';

// Cambie aquí la URL del gateway según su entorno de demostración:
//  · Expo Web demo    : https://localhost:3000/api (valor actual)
//  · Emulador Android : http://10.0.2.2:3000/api
//  · Dispositivo físico: https://IP-DE-SU-PC:3000/api (con certificado local)
const URL_GATEWAY = 'https://localhost:3000/api';

// El token vive solo en memoria de la app (igual que en la web);
// para la demo del catálogo público el gateway acepta TOKEN ''.
async function pedirGateway(rama, metodo, datos) {
  const respuesta = await fetch(URL_GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      TOKEN: '',
      dat: { RAMA: rama, METODO: metodo, DATOS: datos || {} }
    })
  });
  return respuesta.json();
}

// ---------- Pantalla Catálogo ----------
function PantallaCatalogo() {
  const [maquinas, setMaquinas] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setMensaje('');
    try {
      const r = await pedirGateway('MAQUINARIAS', 'GET', {});
      if (r.ok) {
        const filtro = busqueda.toLowerCase();
        setMaquinas((r.datos || []).filter(
          (m) => m.activo === 1 && (!filtro || m.nombre.toLowerCase().includes(filtro))
        ));
      } else {
        setMensaje(r.mensaje || 'No se pudo cargar el catálogo.');
      }
    } catch {
      setMensaje('Gateway no alcanzado. Configure URL_GATEWAY (ver guía).');
    } finally {
      setCargando(false);
    }
  }, [busqueda]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <View style={estilos.pantalla}>
      <Text style={estilos.titulo}>Catálogo de maquinaria</Text>
      <TextInput
        style={estilos.entrada}
        placeholder="Buscar por nombre..."
        value={busqueda}
        onChangeText={setBusqueda}
      />
      {cargando && <ActivityIndicator size="large" color="#FFB800" />}
      {!!mensaje && <Text style={estilos.error}>{mensaje}</Text>}
      <FlatList
        data={maquinas}
        keyExtractor={(m) => String(m.idmaquinaria)}
        refreshControl={
          <RefreshControl refreshing={cargando} onRefresh={cargar} colors={['#FFB800']} />
        }
        renderItem={({ item }) => (
          <View style={estilos.tarjeta}>
            <Text style={estilos.tarjetaNombre}>{item.nombre}</Text>
            <Text style={estilos.tarjetaDetalles}>
              {item.categoria} · día: ${Number(item.tarifadiaria).toLocaleString('es-CO')}
            </Text>
            <Text style={estilos.tarjetaEstado}>
              {Number(item.unidades_disponibles) > 0
                ? 'Disponible (' + item.unidades_disponibles + '/' + item.total_unidades + ')'
                : 'Sin unidades libres'}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          !cargando && <Text style={estilos.vacio}>Sin máquinas para mostrar.</Text>
        }
      />
    </View>
  );
}

// ---------- Pantalla Notificaciones ----------
function PantallaNotificaciones() {
  const [avisos, setAvisos] = useState([]);
  const [sinLeer, setSinLeer] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(false);
    try {
      const r = await pedirGateway('NOTIFICACIONES', 'GET', {});
      if (r.ok) {
        setAvisos(r.datos.notificaciones || []);
        setSinLeer(r.datos.no_leidas || 0);
      } else {
        setError(r.codigo === 401 ? 'Sesión del equipo requerida.' : r.mensaje);
      }
    } catch {
      setError('Gateway no alcanzado. Configure URL_GATEWAY (ver guía).');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const marcarTodas = async () => {
    try {
      await pedirGateway('NOTIFICACIONES', 'PUT', { todas: true });
      cargar();
    } catch {
      setError('Gateway no alcanzado.');
    }
  };

  return (
    <View style={estilos.pantalla}>
      <View style={estilos.filaTitulo}>
        <Text style={estilos.titulo}>Notificaciones {sinLeer > 0 ? '(' + sinLeer + ')' : ''}</Text>
        <Pressable style={estilos.boton} onPress={marcarTodas}>
          <Text style={estilos.botonTexto}>Marcar todas</Text>
        </Pressable>
      </View>
      {cargando && <ActivityIndicator size="large" color="#FFB800" />}
      {!!error && <Text style={estilos.error}>{error}</Text>}
      <FlatList
        data={avisos}
        keyExtractor={(n) => String(n.idnotificacion)}
        refreshControl={
          <RefreshControl refreshing={cargando} onRefresh={cargar} colors={['#FFB800']} />
        }
        renderItem={({ item }) => (
          <View style={[estilos.tarjeta, estilos['nivel_' + item.nivel]]}>
            <Text style={estilos.tarjetaNombre}>{item.titulo}</Text>
            <Text style={estilos.tarjetaDetalles}>{item.mensaje}</Text>
            <Text style={estilos.cuando}>{item.rama} · {String(item.fecha).slice(0, 16)}</Text>
          </View>
        )}
        ListEmptyComponent={
          !cargando && <Text style={estilos.vacio}>Sin notificaciones todavía.</Text>
        }
      />
    </View>
  );
}

// ---------- App con dos pestañas sencillas ----------
export default function App() {
  const [pantalla, setPantalla] = useState('catalogo');
  return (
    <SafeAreaProvider>
      <SafeAreaView style={estilos.raiz}>
        <View style={estilos.barra}>
          <Pressable
            style={[estilos.pestana, pantalla === 'catalogo' && estilos.pestanaActiva]}
            onPress={() => setPantalla('catalogo')}>
            <Text style={estilos.pestanaTexto}>Catálogo</Text>
          </Pressable>
          <Pressable
            style={[estilos.pestana, pantalla === 'notificaciones' && estilos.pestanaActiva]}
            onPress={() => setPantalla('notificaciones')}>
            <Text style={estilos.pestanaTexto}>Notificaciones</Text>
          </Pressable>
        </View>
        {pantalla === 'catalogo' ? <PantallaCatalogo /> : <PantallaNotificaciones />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: '#F2F3F5' },
  barra: { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: '#14161A' },
  pestana: { flex: 1, padding: 10, borderRadius: 6, alignItems: 'center', backgroundColor: '#2B3038' },
  pestanaActiva: { backgroundColor: '#FFB800' },
  pestanaTexto: { color: '#FFFFFF', fontWeight: '700' },
  pantalla: { flex: 1, padding: 14, gap: 10 },
  titulo: { fontSize: 20, fontWeight: '800' },
  entrada: { borderWidth: 1, borderColor: '#C9CDD3', borderRadius: 6, padding: 10, backgroundColor: '#FFFFFF' },
  boton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6, backgroundColor: '#214F9E' },
  botonTexto: { color: '#FFFFFF', fontWeight: '700' },
  tarjeta: { borderWidth: 1, borderColor: '#D9DCE1', borderRadius: 6, padding: 12, backgroundColor: '#FFFFFF', borderLeftWidth: 5, borderLeftColor: '#FFB800' },
  nivel_exito: { borderLeftColor: '#1E7B3A' },
  nivel_aviso: { borderLeftColor: '#B45309' },
  nivel_error: { borderLeftColor: '#B42318' },
  nivel_info: { borderLeftColor: '#1D5FA8' },
  tarjetaNombre: { fontWeight: '800' },
  tarjetaDetalles: { color: '#4B5563', marginTop: 2 },
  tarjetaEstado: { color: '#1E7B3A', fontWeight: '700', marginTop: 6 },
  cuando: { color: '#6B7280', fontSize: 12, marginTop: 6 },
  vacio: { textAlign: 'center', color: '#6B7280', marginTop: 20 },
  error: { color: '#B42318', fontWeight: '700' },
  filaTitulo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
