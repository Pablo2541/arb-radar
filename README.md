# ARB//RADAR V3.2 — Módulo de Acumulación Histórica + Cerebro Táctico

> Dashboard de arbitraje de renta fija argentina con motor de datos híbrido, validación IOL Nivel 2 y acumulación histórica automática.

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────┐
│  Navegador (Vercel / Local)                              │
│  ├── Next.js Dashboard — 10 pestañas operativas          │
│  ├── Zustand Store ←→ localStorage ←→ Neon DB (60s)     │
│  ├── 📜 Histórico — AreaChart/BarChart desde DailyOHLC  │
│  └── IOL L2 Indicator — Púrpura/Gray en header          │
├──────────────────────────────────────────────────────────┤
│  Cerebro Táctico (Node.js — Terminal Local / PC)         │
│  ├── Nivel 1: data912.com + ArgentinaDatos (precios)    │
│  ├── Nivel 2: InvertirOnline API (volumen/depth)        │
│  ├── Filtro de Verdad — Hunting Score (-15 a +8)        │
│  ├── PriceSnapshot — Cada tick (~60s en horario mercado) │
│  └── DailyOHLC — Agregación diaria (upsert automático)  │
├──────────────────────────────────────────────────────────┤
│  Neon PostgreSQL (Serverless)                            │
│  ├── AppState — Estado de la app (instrumentos, config)  │
│  ├── PriceSnapshot — Registros crudos por tick           │
│  ├── DailyOHLC — OHLC diario por ticker                  │
│  └── Auto-cleanup de snapshots >7 días                   │
└──────────────────────────────────────────────────────────┘
```

## Instalación Rápida (Plug & Play)

```bash
# 1. Descomprimir el ZIP
unzip ARB-RADAR-V3.2.zip
cd arb-radar

# 2. Copiar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales (DATABASE_URL y IOL)

# 3. Instalar dependencias
npm install

# 4. Generar cliente Prisma
npx prisma generate

# 5. Crear tablas en la base de datos (incluye PriceSnapshot + DailyOHLC)
npx prisma db push

# 6. Iniciar el dashboard web
npm run dev
# → Abrir http://localhost:3000

# 7. (Opcional) Iniciar el Cerebro Táctico en modo daemon
npm run prices:daemon
# → Captura precios cada 60s durante horario de mercado
# → Guarda PriceSnapshot + DailyOHLC automáticamente
# → La pestaña 📜 Histórico comenzará a mostrar datos
```

## Variables de Entorno (.env)

```env
# ── Base de datos (Neon PostgreSQL) ──────────────────────
# Requerida para persistencia + acumulación histórica V3.2.
# Si no se configura, la app usa localStorage (modo zero config).
DATABASE_URL="postgresql://usuario:password@host/neondb?sslmode=require"

