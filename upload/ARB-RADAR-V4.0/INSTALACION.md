# ════════════════════════════════════════════════════════════════════════
# ARB//RADAR V4.0 BLINDADO — Instructivo de Instalación "Para Humanos"
# ════════════════════════════════════════════════════════════════════════

## REQUISITOS PREVIOS

Antes de empezar, necesitás tener instalado en tu terminal:

1. **Node.js 18+** (recomendado: 20 LTS)
   - Verificar: `node --version` → debe decir v18.x o mayor
   - Descargar de: https://nodejs.org/

2. **npm** o **bun** (gestor de paquetes)
   - npm viene con Node.js
   - Verificar: `npm --version`

3. **Git** (opcional, para control de versiones)
   - Verificar: `git --version`

---

## PASO 1: Preparar el Proyecto

Si estás partiendo de un proyecto Next.js existente:

```bash
# Navegá a la carpeta de tu proyecto
cd tu-proyecto-arb-radar

# Si es un proyecto limpio, inicializá:
npx create-next-app@latest . --typescript --tailwind --app --src-dir
```

Si estás partiendo de cero:

```bash
mkdir arb-radar && cd arb-radar
npx create-next-app@latest . --typescript --tailwind --app --src-dir
```

---

## PASO 2: Copiar los Archivos del ZIP

Descomprimí el archivo `ARB-RADAR-V4.0-BLINDADO-Entrega.zip` y copiá
los archivos a la raíz de tu proyecto, MANTENIENDO la estructura de carpetas:

```
TuProyecto/
├── src/
│   ├── lib/
│   │   ├── iol-bridge.ts        ← Puente IOL (auth + Level-2)
│   │   ├── api-orchestrator.ts   ← Orquestador secuencial de APIs
│   │   ├── store.ts              ← Estado global Zustand + portfolio.json
│   │   └── db.ts                 ← Conexión Neon (crash-proof)
│   └── app/
│       ├── page.tsx              ← Página principal (optimizada)
│       └── api/
│           ├── market-truth/     ← Motor de consenso RP + MEP
│           ├── country-risk/     ← Riesgo País multi-fuente
│           ├── price-history/    ← Datos históricos OHLC (Neon)
│           ├── portfolio/        ← Lectura/escritura de portfolio.json
│           ├── iol-status/       ← Diagnóstico IOL completo
│           ├── iol-level2/       ← Datos Level-2 por ticker
│           ├── letras/           ← Instrumentos en vivo (data912)
│           ├── dolar/            ← Cotizaciones dólar
│           ├── market-pressure/  ← Presión de mercado + absorción
│           ├── state/            ← Estado legacy (Neon AppState)
│           └── cockpit-score/    ← Score de scalping unificado
├── data/
│   └── portfolio.json            ← TU CARTERA (editar manualmente)
├── prisma/
│   └── schema.prisma             ← Schema PostgreSQL (Neon)
└── .env.example                  ← Template de configuración
```

### Comando rápido (Linux/Mac):

```bash
# Descomprimir y copiar (ajustá las rutas según tu caso)
unzip ARB-RADAR-V4.0-BLINDADO-Entrega.zip -d /tmp/arb-delivery
cp -r /tmp/arb-delivery/delivery/src/ ./src/
cp -r /tmp/arb-delivery/delivery/data/ ./data/
cp -r /tmp/arb-delivery/delivery/prisma/ ./prisma/
cp /tmp/arb-delivery/delivery/.env.example ./.env.example
```

### En Windows (PowerShell):

```powershell
Expand-Archive -Path ARB-RADAR-V4.0-BLINDADO-Entrega.zip -DestinationPath C:\temp\arb-delivery
Copy-Item -Recurse -Force C:\temp\arb-delivery\delivery\src\* .\src\
Copy-Item -Recurse -Force C:\temp\arb-delivery\delivery\data\* .\data\
Copy-Item -Recurse -Force C:\temp\arb-delivery\delivery\prisma\* .\prisma\
Copy-Item -Force C:\temp\arb-delivery\delivery\.env.example .\.env.example
```

---

## PASO 3: Configurar el .env

Copiá el template y editá con tus datos:

```bash
cp .env.example .env
```

### 3a. Configurar Neon PostgreSQL (para gráficos históricos)

El archivo `.env` ya tiene la URL de Neon. Si tenés tu propia base,
reemplazala. Si usás la misma, dejala como está:

```env
DATABASE_URL="postgresql://neondb_owner:npg_4bACo6SRhIFB@ep-odd-mud-ant4xs0i-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require"
ENABLE_DB=true
```

