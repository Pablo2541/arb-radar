# ════════════════════════════════════════════════════════════════════════
# ARB//RADAR V4.0 BLINDADO — Manual de Operación
# ════════════════════════════════════════════════════════════════════════

## 1. EDITAR TU CARTERA EN portfolio.json

El archivo `data/portfolio.json` es el ÚNICO lugar donde se guarda tu
estado de cartera. El radar LO LEE al arrancar, pero NUNCA lo modifica
automáticamente.

### Ubicación

```
tu-proyecto/
└── data/
    └── portfolio.json
```

### Estructura del Archivo

```json
{
  "_comment": "ARB//RADAR V4.0 — No editar este campo",
  "_instructions": ["... instrucciones internas ..."],

  "capitalDisponible": 467587.55,

  "position": {
    "ticker": "T30J7",
    "entryPrice": 1.1200,
    "vn": 417310,
    "entryDate": "05/05/2025",
    "precioConComision": 1.1234
  },

  "transactions": [],

  "config": {
    "caucion1d": 21.0,
    "caucion7d": 19.2,
    "caucion30d": 18.5,
    "comisionTotal": 0.30
  },

  "lastUpdated": "2025-05-07"
}
```

### Campo por Campo

#### `capitalDisponible` (OBLIGATORIO)
- Tu capital líquido en pesos argentinos
- Número decimal, sin comillas
- Ejemplo: `467587.55`
- Si estás 100% invertido, poné el capital que tendrías vendiendo

#### `position` (OBLIGATORIO, puede ser null)
- Tu posición actual en un bono/letra
- Si estás en caja (sin posición), poné: `"position": null`

Subcampos de position:

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `ticker` | string | Ticker del instrumento | `"T30J7"` |
| `entryPrice` | number | Precio de compra por $1 VN (sin comisión) | `1.1200` |
| `vn` | number | Valor nominal de los títulos | `417310` |
| `entryDate` | string | Fecha de compra (DD/MM/YYYY) | `"05/05/2025"` |
| `precioConComision` | number | Precio con comisión incluida (opcional pero recomendado) | `1.1234` |

#### `transactions` (OPCIONAL)
- Array de transacciones históricas (compras/ventas)
- Se usa para el Historial y P&L
- El radar lo popula si usás la tab Cartera para registrar operaciones
- Formato: `[{ "type": "BUY"|"SELL", "ticker": "...", ... }]`

#### `config` (SEMI-OBLIGATORIO)
- Parámetros de configuración del radar

| Campo | Tipo | Descripción | Default |
|-------|------|-------------|---------|
| `caucion1d` | number | TNA caución 1 día (%) | `21.0` |
| `caucion7d` | number | TNA caución 7 días (%) | `19.2` |
| `caucion30d` | number | TNA caución 30 días (%) | `18.5` |
| `comisionTotal` | number | Comisión total (%) | `0.30` |

**Nota:** `riesgoPais` NO está en el archivo a propósito. Viene de la API
en tiempo real (Market Truth Engine). Si lo agregás, se usa como fallback.

---

### Operaciones Comunes

#### Estoy en caja (sin posición)
```json
{
  "capitalDisponible": 467587.55,
  "position": null,
  ...
}
```

#### Compré un bono nuevo
```json
{
  "capitalDisponible": 0,
  "position": {
    "ticker": "T15E7",
    "entryPrice": 1.0450,
    "vn": 448000,
    "entryDate": "07/05/2025",
    "precioConComision": 1.0481
  },
  ...
}
```

#### Vendí y volví a caja
```json
{
  "capitalDisponible": 472150.30,
  "position": null,
  ...
}
```

#### Roté de un bono a otro
```json
{
  "capitalDisponible": 3200.00,
  "position": {
    "ticker": "S1L5",
    "entryPrice": 0.9870,
    "vn": 469000,
    "entryDate": "07/05/2025",
    "precioConComision": 0.9899
  },
  ...
}
```

### ⚠️ REGLAS IMPORTANTES

1. **SIEMPRE reiniciá el servidor** después de editar portfolio.json
   - Ctrl+C en la terminal → `npm run dev`
   - El archivo se lee SOLO al arrancar

2. **NUNCA borres el archivo** — Si no existe, el radar usa defaults

3. **Validá el JSON** antes de guardar:
   - Usá un validador online: https://jsonlint.com/
   - O en terminal: `node -e "console.log(JSON.parse(require('fs').readFileSync('data/portfolio.json','utf8')))"`
   - Si el JSON es inválido, el radar usa defaults

4. **No pongas riesgoPais ni mepRate** en el archivo:
   - Estos datos vienen de las APIs en tiempo real
   - Si los ponés, se usan como fallback pero NO es la fuente de verdad

5. **Guardá con UTF-8** — Algunos editores (Notepad en Windows) guardan
   en UTF-16 por defecto. Cambiá la codificación a UTF-8.

---

## 2. VERIFICAR EL PUENTE IOL

### Endpoint de Diagnóstico

El endpoint `/api/iol-status` te dice EXACTAMENTE qué pasa con IOL:

```bash
curl http://localhost:3000/api/iol-status
```

