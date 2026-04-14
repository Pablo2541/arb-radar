import { useState, useMemo } from 'react'
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Percent, 
  Calendar, 
  RefreshCw,
  Plus,
  Minus,
  RotateCcw,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  PieChart as PieChartIcon,
  Activity
} from 'lucide-react'
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend
} from 'recharts'

// Datos de ejemplo - en producción vendrían de una API
const initialInstruments = [
  { id: 'LECAP24', name: 'LECAP Abril 2024', type: 'LECAP', price: 98.5, yield: 0.85, maturity: '2024-04-15', tna: 42.5 },
  { id: 'LECAP25', name: 'LECAP Mayo 2024', type: 'LECAP', price: 97.2, yield: 0.92, maturity: '2024-05-20', tna: 45.2 },
  { id: 'BONCAP24', name: 'BONCAP Junio 2024', type: 'BONCAP', price: 96.8, yield: 1.05, maturity: '2024-06-30', tna: 48.7 },
  { id: 'LECAP26', name: 'LECAP Julio 2024', type: 'LECAP', price: 95.5, yield: 1.15, maturity: '2024-07-15', tna: 51.3 },
  { id: 'BONCAP25', name: 'BONCAP Agosto 2024', type: 'BONCAP', price: 94.2, yield: 1.25, maturity: '2024-08-31', tna: 54.8 },
]

const initialPortfolio = [
  { instrumentId: 'LECAP24', quantity: 100, avgPrice: 97.5, purchaseDate: '2024-01-15' },
  { instrumentId: 'BONCAP24', quantity: 50, avgPrice: 95.0, purchaseDate: '2024-01-20' },
  { instrumentId: 'LECAP25', quantity: 75, avgPrice: 96.0, purchaseDate: '2024-02-01' },
]

const historicalData = [
  { date: '2024-01-01', value: 100000 },
  { date: '2024-01-08', value: 102500 },
  { date: '2024-01-15', value: 105200 },
  { date: '2024-01-22', value: 103800 },
  { date: '2024-01-29', value: 107500 },
  { date: '2024-02-05', value: 110200 },
  { date: '2024-02-12', value: 112800 },
  { date: '2024-02-19', value: 115500 },
  { date: '2024-02-26', value: 118200 },
  { date: '2024-03-04', value: 121000 },
]

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D']