**⚠️ IMPORTANTE:** `ENABLE_DB=true` es OBLIGATORIO para que los gráficos
históricos funcionen. Sin esto, no se conecta a Neon y no hay datos OHLC.

### 3b. Configurar IOL (para datos Level-2)

Ingresá tus credenciales de InvertirOnline:

```env
IOL_USERNAME="tu-email@ejemplo.com"
IOL_PASSWORD="tuPasswordCon#Caracteres$Especiales"
```

### 🚨 REGLA DE ORO PARA LA CONTRASEÑA IOL 🚨

**SIEMPRE usá comillas dobles** en la contraseña. Sin comillas, estos
caracteres ROMPEN el .env:

| Carácter | Problema sin comillas | Ejemplo |
|----------|----------------------|---------|
| `#`      | Todo lo que sigue se ignora (comentario) | `Pass#123` → solo lee `Pass` |
| `$`      | Intenta expandir como variable de shell | `Pass$VAR` → reemplaza $VAR |
| `!`      | Puede causar errores de parsing | `Pass!abc` → error |
| `@`      | Normalmente OK, pero mejor con comillas | — |
| `&`      | Puede causar errores de parsing | — |
| Espacios | Se trunca en el primer espacio | `Pass word` → solo lee `Pass` |

**✅ CORRECTO:**
```
IOL_PASSWORD="MiPass#123$!"
```

**❌ INCORRECTO:**
```
IOL_PASSWORD=MiPass#123$!
```

Si no tenés cuenta IOL o no querés configurarla, dejá las credenciales
vacías. El radar funciona sin IOL (usa data912 como fuente primaria),
pero no verás puntas ni presión de mercado.

---

## PASO 4: Instalar Dependencias

```bash
npm install
```

Si el proyecto ya tenía dependencias instaladas, esto solo agregará las
que falten. Las dependencias clave que necesita V4.0:

- `zustand` → Estado global
- `@prisma/client` + `prisma` → Conexión Neon
- `recharts` → Gráficos
- `next` (16+) → Framework
- `react` (19+) → UI
- `lucide-react` → Iconos

---

## PASO 5: Generar el Cliente Prisma

```bash
npx prisma generate
```

Esto genera el cliente TypeScript para hablar con Neon. Si no configuraste
DATABASE_URL, este paso falla — pero la app funciona igual (sin historial).

---

## PASO 6: Sincronizar el Schema con Neon

```bash
npx prisma db push
```

Esto crea las tablas en Neon si no existen. Solo necesitás hacerlo la
primera vez. Las tablas clave son:

- `DailyOHLC` → Datos de velas diarias (para gráficos)
- `PriceSnapshot` → Snapshots de precios intradía
- `CountryRisk` → Último Riesgo País persistido
- `AppState` → Estado legacy (no se usa para cartera en V4.0)

---

## PASO 7: Inyectar Datos Históricos (Opcional)

Si tu base Neon está vacía y tenés datos históricos:

```bash
# Desde un archivo JSON de precios históricos:
npm run history:inject

# O desde un XLSX exportado:
npm run history:migrate
```

Si ya tenés los 433 registros DailyOHLC en Neon, salteá este paso.

---

## PASO 8: Editar Tu Cartera

Abrí `data/portfolio.json` con cualquier editor de texto y configurá
tu capital y posición actual:

```json
{
  "capitalDisponible": 467587.55,
  "position": {
    "ticker": "T30J7",
    "entryPrice": 1.1200,
    "vn": 417310,
    "entryDate": "05/05/2025",
    "precioConComision": 1.1234
  },
  "config": {
    "caucion1d": 21.0,
    "caucion7d": 19.2,
    "caucion30d": 18.5,
    "comisionTotal": 0.30
  }
}
```

Ver el **Manual de Operación** para detalles de cada campo.

---

## PASO 9: Iniciar el Servidor

```bash
npm run dev
```

Abrí tu navegador en `http://localhost:3000`

Deberías ver la pantalla de carga con "Cargando V4.0 BLINDADO..." y luego
el dashboard principal.

---

## VERIFICACIÓN POST-INSTALACIÓN

### ✅ Checklist de Verificación

1. **Radar carga correctamente** → Página principal muestra instrumentos
2. **Indicador FILE** → Esquina superior izquierda, punto verde "FILE"
   - Si dice "FILE?" → portfolio.json no se encontró, usando localStorage
   - Si dice "FILE✗" → No hay archivo ni localStorage, usando defaults
