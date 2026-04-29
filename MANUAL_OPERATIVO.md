# ARB//RADAR V1.8.1 — Manual de Usuario y Referencia Técnica

> **Versión**: V1.8.1 "Tactical Aggression"
> **Última actualización**: 2026-04-19
> **Alcance**: Este manual documenta la totalidad del dashboard ARB//RADAR desde la V1.6.5 hasta la V1.8.1, incluyendo la Bifurcación Táctica, el Hunting Score V2.0 y todas las señales de operación.

---

## Tabla de Contenidos

1. [Filosofía del Dashboard — Bifurcación Táctica](#1-filosofía-del-dashboard--bifurcación-táctica)
2. [Guía de Señales y Badges — El Semáforo](#2-guía-de-señales-y-badges--el-semáforo)
3. [El Motor de Cálculo — Glosario Técnico](#3-el-motor-de-cálculo--glosario-técnico)
4. [Protocolo de Operación — Workflow](#4-protocolo-de-operación--workflow)
5. [Consideraciones de Riesgo](#5-consideraciones-de-riesgo)
6. [Apéndice A — Arquitectura de Pestañas](#6-apéndice-a--arquitectura-de-pestañas)
7. [Apéndice B — Historial de Versiones](#7-apéndice-b--historial-de-versiones)

---

## 1. Filosofía del Dashboard — Bifurcación Táctica

### 1.1 El Problema Central

En el mercado de LECAPs y BONCAPs argentinos, un mismo instrumento puede ser evaluado de dos maneras opuestas según el horizonte temporal del inversor:

- Un **carry trader** busca cobrar el cupón mensual con el menor riesgo posible. Le interesa el spread vs caución, la duración y la estabilidad.
- Un **arbitrajista** busca capturar ineficiencias de precio en el corto plazo. Le interesa el momentum (ΔTIR), las anomalías de curva y la velocidad de recupero de comisión.

El ARB//RADAR V1.8.1 resuelve esta tensión con la **Bifurcación Táctica**: dos pestañas que comparten el mismo universo de datos pero aplican lógicas de evaluación radicalmente distintas.

### 1.2 Tab Estrategias — Enfoque Conservador / Carry

| Dimensión | Comportamiento |
|-----------|---------------|
| **Horizonte** | Medio-largo plazo (30-273 días) |
| **Objetivo** | Maximizar carry neto de comisiones |
| **Señal principal** | Composite Signal (25% Momentum + 35% Spread + 25% Duración + 15% G/día) |
| **Umbral de acción** | Spread neto > 0.10% para considerar atractivo |
| **Actitud frente al tiempo** | El tiempo es aliado: más días = más carry cobrado |
| **Warning de TRAMPA** | Se muestra pero no bloquea la ejecución |
| **S/R** | Se usa para confirmar zona de entrada (soporte < 1% = COMPRA) |
| **Momentum** | Considerado pero no determinante (peso 25%) |
| **Sub-vistas** | Swing Trading + DayTrade |

**Cuándo usar Estrategias**: Tenés una posición abierta y querés saber si mantenerla, rotar a mejor carry o vender. La pregunta es *"¿este instrumento me paga suficiente vs la caución por el riesgo que asumo?"*

### 1.3 Tab Arbitraje — Enfoque Agresivo / Scalping

| Dimensión | Comportamiento |
|-----------|---------------|
| **Horizonte** | Corto plazo (horas a días) |
| **Objetivo** | Capturar saltos de tasa y anomalías antes de que el mercado corrija |
| **Señal principal** | Hunting Score V2.0 (70% Momentum+Upside + 30% Carry) |
| **Umbral de acción** | Payback ≤ 2 días para "SALTO TÁCTICO" |
| **Actitud frente al tiempo** | El tiempo es enemigo: más días de payback = más riesgo de reversión |
| **Warning de TRAMPA** | Se elimina — si la tasa sube y el upside existe, se ejecuta |
| **S/R** | Se usa para medir "Upside Residual" (cuánto espacio hay hasta resistencia) |
| **Momentum** | Factor dominante (peso 70% combinado con Upside) |
| **Sub-vistas** | Oportunidades Maestras + Tapados + Matriz Todos-contra-Todos |

**Cuándo usar Arbitraje**: El mercado se mueve, las tasas saltan, y querés saber si hay un "regalo" que capturar ahora mismo. La pregunta es *"¿hay una ineficiencia de precio que pueda explotar antes de que se corrija?"*

### 1.4 ¿Por Qué una Señal Puede Ser "Mantener" en una Pestaña y "Ejecución Rápida" en la Otra?

**Ejemplo real**: LECAP S30O6 con TEM 2.15%, spread vs caución +0.72%.

| Evaluación | Estrategias | Arbitraje |
|------------|-------------|-----------|
| **Señal** | COMPRA (score 6.2/10) | SALTO TÁCTICO |
| **Razón** | Spread muy atractivo, carry sólido | ΔTIR +0.08% + upside residual 2.3% + payback 1.2d |
| **Acción** | Comprar y mantener | Entrar rápido, monitorear reversión |

El instrumento es "bueno" en ambos contextos, pero la **intensidad y urgencia** difieren. Estrategias dice *"es una buena inversión a mediano plazo"*; Arbitraje dice *"hay fuego ahora, entrá antes de que se apague"*.

**Ejemplo inverso**: BONCAP con TEM 1.58%, spread vs caución +0.05%, pero ΔTIR +0.12% y resistencia lejana.

| Evaluación | Estrategias | Arbitraje |
|------------|-------------|-----------|
| **Señal** | NEUTRAL / EVITAR | OPORTUNIDAD DE CAPTURA |
| **Razón** | Spread marginal, carry casi nulo vs comisión | Momentum fuerte, el precio se está hundiendo = oportunidad de compra |
| **Acción** | No entrar | Evaluar entrada rápida con stop estricto |

En Estrategias, el spread insuficiente lo hace poco atractivo para carry. En Arbitraje, el momentum alcista de tasa (precio cayendo) señala una oportunidad de captura.

### 1.5 Tabla Comparativa de Bifurcación

| Criterio | Estrategias (Conservador) | Arbitraje (Agresivo) |
|----------|--------------------------|---------------------|
| Score motor | Composite Signal (25/35/25/15) | Hunting Score V2 (70/30) |
| Spread mínimo relevante | > 0.10% | > 0.05% neto post-comisión |
| Payback tolerable | < 30 días | ≤ 2 días (SALTO TÁCTICO) |
| ΔTIR umbral | > +0.02% para impulsar score | > 0% basta para considerar |
| TRAMPA | Advertencia, no bloquea | No se muestra (irrelevante) |
| Upside Residual | No se calcula | Factor principal (peso ~35%) |
| Acción default | MANTENER | EVALUAR / EJECUTAR |
| Labels acción | COMPRA / NEUTRAL / EVITAR | SALTO TÁCTICO / EJECUCIÓN RÁPIDA / NO CONVIENE |
| S/R uso | Zona de entrada/venta | Medida de upside restante |

---

## 2. Guía de Señales y Badges — El Semáforo

### 2.1 Badges de la Tab Arbitraje (V1.8.1)

| Badge | Color | Condición | Significado |
|-------|-------|-----------|-------------|
| 🚀 **SALTO TÁCTICO** | `#2eebc8` (verde intenso) | Spread neto > 0.25% **Y** Payback ≤ 2 días **Y** ΔTIR > 0 | Oportunidad excepcional: la tasa saltó, la comisión se recupera en ≤48h, y el momentum confirma. Entrar de inmediato. |
| 🟢 **OPORTUNIDAD DE CAPTURA** | `#00d4aa` (verde) | Spread neto > 0.10% **Y** ΔTIR > 0 **Y** Upside Residual > 1% | Ineficiencia de precio activa. La tasa está subiendo (precio bajando) y hay espacio hasta resistencia. Entrar con monitoreo. |
| 🟡 **EJECUCIÓN RÁPIDA** | `#fbbf24` (amarillo) | Spread neto > 0.05% **Y** (ΔTIR > 0 **O** Upside Residual > 0.5%) | Señal marginal pero con algún factor de momentum o upside. Evaluar con datos frescos. |
| 🔴 **NO CONVIENE** | `#f87171` (rojo) | Spread neto ≤ 0.05% **O** Payback > 30 días | La comisión come la ganancia o el recupero es demasiado lento para un enfoque de scalping. No entrar. |

### 2.2 Badges de la Tab Estrategias (Conservador)

| Badge | Color | Condición | Significado |
|-------|-------|-----------|-------------|
| 🟢🟢 **COMPRA FUERTE** | `#00d4aa` | Composite Score ≥ 7.5 | Máxima convicción: momentum alcista, spread amplio, duración adecuada, G/día alto. |
| 🟢 **COMPRA** | `#00d4aa` | Composite Score ≥ 5.5 | Buena oportunidad de carry. Spread positivo, momentum favorable. |
| 🟡 **NEUTRAL** | `#ffd700` | Composite Score ≥ 3.5 | No hay señal clara. Mantener si ya se está dentro, no entrar si se está afuera. |
| 🔴 **VENDER** | `#ff6b9d` | Composite Score ≥ 2.0 | Señal de salida. Spread comprimido o momentum negativo. |
| 🔴🔴 **EVITAR** | `#ff4444` | Composite Score < 2.0 | El instrumento rinde por debajo de la caución o tiene momentum fuertemente negativo. |

### 2.3 Badges de Evaluación de Rotación (Ambas Tabs)

| Evaluación | Spread Neto | Color | Emoji | Contexto |
|------------|-------------|-------|-------|----------|
| **MUY ATRACTIVO** | > 0.25% | `#2eebc8` | 🟢 | Rotar de inmediato. La ganancia neta post-comisión es sustancial. |
| **ATRACTIVO** | > 0.15% | `#00d4aa` | 🟢 | Rotar con confianza. El spread cubre holgadamente la comisión. |
| **MARGINAL** | > 0.05% | `#ffd700` | 🟡 | Rotar solo si hay convicción adicional (momentum, anomalía). |
| **NO CONVIENE** | ≤ 0.05% | `#f87171` | 🔴 | La comisión absorbe la ganancia. No rotar. |
| **TRAMPA** | toTEM < fromTEM | `#f87171` | ⚠️ | Rotar a un instrumento de MENOR rendimiento. Nunca ejecutar salvo estrategia deliberada. |

### 2.4 Señales de Spread vs Caución

| Señal | Spread | Color | Emoji | Interpretación |
|-------|--------|-------|-------|----------------|
| **MUY ATRACTIVO** | > 0.40% | `#00d4aa` | 🟢 | Prima por riesgo excepcional. Muy por encima de la caución. |
| **ATRACTIVO** | > 0.25% | `#00d4aa` | 🟢 | Buena compensación por el riesgo asumido. |
| **MARGINAL** | > 0.10% | `#ffd700` | 🟡 | Apenas compensa. Sensible a cambios de tasa. |
| **EVITAR** | ≤ 0.10% | `#ff4444` | 🔴 | No compensa el riesgo vs la alternativa libre de riesgo (caución). |

### 2.5 Umbrales Clave Explicados

#### ¿Qué significa un spread neto de 0.10%?

El **spread neto** es el rendimiento excedente que obtenés por sobre la caución, **después de descontar la comisión de rotación amortizada**.

```
spread neto = TEM instrumento − TEM caución − comisión amortizada
```

- **0.10%** = $100 de excedente por cada $100,000 invertidos, **por mes**.
- En 12 meses, ese spread compuesto significa ~1.2% adicional anual.
- Si la comisión total es 0.30% y el instrumento tiene 90 días, la comisión amortizada es 0.10%/mes → **el spread neto se reduce a la mitad**.
- Un spread de 0.10% es el umbral mínimo para que la operación tenga sentido económico.

#### ¿Qué implica un Payback < 2 días?

El **payback** (días de punto de equilibrio) indica cuántos días de mayor carry necesitas para recuperar la comisión de rotación.

```
payback = (comisión total / |spread bruto|) × 30
```

- **< 2 días**: La rotación se paga sola en menos de 48 horas. Después de eso, cada día adicional es ganancia neta.
- **2-10 días**: Razonable para Estrategias, riesgoso para Arbitraje.
- **> 30 días**: El mercado tiene mucho tiempo para revertirse antes de que recuperes la comisión.

Cuando el payback es ≤ 2 días, el badge **SALTO TÁCTICO** se activa en la Tab Arbitraje, indicando que la oportunidad es tan clara que el costo de entrada es irrelevante.

### 2.6 Labels de Momentum

| ΔTIR | Tendencia | Color | Flecha |
|------|-----------|-------|--------|
| > +0.30% | Alcista Fuerte | `#2eebc8` | ↑↑ |
| > +0.10% | Alcista | `#2eebc8` | ↑ |
| ±0.10% | Lateral | `#7a8599` | → |
| < −0.10% | Bajista | `#f87171` | ↓ |
| < −0.30% | Bajista Fuerte | `#f87171` | ↓↓ |

**Nota**: ΔTIR > +0.02% muestra flecha verde; < −0.02% muestra flecha roja en la tabla de Mercado.

### 2.7 Labels de Duración / Sensibilidad

| |durMod| Score | Sensibilidad | Color |
|---------|-------|-------------|-------|
| > 0.50 | > 7 | Alta | `#f87171` (rojo) |
| 0.20-0.50 | 4-7 | Media | `#fbbf24` (amarillo) |
| < 0.20 | ≤ 4 | Baja | `#2eebc8` (verde) |

**Alta sensibilidad** = el precio se mueve mucho ante cambios de tasa. Es bueno si comprás y las tasas bajan (precio sube), malo si las tasas suben (precio cae).

### 2.8 Alertas Globales (ThresholdAlerts)

| Alerta | Condición | Nivel | Icono |
|--------|-----------|-------|-------|
| **TRAMPA (no en cartera)** | TEM instrumento < TEM caución | ⚠️ Warning | ⚠️ |
| **TRAMPA (en cartera)** | TEM posición < TEM caución | 🚨 Danger | 🚨 |
| **Momentum Negativo** | ΔTIR < −0.15% en posición activa | ⚠️ Warning | 📉 |
| **Spread Comprimido** | 0 < spread < 0.05% en posición activa | ℹ️ Info | 💨 |
| **Riesgo País PELIGRO** | Riesgo país > 650 pb | 🚨 Danger | 🔴 |
| **Riesgo País ALERTA** | Riesgo país > 550 pb | ⚠️ Warning | 🟡 |
| **Zona Roja TEM** | TEM ≤ 1.6% (≈ caución 1d) | Indicador de fila | ⚠️ |

---

## 3. El Motor de Cálculo — Glosario Técnico

### 3.1 Hunting Score V2.0 (Tab Arbitraje)

El Hunting Score V2.0 es el motor de señales de la Tab Arbitraje. Reemplaza al Composite Signal (V1.5) con una ponderación que prioriza la velocidad y el upside por sobre el carry estable.

#### Ponderación

| Componente | Peso | Rango | Descripción |
|------------|------|-------|-------------|
| **Momentum Score** | 35% | 0-10 | Basado en ΔTIR y aceleración de tasa |
| **Upside Residual** | 35% | 0-10 | Espacio porcentual hasta la resistencia de 15 días |
| **Carry Score** | 30% | 0-10 | Spread vs caución + G/día neta |

```
Hunting Score = momentumScore × 0.35 + upsideResidual × 0.35 + carryScore × 0.30
```

#### ¿Por qué 70/30?

El 70% conjunto (Momentum + Upside) responde a la pregunta *"¿hay algo moviéndose ahora que pueda capturar?"*. El 30% (Carry) actúa como filtro de calidad: asegura que el instrumento al menos rinda por encima de la caución, pero no requiere que sea el mejor carry del mercado.

| Escenario | Momentum | Upside | Carry | Score | Badge |
|-----------|----------|--------|-------|-------|-------|
| Tasa saltó, precio en soporte, buen carry | 8 | 9 | 7 | 8.05 | 🚀 SALTO TÁCTICO |
| Tasa subiendo, upside moderado, carry marginal | 6 | 5 | 3 | 4.85 | 🟡 EJECUCIÓN RÁPIDA |
| Tasa estable, sin upside, buen carry | 2 | 1 | 8 | 3.30 | 🔴 NO CONVIENE (en Arbitraje) |
| Tasa saltó, pero en resistencia | 8 | 1 | 7 | 5.25 | 🟡 EJECUCIÓN RÁPIDA |

**El caso clave**: un instrumento con excelente carry pero sin momentum ni upside obtiene score bajo en Arbitraje (3.30 → NO CONVIENE) pero score alto en Estrategias (7+ → COMPRA). Esto es la Bifurcación Táctica en acción.

### 3.2 Upside Residual

El **Upside Residual** mide cuánto espacio de precio existe entre el precio actual y la resistencia de 15 días, expresado como porcentaje.

#### Cálculo

```
upsideResidual = ((resistencia15d − precioActual) / precioActual) × 100
```

Donde `resistencia15d` es el precio máximo de los últimos 15 días de trading (5 días en la implementación actual, extensible a 15).

#### Normalización a Score 0-10

```
upsideScore = min(upsideResidual / upsideMax, 1) × 10
```

Donde `upsideMax` es el upside residual máximo observado en el universo de instrumentos.

#### Interpretación

| Upside Residual | Score | Significado |
|----------------|-------|-------------|
| > 3% | 8-10 | El precio está muy lejos de la resistencia. Mucho espacio para subir. |
| 1-3% | 4-7 | Espacio moderado. Hay margen pero no es excepcional. |
| < 1% | 0-3 | El precio está cerca de la resistencia. Upside limitado, riesgo de rebote. |
| < 0% | 0 | El precio superó la resistencia. Posible breakout o dato ruidoso. |

**En contexto Arbitraje**: Un upside residual alto + momentum positivo = el precio se está hundiendo (tasa subiendo) y aún no tocó fondo. Eso es una **oportunidad de compra** si creés que el mercado va a corregir.

**Upside Residual bajo cerca de resistencia**: El precio se está apreciando y está llegando al techo. En Arbitraje, esto reduce el atractivo porque el upside se está agotando.

### 3.3 Soporte y Resistencia (S/R)

#### Cálculo

El motor de S/R utiliza los últimos 5 días de trading del `historico_precios.json`:

- **Soporte** = precio mínimo de los últimos 5 días
- **Resistencia** = precio máximo de los últimos 5 días
- **Distancia al Soporte** = `((precioActual − soporte) / soporte) × 100`
- **Distancia a Resistencia** = `((resistencia − precioActual) / precioActual) × 100`

Fallback (sin historial): soporte = precio × 0.98, resistencia = precio × 1.02

#### Zonas S/R

| Condición | Zona | Acción |
|-----------|------|--------|
| distanciaSoporte < 1.0% | **COMPRA** 🟢 | El precio está en zona de soporte. Buen punto de entrada. |
| distanciaResistencia < 1.0% | **VENTA** 🔴 | El precio está en zona de resistencia. Considerar toma de ganancias. |
| Entre ambas | **NEUTRAL** 🟡 | Ni soporte ni resistencia cercanos. |

#### Barra Visual de Rango S/R

La posición en el rango se calcula como:

```
posiciónEnRango = ((precioActual − soporte) / (resistencia − soporte)) × 100
```

**Normalización importante (V1.8.1)**: Este valor se acota a `[0, 100]` mediante `Math.min(resultado, 100)` para evitar el bug visual de 9900% que ocurría cuando los precios no estaban normalizados (escala 100:1 vs 1:1).

#### Porcentaje de Ubicación en el Rango — Cómo Leerlo

| % en rango | Posición | Interpretación |
|------------|----------|----------------|
| 0-10% | Fondo del rango | Precio en zona de soporte. Máximo upside residual. |
| 40-60% | Medio del rango | Precio en zona neutral. Upside y downside equilibrados. |
| 90-100% | Tope del rango | Precio en zona de resistencia. Upside residual mínimo. |

### 3.4 Normalización de Escala (100:1 vs 1:1)

#### El Problema

Los LECAPs y BONCAPs cotizan en dos escalas distintas:

- **Escala 1:1**: LECAPs cortos (ej. S30J6 a $1.15) — precio ≈ 1
- **Escala 100:1**: BONCAPs y LECAPs largos (ej. T2X3 a $115.40) — precio ≈ 100

Cuando el motor calcula `posiciónEnRango = ((precio − soporte) / (resistencia − soporte)) × 100`, mezclar instrumentos de distinta escala sin normalizar produce valores absurdos (ej. 9900%).

#### La Solución

1. **Detección automática de escala**: `detectScaleFactor()` analiza el precio promedio del universo. Si el promedio > 50, aplica factor 100 (÷100); si no, factor 1.
2. **Normalización previa al cálculo**: Antes de calcular la posición en el rango, los precios se dividen por el factor de escala detectado.
3. **Cap explícito**: `Math.min(resultado, 100)` garantiza que el valor visual nunca supere 100%.

```
// Pseudocódigo
const scaleFactor = detectScaleFactor(allInstruments); // 1 o 100
const normalizedPrice = price / scaleFactor;
const normalizedSupport = support / scaleFactor;
const normalizedResistance = resistance / scaleFactor;
const positionInRange = Math.min(
  ((normalizedPrice - normalizedSupport) / (normalizedResistance - normalizedSupport)) * 100,
  100
);
```

**Regla práctica**: Si ves un valor de S/R > 100%, es un bug de normalización. Reportalo.

### 3.5 Composite Signal (Tab Estrategias)

El Composite Signal es el motor de la Tab Estrategias y del Diagnóstico. Funciona con ponderación equilibrada:

```
compositeScore = momentumScore × 0.25 + spreadScore × 0.35 + durationScore × 0.25 + gDiaScore × 0.15
```

| Componente | Peso | Cálculo | Rango |
|------------|------|---------|-------|
| **Momentum** | 25% | `map(change, [-2%, +2%]) → [0, 10]` | 0-10 |
| **Spread vs Caución** | 35% | `map(spread, [-1%, +2%]) → [0, 10]` | 0-10 |
| **Duración** | 25% | `(|durMod| / maxDur) × 10` | 0-10 |
| **G/día Neta** | 15% | `(gDiaNeta / maxGDia) × 10` | 0-10 |

### 3.6 G/día Neta

La ganancia diaria neta mide cuánto rendís por día después de descontar la comisión de entrada+salida:

```
gDiaNeta = ((1 + TEM/100)^(days/30.44) − 1 − comisionTotal/100) / days × 100
```

- Un G/día > 0 significa que el carry supera la comisión.
- Un G/día < 0 significa que la comisión excede el rendimiento total — **nunca entrar**.

### 3.7 Días de Recupero de Comisión

```
diasRecupero = (comisionTotal / 100) / ((TEM / 100) / 30.44)
```

| Días | Color | Significado |
|------|-------|-------------|
| < 5 | 🟢 Verde | Recupero inmediato. Entrar con confianza. |
| 5-10 | 🟡 Amarillo | Recupero razonable. Evaluar caso por caso. |
| > 10 | 🔴 Rojo | Recupero lento. Solo para carry de largo plazo. |

### 3.8 RAE (Rendimiento Anual Efectivo)

```
RAE = ((1 + TEM/100)^12 − 1) × 100
```

El RAE anualiza el TEM para comparar con otras inversiones. Un TEM de 2.15% mensual equivale a un RAE de ~29% anual.

### 3.9 Duración Modificada (Duration Modified)

```
durMod = −días / (365 × (1 + TEM/100))
```

- Siempre negativa (tasas suben → precios bajan).
- |durMod| > 0.5 → Alta sensibilidad (instrumento largo, >180 días)
- |durMod| < 0.2 → Baja sensibilidad (instrumento corto, <60 días)

### 3.10 Sensibilidad de Precio ante Cambios de Tasa

```
deltaPrice = −durMod × (deltaBps / 10000) × price
```

| Escenario | Δ Tasa | Δ Precio (S30O6, $1.155, durMod=−0.53) |
|-----------|--------|--------------------------------------|
| Baja 10pb | −0.10% | +$0.0061 → $1.161 |
| Baja 25pb | −0.25% | +$0.0153 → $1.170 |
| Sube 10pb | +0.10% | −$0.0061 → $1.149 |
| Sube 25pb | +0.25% | −$0.0153 → $1.140 |

### 3.11 Caución TEM

```
TEM = ((1 + TNA/100)^(1/12) − 1) × 100
```

Selección por plazo:

| Días del instrumento | Caución usada | Default TNA |
|---------------------|---------------|-------------|
| ≤ 7 días | caución 1d | 21.0% |
| 8-45 días | caución 7d | 19.2% |
| > 45 días | caución 30d | 18.5% |

### 3.12 Análisis de Rotación

```
spreadBruto = TEM destino − TEM actual
comisionAmortizada = comisionTotal / (díasDestino / 30)
spreadNeto = spreadBruto − comisionAmortizada
payback = (comisionTotal / |spreadBruto|) × 30
```

### 3.13 Delta TIR (ΔTIR) — Velocidad de Cambio

```
ΔTIR = TIR_actual − TIR_snapshot_anterior
```

- Se calcula entre snapshots consecutivos (máximo 10 en memoria).
- **null** = sin base de comparación (primer snapshot o instrumento nuevo).
- ΔTIR > 0 → la tasa está subiendo, el precio está bajando = posible oportunidad de compra.
- ΔTIR < 0 → la tasa está bajando, el precio está subiendo = el instrumento se aprecia.

### 3.14 Aceleración — 2da Derivada

```
Aceleración = ΔTIR_n − ΔTIR_{n-1}
```

| Aceleración | Interpretación |
|-------------|---------------|
| > +0.02% | ↑↑ Aceleración fuerte — la tasa sube cada vez más rápido |
| > 0% | Tendencia alcista acelerándose |
| ≈ 0% | → Estable — movimiento lineal |
| < 0% | Desaceleración — la tasa sube más lento o empieza a bajar |
| < −0.02% | ↓↓ Desaceleración fuerte |

### 3.15 Detección de Anomalías de Curva

El motor detecta 4 tipos de anomalías usando regresión lineal de TEM vs Días como baseline estadístico:

| Tipo | Detección | Severidad | Acción |
|------|-----------|-----------|--------|
| **INVERSION** | Instrumento largo tiene MENOR TEM que uno corto | CRITICA / ALTA / MEDIA | EVITAR / EVALUAR_SALIDA / MONITOREAR |
| **APLANAMIENTO** | Pendiente del segmento < 30% de la esperada, desviación > 2σ | MEDIA | PRECAUCION |
| **SALTO_ANORMAL** | Gap de tasa positivo, desviación > 2σ | ALTA (>3σ) / MEDIA | EVALUAR_SALIDA / PRECAUCION |
| **HUECO** | Gap > 60 días sin instrumentos | MEDIA | MONITOREAR |

**INVERSION siempre se marca** independientemente de la desviación σ — es una regla lógica, no estadística.

### 3.16 Detcción de Tapados (Oportunidades en Desarrollo)

Un instrumento es "tapado" cuando:

1. ΔTIR es positivo Y persistente (al menos 2 snapshots consecutivos con delta positivo)
2. Spread vs caución es positivo pero marginal (`0 < spread < comisionTotal/100`)

Significado: la tasa está subiendo (precio bajando) pero aún no cruzó el umbral de rentabilidad post-comisión. Es una señal anticipada — el instrumento podría ser rentable próximamente.

---

## 4. Protocolo de Operación — Workflow

### 4.1 Workflow de Rotación Usando el Rotation Portal

El Rotation Portal (accesible desde la Tab Cartera) permite simular y ejecutar rotaciones paso a paso.

#### Paso 1: Identificar la Oportunidad

1. Abrir la **Tab Arbitraje** (para enfoque agresivo) o **Tab Estrategias** (para carry).
2. Revisar las **Oportunidades Maestras** (top 3 filtradas) o las señales compuestas.
3. Si hay un badge 🚀 **SALTO TÁCTICO** o 🟢 **OPORTUNIDAD DE CAPTURA**, anotar el ticker destino.

#### Paso 2: Verificar con la Matriz Todos-contra-Todos

1. En la Tab Arbitraje, ir a la sección "Matriz de Rotación".
2. Buscar la intersección de tu posición actual (fila) con el ticker destino (columna).
3. Verificar:
   - 🟩 Verde = spread neto positivo → rotación viable
   - 🟥 Rojo = TRAMPA → no rotar
   - 🟨 Amarillo = marginal → evaluar con datos frescos

#### Paso 3: Simular la Rotación

1. Ir a la **Tab Cartera** → clic en "🔄 Rotar".
2. Seleccionar el ticker destino en el dropdown.
3. El sistema calcula automáticamente:
   - Spread bruto y neto
   - Comisión amortizada
   - Días de payback
   - Nuevos nominales resultantes
4. Revisar los escenarios de precio (±10pb, ±25bp).

#### Paso 4: Confirmar Ejecución

1. Verificar que la evaluación NO sea TRAMPA (salvo estrategia deliberada).
2. Confirmar la rotación. El sistema:
   - Registra la venta (posición actual) como transacción
   - Registra la compra (nueva posición) como transacción
   - Actualiza la posición activa
   - Ajusta el capital disponible (sobrante o faltante de nominales)

#### Paso 5: Monitorear Post-Rotación

1. En la **Tab Diagnóstico**, verificar el Health Score post-rotación.
2. Monitorear el ΔTIR del nuevo instrumento — si se revierte, evaluar salida.
3. Revisar las **Alertas Globales** por cambios de condiciones.

### 4.2 Cómo Interpretar el Cuadro de Detección de Anomalías

El cuadro de anomalías (Tabs Arbitraje y Curvas) muestra los desvíos detectados en la curva de rendimientos. Los "regalos" del mercado suelen aparecer como:

#### Anomalía SALTO_ANORMAL → "Regalo" Potencial

Un SALTO_ANORMAL indica que un instrumento de mayor plazo está rindiendo significativamente más que lo esperado por la pendiente de la curva.

**Qué buscar**:
- Severidad **ALTA** (>3σ): el mercado está regalando tasa. Verificar volumen y cotización.
- El ticker con SALTO aparece como **Oportunidad Maestra** en Arbitraje.
- Combinar con ΔTIR: si el ΔTIR es positivo, la ineficiencia se está profundizando → mejor oportunidad.

**Protocolo**:
1. Verificar que el instrumento tiene liquidez (no es un precio stale).
2. Confirmar con la matriz de rotación que el spread neto post-comisión es positivo.
3. Si payback < 5 días → entrar.
4. Monitorear ΔTIR para detectar reversión.

#### Anomalía INVERSION → "Trampa" Confirmada

Una INVERSION indica que un instrumento largo rinde menos que uno corto. Nunca entrar al instrumento largo en una inversión.

**Protocolo**:
1. Si CRITICA → EVITAR entrada, evaluar salida si está en cartera.
2. Si ALTA → Preferir el instrumento corto de la pareja.
3. Si MEDIA → Observar si se profundiza.

#### Anomalía APLANAMIENTO → "Zona Muerta"

Un segmento plano significa que no hay compensación por plazo adicional.

**Protocolo**:
1. Preferir el instrumento más corto del segmento plano (misma tasa, menos riesgo temporal).
2. No rotar dentro del segmento plano (spread neto será mínimo).

### 4.3 Workflow Completo de Análisis

```
┌──────────────────────────────────────┐
│ 1. DATOS: Pegar datos en Config Tab  │
│    → Fuente: acuantoesta.com.ar      │
│    → Auto-parse de tabla             │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 2. CONTEXTO: Revisar Dólar + Curva   │
│    → Tab Mercado: Dólares (MEP/CCL) │
│    → Tab Curvas: Forma + Anomalías   │
└──────────────┬───────────────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
┌───────────┐  ┌───────────────┐
│ 3a. CARRY │  │ 3b. ARBITRAJE │
│ Estrategia │  │ Arbitraje Tab │
│  Tab       │  │               │
│ Composite  │  │ Hunting V2    │
│ Signal     │  │ Score         │
└─────┬─────┘  └───────┬───────┘
      │                │
      ▼                ▼
┌──────────────────────────────────────┐
│ 4. EJECUCIÓN: Tab Cartera → Rotar   │
│    → Simular spread neto             │
│    → Confirmar si payback aceptable  │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 5. MONITOREO: Tab Diagnóstico       │
│    → Health Score post-operación     │
│    → Alertas globales                │
│    → ΔTIR del nuevo instrumento      │
└──────────────────────────────────────┘
```

---

## 5. Consideraciones de Riesgo

### 5.1 El Impacto de las Comisiones en el Spread Neto

La comisión de corretaje (default: 0.30% round-trip) es el **factor más subestimado** en la operación de LECAPs/BONCAPs.

#### Ejemplo: Un Spread de 0.15% se Convierte en 0.05%

| Concepto | Valor |
|----------|-------|
| Spread bruto (TEM destino − TEM actual) | +0.15% |
| Comisión total (0.30%) amortizada a 90 días | 0.30% / (90/30) = 0.10% |
| **Spread neto** | **0.15% − 0.10% = +0.05%** |
| Evaluación | MARGINAL (casi NO CONVIENE) |

Lo que parece una rotación atractiva (0.15% de spread) se reduce a apenas 0.05% después de comisión. En 90 días, cobrás 0.05% × 3 = 0.15% extra total — apenas $150 por cada $100,000 invertidos.

#### Regla Práctica

```
Spread bruto mínimo para rotación = comisiónTotal / (díasDestino / 30) + 0.05%
```

Para comisión 0.30% y destino de 90 días:
```
Mínimo = 0.10% + 0.05% = 0.15% spread bruto
```

Si el spread bruto no supera este mínimo, la rotación **no vale la pena**.

### 5.2 Por Qué el Sistema Marca "NO CONVIENE" con Spreads Positivos Pequeños

Un spread positivo no es suficiente. El sistema marca **NO CONVIENE** cuando:

1. **Spread neto ≤ 0.05%**: La comisión amortizada come casi toda la ganancia.
2. **Payback > 30 días**: Necesitás más de un mes para recuperar la comisión. En ese tiempo, las condiciones del mercado pueden cambiar radicalmente.
3. **El factor tiempo/payback**: Cada día que tardás en recuperar la comisión es un día de riesgo sin retorno. Si las tasas se mueven en tu contra antes del payback, la rotación genera pérdida.

#### Ejemplo: Rotación con Spread Positivo pero NO CONVIENE

| Concepto | Valor |
|----------|-------|
| TEM actual | 2.15% |
| TEM destino | 2.18% |
| Spread bruto | +0.03% |
| Comisión amortizada (273 días) | 0.033% |
| Spread neto | −0.003% |
| Evaluación | **NO CONVIENE** (spread neto negativo) |

Aunque el destino rinde más (2.18% > 2.15%), la comisión amortizada excede el spread. Perdés dinero rotando.

### 5.3 Riesgos Específicos del Enfoque Arbitraje

#### 5.3.1 Riesgo de Reversión

El Hunting Score prioriza el momentum. Pero el momentum puede revertirse en cualquier momento. Un ΔTIR de +0.10% puede volverse −0.05% en la próxima sesión.

**Mitigación**: Usar el payback como límite. Si payback > 5 días, el riesgo de reversión es alto. Si payback ≤ 2 días, el riesgo es mínimo.

#### 5.3.2 Riesgo de Datos Stale

El dashboard usa datos ingresados manualmente (pegar desde acuantoesta.com.ar). Si los datos no se actualizan, las señales son obsoletas.

**Mitigación**:
- Actualizar datos antes de cada operación.
- Verificar que el ΔTIR no sea null (null = sin snapshot previo = datos frescos).
- Si el último snapshot tiene más de 1 hora, las señales de momentum son poco confiables.

#### 5.3.3 Riesgo de Liquidez

Un SALTO_ANORMAL puede reflejar un precio stale de un instrumento sin volumen, no una oportunidad real.

**Mitigación**: Verificar volumen y cotización en la plataforma del broker antes de ejecutar. El dashboard no tiene datos de volumen.

### 5.4 Riesgos Específicos del Enfoque Carry (Estrategias)

#### 5.4.1 Riesgo de Tasa

Si las tasas suben después de la compra, el precio del instrumento cae. La duración modificada estima la magnitud:

```
pérdida estimada = |durMod| × Δtasa × precio
```

Para S30O6 (durMod=−0.53): una suba de 25bp genera −$0.015 por cada $1 de nominal.

#### 5.4.2 Riesgo de Spread Comprimido

Si el spread vs caución se comprime (acercándose a 0 o negativo), el instrumento ya no compensa el riesgo. El sistema alerta cuando el spread está entre 0 y 0.05% (Spread Comprimido).

### 5.5 Configuración de Riesgo País

| Nivel | Riesgo País | Acción Sugerida |
|-------|-------------|----------------|
| NORMAL | ≤ 450 pb | Operar con normalidad |
| PRECAUCION | 451-550 pb | Reducir exposición en instrumentos largos |
| ALERTA | 551-650 pb | Considerar reducir posiciones, preferir caución |
| PELIGRO | > 650 pb | Máxima cautela. Evaluar salir de posiciones en pesos |

### 5.6 Alertas de Tipo de Cambio (MEP)

| MEP | Nivel | Acción |
|-----|-------|--------|
| > $1,550 | 🚨 ALERTA CAMBIARIA | Considerar reducir exposición en pesos |
| > $1,450 | ⚠️ PRECAUCIÓN CAMBIARIA | Monitorear devaluación |

---

## 6. Apéndice A — Arquitectura de Pestañas

### 6.1 Mapa de Pestañas

| # | Tab | Icono | Función Principal | Motor |
|---|-----|-------|-------------------|-------|
| 1 | **Mercado** | 📊 | Vista general: tabla de instrumentos, dólar, filtros | — |
| 2 | **Oportunidades** | ⭐ | Rankings, heatmap, carry, CSV export | Composite Score (40/30/30) |
| 3 | **Curvas** | 📈 | Curva de rendimientos, anomalías, pendientes | Regresión lineal + σ |
| 4 | **Arbitraje** | 🔄 | Oportunidades agresivas, matriz, tapados | Hunting Score V2 (70/30) |
| 5 | **Estrategias** | 🎯 | Señales conservadoras, Swing/DayTrade, S/R | Composite Signal (25/35/25/15) |
| 6 | **Cartera** | 💼 | Posiciones, P&L, rotaciones, historial | Rotación + P&L unidireccional |
| 7 | **Diagnóstico** | 🩺 | Health Score, alertas ejecutivas, veredicto | Health Score (0-100) |
| 8 | **Historial** | 📜 | Transacciones registradas | — |
| 9 | **Configuración** | ⚙️ | Datos, parámetros, backups, historial precios | — |

### 6.2 Flujo de Datos

```
Config Tab (pegar datos) → instruments[] → Todas las tabs
                         → useSessionHistory → snapshots[] → ΔTIR, Aceleración
                         → historico_precios.json → S/R, DM enrichment
                         → dolarapi.com → Dólares (MEP, CCL, Blue)
```

### 6.3 Atajos de Teclado

| Atajo | Acción |
|-------|--------|
| Alt+1 a Alt+9 | Cambiar entre tabs |
| Alt+T | Toggle tema claro/oscuro |
| ? | Mostrar ayuda |
| Esc | Cerrar modal/panel |

### 6.4 Almacenamiento Local

| Clave | Contenido |
|-------|-----------|
| `arbradar_config` | Configuración (cauciones, comisión, riesgo país, capital) |
| `arbradar_position` | Posición activa (ticker, VN, precio entrada, fecha) |
| `arbradar_transactions` | Historial de transacciones (BUY/SELL) |
| `arbradar_price_history` | Historial de precios para S/R y DM |
| `arbradar_backups_*` | Backups diarios (auto-merge a price history) |
| `arbradar_simulations` | Registro de simulaciones de rotación |
| `arbradar_external_history` | Historial externo importado |

---

## 7. Apéndice B — Historial de Versiones

| Versión | Nombre | Cambios Clave |
|---------|--------|---------------|
| V1.5 | Modern Dark | Rediseño visual completo, Health Score, Toast, Instrument Detail, skeleton loading, backup auto-merge, dual ZIP |
| V1.6.0 | — | Search/filter, CSV export, glassmorphism, micro-interactions |
| V1.6.1 | — | Dollar panel puntas (Compra/Venta), retry con cache-bust |
| V1.6.2 | — | Oportunidades CSV export, heatmap improvements |
| V1.6.3 | — | Bug fixes, estabilidad, tooltip dark mode |
| V1.7.0 | — | S/R scale fix (detectScaleFactor), normalización 100:1 vs 1:1 |
| V1.7.1 | — | S/R scale fix mejorado, posicionEnRango clamped a [0,100] |
| V1.7.2 | Potencial de Salto | Upside residual como métrica visible, integración con Hunting Score |
| V1.7.3 | — | InstrumentCompare portal fix, audit de cálculos |
| V1.8.0 | Bifurcación Táctica | Hunting Score V2 (70/30), labels por spread neto, rotation recalibrado (≤2d), Upside Residual reemplaza "Poca conveniencia", eliminación de warnings de espera en Arbitraje |
| V1.8.1 | Tactical Aggression | Metadata actualizada, fix bug S/R 9900% (Math.min cap + normalización), cache busting para Netlify |

---

## Glosario Rápido

| Término | Definición |
|---------|-----------|
| **TEM** | Tasa Efectiva Mensual — rendimiento mensual del instrumento |
| **TNA** | Tasa Nominal Anual — rendimiento anual nominal (no compuesto) |
| **TIR** | Tasa Interna de Retorno — en este dashboard, TIR = TEM siempre |
| **Caución** | Préstamo repos con garantía — la tasa libre de riesgo alternativa |
| **Spread** | Diferencial de rendimiento entre el instrumento y la caución |
| **Spread Neto** | Spread después de descontar la comisión de rotación amortizada |
| **Payback** | Días necesarios para recuperar la comisión con el spread bruto |
| **ΔTIR** | Delta TIR — cambio de tasa entre snapshots consecutivos |
| **Aceleración** | 2da derivada de la TIR — cambio del ΔTIR |
| **DurMod** | Duración Modificada — sensibilidad del precio a cambios de tasa |
| **S/R** | Soporte y Resistencia — precios mínimo y máximo de 5 días |
| **Upside Residual** | Espacio porcentual entre precio actual y resistencia |
| **TRAMPA** | Rotación a un instrumento de menor rendimiento |
| **Tapado** | Instrumento con ΔTIR positivo pero spread aún marginal |
| **LECAP** | Letras del Tesoro — instrumento de corto plazo, escala 1:1 |
| **BONCAP** | Bonos del Tesoro — instrumento de mayor plazo, escala 100:1 |
| **MEP** | Dólar Mercado Electrónico de Pagos — tipo de cambio financiero |
| **CCL** | Contado con Liquidación — tipo de cambio financiero alternativo |
| **VN** | Valor Nominal — cantidad de unidades del instrumento |
| **RAE** | Rendimiento Anual Efectivo — TEM anualizado con capitalización |
| **Hunting Score V2** | Motor de señales de Arbitraje — 70% Momentum+Upside, 30% Carry |
| **Composite Signal** | Motor de señales de Estrategias — 25/35/25/15 ponderación |
| **Bifurcación Táctica** | Separación de lógica entre Arbitraje (agresivo) y Estrategias (conservador) |

---

*ARB//RADAR V1.8.1 — Tactical Aggression — Documentación operativa completa.*
*Los umbrales y fórmulas aquí documentados reflejan la implementación actual del sistema. Consultá siempre el código fuente para verificación.*