# ── IOL Nivel 2 (InvertirOnline) ─────────────────────────
# Opcional. Si no se configura, opera solo con Nivel 1.
# Obtén tus credenciales en: https://invertironline.com
IOL_USERNAME=""
IOL_PASSWORD=""
```

## Pestañas Operativas

| # | Pestaña | Icono | Descripción |
|---|---------|-------|-------------|
| 1 | Mercado | 📊 | Overview en tiempo real con datos LIVE |
| 2 | Oportunidades | 🎯 | Hunting Score V2 con Filtro de Verdad |
| 3 | Curvas | 📈 | Curva de rendimientos y anomalías |
| 4 | Arbitraje | 🔄 | Análisis de rotación entre instrumentos |
| 5 | Estrategias | ⚡ | Señales compuestas y momentum |
| 6 | Cartera | 💼 | Gestión de posición y P&L |
| 7 | Diagnóstico | 🩺 | Estado general del radar |
| 8 | Historial | 📋 | Log de transacciones y operaciones |
| 9 | Histórico | 📜 | **V3.2**: Gráficos de TEM/Precio/Spread/Volumen |
| 0 | Config | ⚙️ | Configuración manual y carga de datos |

## Motor de Datos Híbrido

### Nivel 1 — Precios Base (data912 + ArgentinaDatos)
- **data912.com**: Precios de LECAPs y BONCAPs en tiempo real (bid/ask/volumen)
- **ArgentinaDatos**: VPV, vencimiento, TEM emisión, tasas de plazo fijo
- Sin autenticación, rate limit ~120 req/min

### Nivel 2 — Validación de Volumen (InvertirOnline)
- **IOL API**: Cantidad operada, puntas de compra/venta, volumen real
- Autenticación OAuth2 (token de 15min, auto-refresh a 14min)
- Procesamiento en batches de 5 para respetar rate limits

### Filtro de Verdad — Hunting Score Adjustment

| Condición | Ajuste | Veredicto |
|-----------|--------|-----------|
| Spread alto + baja liquidez | **-15** | ⚠️ BAJA LIQUIDEZ |
| Spread positivo + volumen creciente | **+8** | ✅ CONFIRMADO |
| Volumen OK, spread marginal | **+3** | 📊 Volumen OK |
| Alerta de liquidez | **-8** | ⚠️ ALERTA LIQUIDEZ |
| Sin señal clara | **0** | 📡 Sin señal |

## Módulo de Acumulación Histórica (V3.2)

### PriceSnapshot
- Un registro por instrumento por tick (~60s durante horario de mercado)
- Incluye: precio, bid/ask, TEM, TIR, TNA, spread, volumen, datos IOL Nivel 2
- Auto-cleanup: se eliminan registros >7 días automáticamente
- Índices: `[ticker]`, `[timestamp]`, `[ticker, timestamp]`

### DailyOHLC
- Un registro por ticker por día de trading
- OHLC de precio y TEM por separado
- Volumen promedio y conteo de ticks
- Unique constraint: `[ticker, date]` — upsert automático
- Se conserva indefinidamente (base para análisis técnico)

### API Endpoint: `/api/price-history`

```
GET /api/price-history?ticker=S30O6&days=30&format=ohlc
GET /api/price-history?days=30&format=ohlc        # Todos los tickers
GET /api/price-history?ticker=T15J7&days=7&format=snapshots
```

## Scripts

```bash
# Una sola actualización de precios
npm run prices:update

# Daemon continuo (cada 60s, solo horario de mercado argentino 10-17hs)
npm run prices:daemon

# Push del schema a la base de datos
npm run db:push

# Regenerar cliente Prisma
npm run db:generate
```

## Stack Tecnológico

- **Framework**: Next.js 16.1 + App Router + React 19 + TypeScript 5
- **State**: Zustand 5 (3-layer: Zustand → localStorage → Neon DB)
- **Database**: Prisma 6 + Neon PostgreSQL (serverless)
- **UI**: Tailwind CSS 4 + shadcn/ui + Recharts 3 + Framer Motion
- **Data**: data912.com + ArgentinaDatos + InvertirOnline API
- **Runtime**: Bun (desarrollo) / Node.js (producción)

## Indicadores del Header

| Indicador | Color | Significado |
|-----------|-------|-------------|
| DB Sync | 🟢 Verde | DB sincronizada correctamente |
| DB Sync | 🟡 Amarillo | Sincronizando... |
| DB Sync | 🔴 Rojo | Error de conexión |
| IOL L2 | 🟣 Púrpura pulsante | IOL Nivel 2 ONLINE |
| IOL L2 | ⚪ Gray | IOL Nivel 2 OFFLINE |
| Mercado | 🟢 Verde pulsante | Horario de mercado abierto |
| Mercado | ⚪ Gray | Mercado cerrado |

## Atajos de Teclado

| Atajo | Acción |
|-------|--------|
| `Alt+1` a `Alt+9` | Cambiar a pestaña 1-9 |
| `Alt+0` | Ir a Configuración |
| `Alt+T` | Alternar tema claro/oscuro |
| `?` | Mostrar ayuda |
| `Escape` | Cerrar diálogos |

---

**ARB//RADAR V3.2** — Argentine Fixed-Income Arbitrage Radar
*Motor de datos híbrido + Módulo de acumulación histórica + Cerebro Táctico*