function App() {
  const [instruments] = useState(initialInstruments)
  const [portfolio, setPortfolio] = useState(initialPortfolio)
  const [cash, setCash] = useState(50000)
  const [showBuyModal, setShowBuyModal] = useState(false)
  const [showSellModal, setShowSellModal] = useState(false)
  const [showRotateModal, setShowRotateModal] = useState(false)
  const [selectedInstrument, setSelectedInstrument] = useState(null)
  
  // Form states
  const [buyForm, setBuyForm] = useState({ instrumentId: '', quantity: '', price: '' })
  const [sellForm, setSellForm] = useState({ positionId: '', quantity: '', price: '' })
  const [rotateForm, setRotateForm] = useState({ sellPositionId: '', buyInstrumentId: '', quantity: '' })

  // Cálculos del portfolio
  const portfolioWithDetails = useMemo(() => {
    return portfolio.map(pos => {
      const instrument = instruments.find(inst => inst.id === pos.instrumentId)
      const currentValue = pos.quantity * (instrument?.price || 0)
      const costBasis = pos.quantity * pos.avgPrice
      const pnl = currentValue - costBasis
      const pnlPercent = ((currentValue - costBasis) / costBasis) * 100
      return {
        ...pos,
        instrument,
        currentValue,
        pnl,
        pnlPercent,
        daysToMaturity: instrument ? Math.ceil((new Date(instrument.maturity) - new Date()) / (1000 * 60 * 60 * 24)) : 0
      }
    })
  }, [portfolio, instruments])

  const totalValue = useMemo(() => {
    return portfolioWithDetails.reduce((sum, pos) => sum + pos.currentValue, 0)
  }, [portfolioWithDetails])

  const totalPnL = useMemo(() => {
    return portfolioWithDetails.reduce((sum, pos) => sum + pos.pnl, 0)
  }, [portfolioWithDetails])

  const totalCostBasis = useMemo(() => {
    return portfolioWithDetails.reduce((sum, pos) => sum + (pos.quantity * pos.avgPrice), 0)
  }, [portfolioWithDetails])

  const portfolioYield = useMemo(() => {
    if (totalCostBasis === 0) return 0
    return ((totalValue - totalCostBasis) / totalCostBasis) * 100
  }, [totalValue, totalCostBasis])

  const weightedTNA = useMemo(() => {
    if (totalValue === 0) return 0
    const weightedSum = portfolioWithDetails.reduce((sum, pos) => {
      return sum + (pos.currentValue * (pos.instrument?.tna || 0))
    }, 0)
    return weightedSum / totalValue
  }, [portfolioWithDetails, totalValue])

  // Distribución por tipo
  const distributionByType = useMemo(() => {
    const dist = {}
    portfolioWithDetails.forEach(pos => {
      const type = pos.instrument?.type || 'Otros'
      if (!dist[type]) dist[type] = 0
      dist[type] += pos.currentValue
    })
    return Object.entries(dist).map(([name, value]) => ({ name, value }))
  }, [portfolioWithDetails])

  // Alertas
  const alerts = useMemo(() => {
    const alertList = []
    portfolioWithDetails.forEach(pos => {
      if (pos.daysToMaturity <= 7 && pos.daysToMaturity > 0) {
        alertList.push({
          type: 'warning',
          message: `${pos.instrument?.name} vence en ${pos.daysToMaturity} días`,
          position: pos
        })
      }
      if (pos.daysToMaturity <= 0) {
        alertList.push({
          type: 'danger',
          message: `${pos.instrument?.name} ha vencido`,
          position: pos
        })
      }
    })
    return alertList
  }, [portfolioWithDetails])

  // Handlers
  const handleBuy = (e) => {
    e.preventDefault()
    const { instrumentId, quantity, price } = buyForm
    const instrument = instruments.find(inst => inst.id === instrumentId)
    
    if (!instrument || !quantity || !price) return
    
    const totalCost = quantity * parseFloat(price)
    if (totalCost > cash) {
      alert('Saldo insuficiente')
      return
    }

    const existingPosition = portfolio.find(p => p.instrumentId === instrumentId)
    
    if (existingPosition) {
      const totalQuantity = existingPosition.quantity + parseInt(quantity)
      const totalCost = (existingPosition.quantity * existingPosition.avgPrice) + totalCost
      const newAvgPrice = totalCost / totalQuantity
      
      setPortfolio(portfolio.map(p => 
        p.instrumentId === instrumentId 
          ? { ...p, quantity: totalQuantity, avgPrice: newAvgPrice }
          : p
      ))
    } else {
      setPortfolio([...portfolio, {
        instrumentId,
        quantity: parseInt(quantity),
        avgPrice: parseFloat(price),
        purchaseDate: new Date().toISOString().split('T')[0]
      }])
    }
    
    setCash(cash - totalCost)
    setShowBuyModal(false)
    setBuyForm({ instrumentId: '', quantity: '', price: '' })
  }

  const handleSell = (e) => {
    e.preventDefault()
    const { positionId, quantity, price } = sellForm
    const position = portfolioWithDetails.find(p => p.positionId === positionId || p.instrumentId === positionId)
    
    if (!position || !quantity) return
    
    const sellQty = parseInt(quantity)
    if (sellQty > position.quantity) {
      alert('Cantidad insuficiente')
      return
    }

    const sellValue = sellQty * parseFloat(price || position.instrument.price)
    
    if (sellQty === position.quantity) {
      setPortfolio(portfolio.filter(p => p.instrumentId !== position.instrumentId))
    } else {
      setPortfolio(portfolio.map(p => 
        p.instrumentId === position.instrumentId 
          ? { ...p, quantity: p.quantity - sellQty }
          : p
      ))
    }
    
    setCash(cash + sellValue)
    setShowSellModal(false)
    setSellForm({ positionId: '', quantity: '', price: '' })
  }

  const handleRotate = (e) => {
    e.preventDefault()
    const { sellPositionId, buyInstrumentId, quantity } = rotateForm
    
    const sellPosition = portfolioWithDetails.find(p => p.instrumentId === sellPositionId)
    const buyInstrument = instruments.find(inst => inst.id === buyInstrumentId)
    
    if (!sellPosition || !buyInstrument || !quantity) return
    
    const sellQty = parseInt(quantity)
    if (sellQty > sellPosition.quantity) {
      alert('Cantidad insuficiente en la posición a vender')
      return
    }

    const sellValue = sellQty * sellPosition.instrument.price
    const buyQty = Math.floor(sellValue / buyInstrument.price)
    const remainder = sellValue - (buyQty * buyInstrument.price)
    
    // Actualizar posición vendida
    if (sellQty === sellPosition.quantity) {
      setPortfolio(portfolio.filter(p => p.instrumentId !== sellPositionId))
    } else {
      setPortfolio(portfolio.map(p => 
        p.instrumentId === sellPositionId 
          ? { ...p, quantity: p.quantity - sellQty }
          : p
      ))
    }
    
    // Agregar/actualuar posición comprada
    const existingPosition = portfolio.find(p => p.instrumentId === buyInstrumentId)
    if (existingPosition) {
      const totalQuantity = existingPosition.quantity + buyQty
      const totalCost = (existingPosition.quantity * existingPosition.avgPrice) + (buyQty * buyInstrument.price)
      const newAvgPrice = totalCost / totalQuantity
      
      setPortfolio(portfolio.map(p => 
        p.instrumentId === buyInstrumentId 
          ? { ...p, quantity: totalQuantity, avgPrice: newAvgPrice }
          : p
      ))
    } else {
      setPortfolio([...portfolio, {
        instrumentId: buyInstrumentId,
        quantity: buyQty,
        avgPrice: buyInstrument.price,
        purchaseDate: new Date().toISOString().split('T')[0]
      }])
    }
    
    setCash(cash + remainder)
    setShowRotateModal(false)
    setRotateForm({ sellPositionId: '', buyInstrumentId: '', quantity: '' })
  }

  const getDaysToMaturityColor = (days) => {
    if (days <= 0) return 'text-red-500'
    if (days <= 7) return 'text-yellow-500'
    if (days <= 30) return 'text-orange-500'
    return 'text-green-500'
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      {/* Header */}
      <header className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            ARB//RADAR Dashboard
          </h1>
          <div className="flex gap-3">
            <button 
              onClick={() => setShowBuyModal(true)}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors"
            >
              <Plus size={20} />
              Comprar
            </button>
            <button 
              onClick={() => setShowSellModal(true)}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg transition-colors"
            >
              <Minus size={20} />
              Vender
            </button>
            <button 
              onClick={() => setShowRotateModal(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
            >
              <RotateCcw size={20} />
              Rotar
            </button>
          </div>
        </div>
        
        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="mb-6 space-y-2">
            {alerts.map((alert, idx) => (
              <div 
                key={idx}
                className={`flex items-center gap-2 p-3 rounded-lg ${
                  alert.type === 'danger' ? 'bg-red-900/50 border border-red-500' : 
                  'bg-yellow-900/50 border border-yellow-500'
                }`}
              >
                <AlertTriangle size={20} className={alert.type === 'danger' ? 'text-red-500' : 'text-yellow-500'} />
                <span>{alert.message}</span>
              </div>
            ))}
          </div>
        )}
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-slate-400 text-sm">Valor Total</h3>
            <DollarSign size={20} className="text-blue-400" />
          </div>
          <p className="text-2xl font-bold">${totalValue.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
          <div className="flex items-center gap-1 mt-2 text-sm">
            <span className="text-slate-400">Efectivo:</span>
            <span className="text-green-400">${cash.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-slate-400 text-sm">P&L Total</h3>
            {totalPnL >= 0 ? <TrendingUp size={20} className="text-green-400" /> : <TrendingDown size={20} className="text-red-400" />}
          </div>
          <p className={`text-2xl font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ${totalPnL.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
          </p>
          <div className="flex items-center gap-1 mt-2 text-sm">
            {portfolioYield >= 0 ? <ArrowUpRight size={16} className="text-green-400" /> : <ArrowDownRight size={16} className="text-red-400" />}
            <span className={portfolioYield >= 0 ? 'text-green-400' : 'text-red-400'}>
              {portfolioYield.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-slate-400 text-sm">TNA Promedio</h3>
            <Percent size={20} className="text-purple-400" />
          </div>
          <p className="text-2xl font-bold text-purple-400">{weightedTNA.toFixed(2)}%</p>
          <p className="text-xs text-slate-400 mt-2">Ponderado por posición</p>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-slate-400 text-sm">Posiciones</h3>
            <Activity size={20} className="text-orange-400" />
          </div>
          <p className="text-2xl font-bold">{portfolio.length}</p>
          <p className="text-xs text-slate-400 mt-2">Instrumentos activos</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Evolución del Portfolio */}
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp size={20} className="text-blue-400" />
            Evolución del Portfolio
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={historicalData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" tick={{fontSize: 12}} />
              <YAxis stroke="#94a3b8" tick={{fontSize: 12}} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Distribución por Tipo */}
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <PieChartIcon size={20} className="text-green-400" />
            Distribución por Instrumento
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={distributionByType}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {distributionByType.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Positions Table */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 mb-8">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Activity size={20} className="text-orange-400" />
          Posiciones Abiertas
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-4 text-slate-400 font-medium">Instrumento</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Cantidad</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Precio Prom.</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Precio Actual</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Valor Total</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">P&L</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">TNA</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Vencimiento</th>
              </tr>
            </thead>
            <tbody>
              {portfolioWithDetails.map((position, idx) => (
                <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="py-3 px-4">
                    <div>
                      <p className="font-medium">{position.instrument?.name}</p>
                      <p className="text-xs text-slate-400">{position.instrument?.type}</p>
                    </div>
                  </td>
                  <td className="text-right py-3 px-4">{position.quantity}</td>
                  <td className="text-right py-3 px-4">${position.avgPrice.toFixed(2)}</td>
                  <td className="text-right py-3 px-4">${position.instrument?.price.toFixed(2)}</td>
                  <td className="text-right py-3 px-4 font-medium">
                    ${position.currentValue.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className={`text-right py-3 px-4 ${position.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    <div>${position.pnl.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</div>
                    <div className="text-xs">{position.pnlPercent.toFixed(2)}%</div>
                  </td>
                  <td className="text-right py-3 px-4 text-purple-400">{position.instrument?.tna.toFixed(2)}%</td>
                  <td className={`text-right py-3 px-4 ${getDaysToMaturityColor(position.daysToMaturity)}`}>
                    <div className="flex items-center justify-end gap-1">
                      <Calendar size={14} />
                      <span>{position.daysToMaturity > 0 ? `${position.daysToMaturity} días` : 'Vencido'}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Available Instruments */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp size={20} className="text-green-400" />
          Instrumentos Disponibles
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-4 text-slate-400 font-medium">Instrumento</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Precio</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Rendimiento</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">TNA</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Vencimiento</th>
              </tr>
            </thead>
            <tbody>
              {instruments.map((inst, idx) => (
                <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="py-3 px-4">
                    <div>
                      <p className="font-medium">{inst.name}</p>
                      <p className="text-xs text-slate-400">{inst.type}</p>
                    </div>
                  </td>
                  <td className="text-right py-3 px-4">${inst.price.toFixed(2)}</td>
                  <td className="text-right py-3 px-4 text-green-400">{(inst.yield * 100).toFixed(2)}%</td>
                  <td className="text-right py-3 px-4 text-purple-400">{inst.tna.toFixed(2)}%</td>
                  <td className="text-right py-3 px-4 text-slate-400">
                    {new Date(inst.maturity).toLocaleDateString('es-AR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Buy Modal */}
      {showBuyModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Plus size={24} className="text-green-400" />
              Comprar Instrumento
            </h3>
            <form onSubmit={handleBuy} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Instrumento</label>
                <select 
                  value={buyForm.instrumentId}
                  onChange={(e) => setBuyForm({...buyForm, instrumentId: e.target.value})}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  required
                >
                  <option value="">Seleccionar instrumento</option>
                  {instruments.map(inst => (
                    <option key={inst.id} value={inst.id}>{inst.name} - ${inst.price.toFixed(2)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Cantidad</label>
                <input 
                  type="number"
                  value={buyForm.quantity}
                  onChange={(e) => setBuyForm({...buyForm, quantity: e.target.value})}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  placeholder="0"
                  min="1"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Precio Unitario</label>
                <input 
                  type="number"
                  step="0.01"
                  value={buyForm.price}
                  onChange={(e) => setBuyForm({...buyForm, price: e.target.value})}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  placeholder="0.00"
                  min="0.01"
                  required
                />
              </div>
              {buyForm.quantity && buyForm.price && (
                <div className="bg-slate-700/50 p-3 rounded-lg">
                  <p className="text-sm text-slate-400">Total Estimado:</p>
                  <p className="text-xl font-bold text-green-400">
                    ${(buyForm.quantity * parseFloat(buyForm.price)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Saldo disponible: ${cash.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowBuyModal(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors"
                >
                  Confirmar Compra
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sell Modal */}
      {showSellModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Minus size={24} className="text-red-400" />
              Vender Posición
            </h3>
            <form onSubmit={handleSell} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Posición</label>
                <select 
                  value={sellForm.positionId}
                  onChange={(e) => setSellForm({...sellForm, positionId: e.target.value})}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  required
                >
                  <option value="">Seleccionar posición</option>
                  {portfolioWithDetails.map(pos => (
                    <option key={pos.instrumentId} value={pos.instrumentId}>
                      {pos.instrument?.name} - {pos.quantity} unidades
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Cantidad</label>
                <input 
                  type="number"
                  value={sellForm.quantity}
                  onChange={(e) => setSellForm({...sellForm, quantity: e.target.value})}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  placeholder="0"
                  min="1"
                  max={portfolioWithDetails.find(p => p.instrumentId === sellForm.positionId)?.quantity || 0}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Precio Unitario (opcional)</label>
                <input 
                  type="number"
                  step="0.01"
                  value={sellForm.price}
                  onChange={(e) => setSellForm({...sellForm, price: e.target.value})}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  placeholder="Precio de mercado"
                  min="0.01"
                />
              </div>
              {sellForm.quantity && portfolioWithDetails.find(p => p.instrumentId === sellForm.positionId) && (
                <div className="bg-slate-700/50 p-3 rounded-lg">
                  <p className="text-sm text-slate-400">Total Estimado:</p>
                  <p className="text-xl font-bold text-green-400">
                    ${(sellForm.quantity * parseFloat(sellForm.price || portfolioWithDetails.find(p => p.instrumentId === sellForm.positionId)?.instrument.price || 0)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowSellModal(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg transition-colors"
                >
                  Confirmar Venta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rotate Modal */}
      {showRotateModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <RotateCcw size={24} className="text-blue-400" />
              Rotar Instrumento
            </h3>
            <p className="text-sm text-slate-400 mb-4">
              Vende una posición y compra automáticamente otro instrumento con el mismo capital.
            </p>
            <form onSubmit={handleRotate} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Vender Posición</label>
                <select 
                  value={rotateForm.sellPositionId}
                  onChange={(e) => setRotateForm({...rotateForm, sellPositionId: e.target.value})}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  required
                >
                  <option value="">Seleccionar posición a vender</option>
                  {portfolioWithDetails.map(pos => (
                    <option key={pos.instrumentId} value={pos.instrumentId}>
                      {pos.instrument?.name} - {pos.quantity} un. (${pos.currentValue.toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Comprar Instrumento</label>
                <select 
                  value={rotateForm.buyInstrumentId}
                  onChange={(e) => setRotateForm({...rotateForm, buyInstrumentId: e.target.value})}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  required
                >
                  <option value="">Seleccionar instrumento a comprar</option>
                  {instruments.filter(inst => inst.id !== rotateForm.sellPositionId).map(inst => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} - ${inst.price.toFixed(2)} (TNA: {inst.tna.toFixed(2)}%)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Cantidad a Rotar</label>
                <input 
                  type="number"
                  value={rotateForm.quantity}
                  onChange={(e) => setRotateForm({...rotateForm, quantity: e.target.value})}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  placeholder="0"
                  min="1"
                  max={portfolioWithDetails.find(p => p.instrumentId === rotateForm.sellPositionId)?.quantity || 0}
                  required
                />
              </div>
              {rotateForm.quantity && rotateForm.sellPositionId && rotateForm.buyInstrumentId && (
                <div className="bg-slate-700/50 p-3 rounded-lg space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-400">Venta estimada:</span>
                    <span className="font-medium">
                      ${(rotateForm.quantity * (portfolioWithDetails.find(p => p.instrumentId === rotateForm.sellPositionId)?.instrument.price || 0)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-400">Compra estimada:</span>
                    <span className="font-medium text-green-400">
                      {Math.floor((rotateForm.quantity * (portfolioWithDetails.find(p => p.instrumentId === rotateForm.sellPositionId)?.instrument.price || 0)) / (instruments.find(i => i.id === rotateForm.buyInstrumentId)?.price || 1))} unidades
                    </span>
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowRotateModal(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
                >
                  Confirmar Rotación
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