### Interpretar la Respuesta

#### ✅ IOL Online (todo bien)
```json
{
  "status": "online",
  "token_status": "valid",
  "credentials": true,
  "online": true,
  "iol_available": true,
  "diagnostic": {
    "credentials_configured": true,
    "username_present": true,
    "password_present": true,
    "username_length": 20,
    "password_length": 12,
    "token_cached": true,
    "token_expires_at": "2025-05-07T15:30:00.000Z",
    "iol_available": true,
    "circuit_breaker": {
      "failures": 0,
      "locked": false,
      "backoff_until": null
    },
    "last_auth_error": null,
    "last_auth_status": 200
  }
}
```

Campos clave:
- `status: "online"` → IOL funciona ✅
- `token_cached: true` → Token obtenido y cacheado
- `circuit_breaker.failures: 0` → Sin errores recientes
- `last_auth_error: null` → Sin errores

#### ⚠️ Sin Credenciales
```json
{
  "status": "not_configured",
  "token_status": "not_configured",
  "credentials": false,
  ...
}
```
→ Configurá IOL_USERNAME e IOL_PASSWORD en `.env`

#### 🔴 Auth Fallida (credenciales incorrectas)
```json
{
  "status": "auth_failed",
  "token_status": "invalid",
  "credentials": true,
  "diagnostic": {
    "last_auth_error": "HTTP 401: {\"error\":\"invalid_grant\"}",
    "last_auth_status": 401,
    "circuit_breaker": {
      "failures": 2,
      "locked": false,
      ...
    }
  }
}
```
→ Contraseña incorrecta o mal formateada en .env
→ Verificá que usaste COMILLAS DOBLES

#### 🔒 Circuit Breaker Activado
```json
{
  "status": "circuit_breaker_locked",
  "diagnostic": {
    "circuit_breaker": {
      "failures": 5,
      "locked": true,
      "backoff_until": null
    }
  }
}
```
→ Demasiados intentos fallidos. IOL está bloqueado para proteger
la cuenta.

**Para resetear:**
```bash
curl -X POST http://localhost:3000/api/iol-status
```

Esto limpia el circuit breaker y permite reintentar. Pero si las
credenciales son incorrectas, va a fallar otra vez.

### Escala de Circuit Breaker

| Fallos consecutivos | Acción |
|---------------------|--------|
| 1-2 | Reintento normal en siguiente ciclo |
| 3 | Backoff 30 minutos |
| 5 | **BLOQUEO TOTAL** — requiere reset manual |

---

## 3. GUARDAR DESDE LA UI

El radar tiene un botón de "Guardar" en la tab Configuración que
escribe los cambios actuales a `portfolio.json`. También podés usar:

- **Ctrl+S** → Guarda la cartera actual al archivo
- **Tab Configuración → Botón "Guardar"** → Igual efecto

Esto SOLO guarda capital, posición, transacciones y config. Los precios
siempre vienen de las APIs.

---

## 4. INDICADORES DE ESTADO (HEADER)

### FILE (punto + label)
Indica de dónde viene la cartera:

| Color | Label | Significado |
|-------|-------|-------------|
| 🟢 Verde pulsante | `FILE` | portfolio.json cargado OK |
| 🟡 Amarillo | `FILE?` | No encontró portfolio.json, usando localStorage |
| ⚪ Gris | `FILE✗` | Ni archivo ni localStorage, usando defaults |

### L2 (IOL Level-2)

| Color | Label | Significado |
|-------|-------|-------------|
| 🟣 Violeta pulsante | `L2` | IOL online, datos Level-2 disponibles |
| ⚪ Gris | `L2✗` | Sin credenciales IOL (funciona sin IOL) |
| 🟠 Naranja | `L2⚠` | Credenciales presentes pero auth falló |

### MT (Market Truth)

| Color | Label | Significado |
|-------|-------|-------------|
| 🟢 Verde pulsante | `MT` | RP y MEP con confianza ALTA |
| 🟡 Amarillo | `MT` | Confianza MEDIA |
| 🟠 Naranja | `STALE` | Datos desactualizados (refrescando) |
| ⚪ Gris | `MT` | Market Truth offline |
| 🔴 Rojo | `MT` | Confianza BAJA o CRÍTICA |

### Mercado Abierto/Cerrado

| Badge | Significado |
|-------|-------------|
| `MERCADO ABIERTO` (verde pulsante) | Horario de trading (L-V 10-17h AR) |
| `MERCADO CERRADO` (gris) | Fuera de horario |

---

## 5. ORQUESTADOR DE APIs (SECUENCIAL)

V4.0 BLINDADO ejecuta las APIs EN SECUENCIA, nunca en paralelo.
Esto previene crashes del servidor por sobrecarga de requests.

### Timeline de Carga

```
t=0s    → Página carga, store se inicializa desde portfolio.json
t=30s   → Orquestador arranca (delay para estabilidad)
t=33s   → /api/letras (instrumentos + caución)
t=36s   → /api/dolar (cotizaciones)
t=40s   → /api/market-truth (RP + MEP consenso)
t=46s   → /api/iol-level2 (Level-2 check)
t=50s   → /api/market-pressure (absorción)
```