3. **Indicador L2** → Estado de IOL:
   - `L2` (violeta) → IOL conectado y funcionando ✅
   - `L2✗` (gris) → Sin credenciales en .env (funciona sin IOL)
   - `L2⚠` (naranja) → Credenciales presentes pero auth falló
4. **Indicador MT** → Market Truth Engine:
   - `MT` (verde) → RP y MEP con confianza ALTA ✅
   - `MT` (amarillo) → Confianza MEDIA
   - `STALE` (naranja) → Datos pueden estar desactualizados
5. **Gráficos históricos** → Tab "Histórico" muestra datos de Neon
6. **Precios en vivo** → Tab "Mercado" muestra precios actualizados

### 🔍 Diagnóstico IOL

Para verificar si el puente IOL está funcionando:

```bash
curl http://localhost:3000/api/iol-status
```

Respuestas esperadas:
- `"status": "online"` → ✅ IOL conectado
- `"status": "not_configured"` → Sin credenciales
- `"status": "auth_failed"` → Credenciales incorrectas
- `"status": "circuit_breaker_locked"` → Demasiados intentos fallidos

### 🔍 Diagnóstico Neon

```bash
curl http://localhost:3000/api/price-history
```

Si devuelve `"available": true` y `"totalOHLC": 433` → ✅ Neon funciona.

---

## SOLUCIÓN DE PROBLEMAS

### "La página carga pero no hay datos"

1. Verificá que el servidor esté corriendo (`npm run dev`)
2. Abrí la consola del navegador (F12 → Console)
3. Buscá errores rojos
4. Esperá 30 segundos — el orquestador de APIs arranca con delay

### "IOL muestra L2⚠ (naranja)"

1. Verificá las credenciales en `.env`:
   - ¿Usaste comillas dobles en la contraseña?
   - ¿Hay caracteres especiales sin comillas?
2. Reiniciá el servidor: Ctrl+C y `npm run dev` otra vez
3. Verificá con: `curl http://localhost:3000/api/iol-status`
4. Si dice `circuit_breaker_locked`, reseteá:
   ```bash
   curl -X POST http://localhost:3000/api/iol-status
   ```

### "Los gráficos históricos no muestran datos"

1. Verificá `ENABLE_DB=true` en `.env`
2. Verificá que `DATABASE_URL` sea correcta
3. Corré `npx prisma db push` para sincronizar
4. Verificá: `curl http://localhost:3000/api/price-history`

### "El servidor crashea con muchas requests"

Esto no debería pasar en V4.0 — el orquestador de APIs hace las
consultas SECUENCIALMENTE (una por vez) con delays entre cada una.
Si igual crashea, probablemente sea un problema de memoria:
- Cerrá otras pestañas del navegador
- Reiniciá el servidor

### "Mi cartera no aparece"

1. Verificá que `data/portfolio.json` exista y tenga datos válidos
2. El archivo se lee al arrancar — si lo editaste, reiniciá el servidor
3. Verificá el indicador FILE en la esquina superior

---

## ARQUITECTURA V4.0 — Resumen Rápido

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (React)                  │
│         Zustand Store ←→ localStorage               │
│              ↓ inicialización                        │
│     portfolio.json (GET /api/portfolio)              │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────┴────────┐
              │  API Routes     │
              │  (Next.js)      │
              └──┬────┬────┬───┘
                 │    │    │
     ┌───────────┘    │    └───────────┐
     │                │                │
┌────▼────┐   ┌──────▼──────┐   ┌─────▼─────┐
│  NEON   │   │ APIs VIVAS  │   │    IOL    │
│(lectura)│   │ (tiempo     │   │  Level-2  │
│ OHLC    │   │  real)      │   │  (auth)   │
│433 regs │   │             │   │           │
│         │   │ • data912   │   │ • puntas  │
│ NUNCA   │   │ • ArgDatos  │   │ • depth   │
│ guardar │   │ • DolarAPI  │   │ • pressure│
│ cartera │   │ • BondTerm  │   │           │
└─────────┘   └─────────────┘   └───────────┘
                       │
              ┌────────▼────────┐
              │ portfolio.json  │
              │ (LOCAL FILE)    │
              │ • capital       │
              │ • posición      │
              │ • configuración │
              │ NUNCA se auto-  │
              │ guarda          │
              └─────────────────┘
```

**Principio:** Data Intelligence ≠ Data Persistence
- Neon = solo lectura histórica (gráficos)
- APIs = datos en tiempo real (precios, RP, MEP)
- portfolio.json = tu cartera, vos lo editás, el radar lo lee