### Intervalos de Refresh

| API | Intervalo | Timeout |
|-----|-----------|---------|
| letras | 90s | 30s |
| dolar | 5 min | 12s |
| market-truth | 90s | 20s |
| iol-level2 | 2 min | 12s |
| market-pressure | 2 min | 12s |

**Solo UN fetch está en vuelo en cualquier momento.** Si uno tarda,
los demás esperan en cola.

---

## 6. DATOS EN TIEMPO REAL vs ESTÁTICOS

### APIs Vivas (tiempo real) — NUNCA del archivo

| Dato | Fuente | Endpoint |
|------|--------|----------|
| Precios de instrumentos | data912 | /api/letras |
| Riesgo País | ArgentinaDatos + BondTerminal | /api/market-truth |
| Dólar MEP | data912 AL30/AL30D + DolarAPI | /api/market-truth |
| Puntas IOL | InvertirOnline API | /api/iol-level2 |
| Presión de mercado | InvertirOnline API | /api/market-pressure |
| Cotizaciones dólar | DolarAPI | /api/dolar |

### Datos de portfolio.json (estáticos, vos los editás)

| Dato | Campo |
|------|-------|
| Capital disponible | `capitalDisponible` |
| Posición actual | `position` |
| Transacciones | `transactions` |
| Tasas de caución | `config.caucion1d/7d/30d` |
| Comisión | `config.comisionTotal` |

### Datos de Neon (históricos, solo lectura)

| Dato | Modelo | Endpoint |
|------|--------|----------|
| Velas diarias (OHLC) | DailyOHLC | /api/price-history?type=ohlc |
| Snapshots de precios | PriceSnapshot | /api/price-history?type=snapshots |
| Riesgo País último | CountryRisk | /api/country-risk (fallback) |

---

## 7. ATAJOS DE TECLADO

| Atajo | Acción |
|-------|--------|
| `Alt+1` | Tab Mercado |
| `Alt+2` | Tab Cockpit |
| `Alt+3` | Tab Curvas |
| `Alt+5` | Tab Estrategias |
| `Alt+6` | Tab Cartera |
| `Alt+8` | Tab Historial |
| `Alt+T` | Alternar tema (dark/light) |
| `Ctrl+L` | Toggle LIVE refresh |
| `Ctrl+S` | Guardar cartera a portfolio.json |
| `?` | Mostrar ayuda |
| `Esc` | Cerrar ayuda |

---

## 8. RESOLUCIÓN DE PROBLEMAS COMUNES

### "Los precios no se actualizan"

1. Esperá 30+ segundos (el orquestador arranca con delay)
2. Verificá la conexión a internet
3. Mirá la consola del navegador (F12)
4. Las APIs pueden estar caídas — el radar muestra la última data cacheada

### "El indicador L2⚠ parpadea"

1. Verificá credenciales IOL en `.env` (comillas dobles!)
2. Corré: `curl http://localhost:3000/api/iol-status`
3. Si dice `circuit_breaker_locked`, reseteá: `curl -X POST http://localhost:3000/api/iol-status`
4. Reiniciá el servidor

### "Riesgo País muestra 0 o CRITICA"

1. Las APIs de ArgentinaDatos pueden estar caídas
2. Verificá: `curl https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo`
3. El radar usa Neon como fallback
4. Si todo falla, muestra el último valor cacheado

### "El servidor se reinicia solo"

1. Verificá que no haya errores en la terminal
2. Los archivos que se modifican mientras el servidor corre pueden
   causar hot-reload (normal en desarrollo)
3. Si crashea repetidamente, puede ser un problema de memoria:
   - Cerrá otras aplicaciones
   - Verificá que Node.js tenga suficiente memoria

### "Quiero empezar de cero"

1. Borrá localStorage del navegador (DevTools → Application → Local Storage → Clear)
2. En la app, el indicador cambiará a "FILE✗"
3. El radar recargará desde portfolio.json al reiniciar
4. Si querés borrar TODO: cerrá el navegador, borrá localStorage,
   reiniciá el servidor

---

## 9. FLUJO DE TRABAJO RECOMENDADO

### Antes de abrir el mercado (9:30 AM)

1. Editá `data/portfolio.json` con tu posición actual
2. Reiniciá el servidor (`Ctrl+C` → `npm run dev`)
3. Verificá el indicador FILE (debe ser verde)
4. Verificá el indicador L2 (si usás IOL)
5. Esperá 60 segundos a que carguen todas las APIs

### Durante el mercado (10:00 - 17:00)

1. Monitoreá el tab Mercado para precios en vivo
2. Usá el tab Cockpit para señales de scalping
3. Revisá el tab Curvas para anomalías en la curva
4. Si rotás de bono, actualizá portfolio.json y reiniciá

### Después de operar

1. Guardá la cartera: `Ctrl+S` o botón Guardar
2. Verificá que el archivo se actualizó: mirá `data/portfolio.json`
3. El `lastUpdated` debe mostrar la fecha de hoy

---

*ARB//RADAR V4.0 BLINDADO — "Data Intelligence ≠ Data Persistence"*
