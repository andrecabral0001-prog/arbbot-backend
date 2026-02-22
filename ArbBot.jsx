import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONFIG ──────────────────────────────────────────────────────────
// Após fazer o deploy no Railway, cole a URL aqui:
// Ex: "wss://arbbot-production.up.railway.app/ws"
const RAILWAY_WS_URL = "wss://SEU-PROJETO.up.railway.app/ws";

// ─── UTILS ───────────────────────────────────────────────────────────
function fmtPrice(v) {
  if (!v && v !== 0) return "—";
  if (v < 0.001) return v.toFixed(8);
  if (v < 1)     return v.toFixed(6);
  if (v < 100)   return v.toFixed(4);
  return v.toFixed(2);
}
function fmtSpread(v) {
  if (v === null || v === undefined) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(4) + "%";
}

// ─── COIN ROW ─────────────────────────────────────────────────────────
function CoinRow({ sym, spread, active, onClick }) {
  const cls = spread >= 0.05 ? "text-green-400" : spread < 0 ? "text-red-400" : "text-gray-500";
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer mb-1 transition-all
        ${active ? "bg-purple-900/30 border border-purple-500/40" : "hover:bg-white/5"}`}
    >
      <div>
        <div className={`text-sm font-bold ${active ? "text-purple-300" : "text-white"}`}>{sym}</div>
        <div className="text-[10px] text-gray-600">{sym}/USDT</div>
      </div>
      <div className={`text-xs font-semibold ${cls}`}>
        {spread !== null ? fmtSpread(spread) : "—"}
      </div>
    </div>
  );
}

// ─── PRICE CARD ───────────────────────────────────────────────────────
function PriceCard({ type, ask, bid, onOpen }) {
  const isSpot = type === "spot";
  const accentFrom = isSpot ? "from-blue-600" : "from-yellow-500";
  const accentTo   = isSpot ? "to-purple-600" : "to-red-500";
  const badge      = isSpot ? "COMPRA SPOT" : "SHORT FUTURES";
  const badgeCls   = isSpot
    ? "bg-blue-900/30 text-blue-400 border border-blue-500/25"
    : "bg-yellow-900/20 text-yellow-400 border border-yellow-500/25";

  return (
    <div className="bg-[#0e1018] border border-[#1c2030] rounded-xl p-5 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${accentFrom} ${accentTo}`} />
      <div className="flex justify-between items-center mb-4">
        <span className="text-[11px] font-bold tracking-widest text-gray-500 uppercase">
          {isSpot ? "Spot" : "Futuros"}
        </span>
        <span className={`text-[10px] px-2 py-1 rounded font-semibold tracking-wider ${badgeCls}`}>
          {badge}
        </span>
      </div>
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-[10px] text-gray-600 w-7">ASK</span>
        <span className="text-2xl font-black text-red-400 font-mono">{fmtPrice(ask)}</span>
      </div>
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-[10px] text-gray-600 w-7">BID</span>
        <span className="text-2xl font-black text-green-400 font-mono">{fmtPrice(bid)}</span>
      </div>
      <div className="text-[10px] text-gray-600 leading-relaxed mb-3">
        {isSpot
          ? <><span className="text-red-500">● ASK</span> → usado na <span className="text-white">ENTRADA</span> &nbsp;|&nbsp; <span className="text-green-500">● BID</span> → usado na <span className="text-white">SAÍDA</span></>
          : <><span className="text-green-500">● BID</span> → usado na <span className="text-white">ENTRADA</span> &nbsp;|&nbsp; <span className="text-red-500">● ASK</span> → usado na <span className="text-white">SAÍDA</span></>
        }
      </div>
      <button
        onClick={onOpen}
        className="w-full py-2 border border-[#252a3a] rounded-lg text-[11px] text-gray-500 hover:text-white hover:border-gray-600 transition-all"
      >
        ↗ Abrir {isSpot ? "Spot" : "Futuros"} na MEXC
      </button>
    </div>
  );
}

// ─── SPREAD CARD ──────────────────────────────────────────────────────
function SpreadCard({ type, spread, valA, valB, labelA, labelB, formula }) {
  const cls = spread >= (type === "entry" ? 0.05 : 0.02)
    ? "text-green-400 drop-shadow-[0_0_20px_rgba(0,230,118,0.3)]"
    : spread < 0
    ? "text-red-400 drop-shadow-[0_0_20px_rgba(255,61,87,0.2)]"
    : "text-gray-600";

  return (
    <div className="bg-[#0e1018] border border-[#1c2030] rounded-xl p-5">
      <div className="text-[10px] tracking-widest text-gray-500 uppercase mb-3">
        {type === "entry" ? "📥 Spread Entrada" : "📤 Spread Saída"}
      </div>
      <div className="text-[10px] text-gray-600 bg-[#0a0c14] rounded-lg p-2 mb-3 leading-relaxed font-mono">
        {formula}
      </div>
      <div className={`text-4xl font-black leading-none mb-3 font-mono ${cls}`}>
        {spread !== null ? fmtSpread(spread) : "—"}
      </div>
      <div className="text-[11px] text-gray-500 leading-loose font-mono">
        <span className="text-gray-400 font-semibold">{labelA}</span> {fmtPrice(valA)}<br />
        <span className="text-gray-400 font-semibold">{labelB}</span> {fmtPrice(valB)}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────
export default function ArbBot() {
  const [wsUrl, setWsUrl] = useState(RAILWAY_WS_URL);
  const [connected, setConnected] = useState(false);
  const [connMsg, setConnMsg] = useState("Conectando...");
  const [showConfig, setShowConfig] = useState(false);
  const [urlInput, setUrlInput] = useState(RAILWAY_WS_URL);

  const [allCoins, setAllCoins] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState("");
  const [coinSpreads, setCoinSpreads] = useState({});
  const [coinPrices, setCoinPrices] = useState({});

  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const histTick = useRef(0);

  const ws = useRef(null);

  // ── CONNECT ──────────────────────────────────────────────────────
  const connect = useCallback((url) => {
    if (ws.current) ws.current.close();
    setConnMsg("Conectando ao servidor Railway...");
    setConnected(false);

    try {
      const sock = new WebSocket(url);
      ws.current = sock;

      sock.onopen = () => {
        setConnected(true);
        setConnMsg("AO VIVO");
      };

      sock.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "symbols") {
          const futSet = new Set(msg.futures);
          const coins = msg.spot.filter(s => futSet.has(s));
          setAllCoins(coins);
          setFiltered(coins);
          // Assinar populares imediatamente
          const pop = ["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","DOT","LINK",
                       "MATIC","UNI","ATOM","LTC","ARB","NEAR","FTM","SAND","MANA","INJ"];
          sock.send(JSON.stringify({ action: "watch", symbols: pop.filter(s => coins.includes(s)) }));
        } else if (msg.type === "price") {
          const { symbol, entrySpread, ...rest } = msg;
          setCoinSpreads(prev => ({ ...prev, [symbol]: entrySpread }));
          setCoinPrices(prev => ({ ...prev, [symbol]: msg }));
        }
      };

      sock.onclose = () => {
        setConnected(false);
        setConnMsg("Desconectado — reconectando...");
        setTimeout(() => connect(url), 4000);
      };

      sock.onerror = () => {
        setConnMsg("❌ Erro de conexão");
      };
    } catch (e) {
      setConnMsg("❌ URL inválida");
    }
  }, []);

  useEffect(() => { connect(wsUrl); }, []);

  // ── SELECT COIN ───────────────────────────────────────────────────
  function selectCoin(sym) {
    setSelected(sym);
    setHistory([]);
    histTick.current = 0;
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ action: "watch", symbols: [sym] }));
    }
  }

  // ── HISTORY ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return;
    const p = coinPrices[selected];
    if (!p) return;
    histTick.current++;
    if (histTick.current % 5 !== 0) return;
    setHistory(prev => {
      const row = { ...p, t: new Date().toLocaleTimeString("pt-BR") };
      return [row, ...prev].slice(0, 30);
    });
  }, [coinPrices[selected]]);

  // ── SEARCH ────────────────────────────────────────────────────────
  function handleSearch(q) {
    setSearch(q);
    setFiltered(allCoins.filter(s => s.includes(q.toUpperCase())));
  }

  // ── OPEN WINDOWS ─────────────────────────────────────────────────
  const mexcBase = "https://www.mexc.com/pt-PT/exchange";
  const futBase  = "https://futures.mexc.com/exchange";

  function openBoth() {
    if (!selected) return;
    window.open(`${mexcBase}/${selected}_USDT`, "spot_w", "width=1100,height=720,left=0,top=0");
    setTimeout(() =>
      window.open(`${futBase}/${selected}_USDT`, "fut_w", "width=1100,height=720,left=1110,top=0")
    , 300);
  }

  // ── CURRENT PRICES ────────────────────────────────────────────────
  const cur = selected ? coinPrices[selected] : null;
  const entrySpread = cur?.entrySpread ?? null;
  const exitSpread  = cur?.exitSpread  ?? null;

  // ── SIGNAL ────────────────────────────────────────────────────────
  let sigType = "wait";
  if (entrySpread !== null && entrySpread > 0.05) sigType = "enter";
  else if (exitSpread !== null && exitSpread > 0.02) sigType = "exit";

  const sigConfig = {
    enter: {
      bg: "border-green-500/30 bg-green-900/5",
      icon: "🟢",
      title: "✅ OPORTUNIDADE DE ENTRADA",
      desc: `Fut BID > Spot ASK — Spread: ${fmtSpread(entrySpread)}`,
      pill: `bg-green-900/20 text-green-400 border-green-500/30`,
      label: `ENTRAR ${fmtSpread(entrySpread)}`,
    },
    exit: {
      bg: "border-yellow-500/30 bg-yellow-900/5",
      icon: "🟡",
      title: "🔔 OPORTUNIDADE DE SAÍDA",
      desc: `Spot BID > Fut ASK — Spread: ${fmtSpread(exitSpread)}`,
      pill: `bg-yellow-900/20 text-yellow-400 border-yellow-500/30`,
      label: `SAIR ${fmtSpread(exitSpread)}`,
    },
    wait: {
      bg: "border-[#1c2030] bg-[#0a0c14]",
      icon: "⏸",
      title: selected ? "Aguardando oportunidade..." : "Selecione uma moeda",
      desc: entrySpread !== null
        ? `Entrada: ${fmtSpread(entrySpread)} | Saída: ${fmtSpread(exitSpread)}`
        : "O sistema calcula os sinais automaticamente",
      pill: `bg-gray-900/20 text-gray-600 border-[#1c2030]`,
      label: "AGUARDANDO",
    },
  };
  const sig = sigConfig[sigType];

  return (
    <div className="bg-[#080a0f] text-gray-300 min-h-screen flex flex-col font-mono">

      {/* HEADER */}
      <header className="flex items-center justify-between px-6 h-13 border-b border-[#1c2030] bg-[#0a0c12]" style={{height:52,minHeight:52}}>
        <div className="font-black text-xl tracking-tight text-white" style={{fontFamily:"sans-serif"}}>
          Arb<span className="text-purple-400">Bot</span>
          <span className="text-xs text-gray-600 font-normal ml-2 tracking-normal">MEXC</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs
            ${connected ? "bg-green-900/20 border-green-500/25 text-green-400" : "bg-red-900/20 border-red-500/25 text-red-400"}`}>
            <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-400 shadow-[0_0_6px_#00e676]" : "bg-red-400"}`}
              style={connected ? {animation:"pulse 1.4s infinite"} : {}} />
            {connMsg}
          </div>
          <span className="text-gray-600">Pares: <b className="text-gray-400">{allCoins.length}</b></span>
          {selected && <span className="text-gray-600">Monitorando: <b className="text-purple-400">{selected}/USDT</b></span>}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="px-3 py-1 border border-[#252a3a] rounded-lg text-gray-500 hover:text-white hover:border-gray-600 transition-all text-xs"
          >
            ⚙ Config
          </button>
        </div>
      </header>

      {/* CONFIG MODAL */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="bg-[#0e1018] border border-[#1c2030] rounded-2xl p-6 w-[480px]">
            <h2 className="text-white font-bold text-lg mb-4">⚙ Configurar URL do Railway</h2>
            <label className="text-xs text-gray-500 block mb-2">WebSocket URL (Railway)</label>
            <input
              className="w-full bg-[#0a0c14] border border-[#252a3a] text-white font-mono text-sm px-3 py-2 rounded-lg outline-none focus:border-purple-500 mb-4"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="wss://seu-projeto.up.railway.app/ws"
            />
            <div className="text-xs text-gray-600 mb-4">
              Após o deploy no Railway, copie a URL do projeto e adicione <code className="text-purple-400">/ws</code> no final.<br/>
              Ex: <code className="text-gray-400">wss://arbbot-production.up.railway.app/ws</code>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setWsUrl(urlInput); connect(urlInput); setShowConfig(false); }}
                className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-lg font-semibold text-sm transition-all"
              >
                ✅ Conectar
              </button>
              <button
                onClick={() => setShowConfig(false)}
                className="flex-1 border border-[#252a3a] text-gray-500 hover:text-white py-2 rounded-lg text-sm transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* SIDEBAR */}
        <aside className="w-64 min-w-[256px] border-r border-[#1c2030] bg-[#0e1018] flex flex-col">
          <div className="p-3">
            <input
              className="w-full bg-[#0a0c14] border border-[#1c2030] text-gray-300 text-xs px-3 py-2 rounded-lg outline-none focus:border-purple-500 placeholder-gray-700"
              placeholder="🔍 Buscar moeda..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
            />
          </div>
          <div className="text-[10px] text-gray-700 tracking-widest uppercase px-3 pb-1">
            {filtered.length} pares disponíveis
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2"
            style={{scrollbarWidth:"thin",scrollbarColor:"#1c2030 transparent"}}>
            {filtered.length === 0
              ? <div className="text-center text-gray-700 text-xs p-6">Carregando...</div>
              : filtered.map(sym => (
                  <CoinRow
                    key={sym}
                    sym={sym}
                    spread={coinSpreads[sym] ?? null}
                    active={selected === sym}
                    onClick={() => selectCoin(sym)}
                  />
                ))
            }
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex-1 overflow-y-auto p-5 flex flex-col gap-4"
          style={{scrollbarWidth:"thin",scrollbarColor:"#1c2030 transparent"}}>

          {/* TICKER */}
          <div className="bg-[#0e1018] border border-[#1c2030] rounded-xl px-5 py-4 flex items-center justify-between">
            <div>
              <div className="text-2xl font-black text-white tracking-tight">
                {selected ? `${selected} / USDT` : "— / USDT"}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {selected ? "Preços em tempo real · Spot × Futuros MEXC" : "Selecione uma moeda na lista"}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => selected && window.open(`${mexcBase}/${selected}_USDT`, "_blank")}
                className="px-4 py-2 border border-[#252a3a] text-gray-500 hover:text-white hover:border-gray-600 rounded-lg text-xs font-semibold transition-all"
              >↗ Spot</button>
              <button
                onClick={() => selected && window.open(`${futBase}/${selected}_USDT`, "_blank")}
                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:brightness-110 text-white rounded-lg text-xs font-semibold transition-all"
              >↗ Futuros</button>
              <button
                onClick={openBoth}
                className="px-5 py-2 bg-gradient-to-r from-orange-500 to-red-500 hover:brightness-110 hover:-translate-y-0.5 text-white rounded-lg text-sm font-bold transition-all shadow-lg"
              >⚡ AÇÃO</button>
            </div>
          </div>

          {/* PRICES */}
          <div className="grid grid-cols-2 gap-4">
            <PriceCard
              type="spot"
              ask={cur?.spotAsk}
              bid={cur?.spotBid}
              onOpen={() => selected && window.open(`${mexcBase}/${selected}_USDT`, "_blank")}
            />
            <PriceCard
              type="futures"
              ask={cur?.futAsk}
              bid={cur?.futBid}
              onOpen={() => selected && window.open(`${futBase}/${selected}_USDT`, "_blank")}
            />
          </div>

          {/* SPREADS */}
          <div className="grid grid-cols-2 gap-4">
            <SpreadCard
              type="entry"
              spread={entrySpread}
              formula="( Futuros BID − Spot ASK ) ÷ Spot ASK × 100"
              labelA="FutBID:"
              valA={cur?.futBid}
              labelB="SpotASK:"
              valB={cur?.spotAsk}
            />
            <SpreadCard
              type="exit"
              spread={exitSpread}
              formula="( Spot BID − Futuros ASK ) ÷ Futuros ASK × 100"
              labelA="SpotBID:"
              valA={cur?.spotBid}
              labelB="FutASK:"
              valB={cur?.futAsk}
            />
          </div>

          {/* SIGNAL */}
          <div className={`flex items-center gap-4 px-5 py-4 rounded-xl border transition-all ${sig.bg}`}>
            <div className="text-2xl">{sig.icon}</div>
            <div className="flex-1">
              <div className="font-bold text-white text-sm mb-1">{sig.title}</div>
              <div className="text-xs text-gray-500">{sig.desc}</div>
            </div>
            <span className={`px-4 py-1.5 rounded-full text-xs font-bold border ${sig.pill}`}>
              {sig.label}
            </span>
          </div>

          {/* HISTORY */}
          <div className="bg-[#0e1018] border border-[#1c2030] rounded-xl overflow-hidden">
            <div className="flex justify-between items-center px-5 py-3 border-b border-[#1c2030]">
              <span className="text-[10px] tracking-widest text-gray-600 uppercase">Histórico</span>
              <button onClick={() => setHistory([])} className="text-xs text-gray-600 hover:text-white transition-all">
                Limpar
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1c2030]">
                    {["Hora","Spot ASK","Fut BID","Entrada %","Spot BID","Fut ASK","Saída %","Sinal"].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-[10px] text-gray-700 uppercase tracking-wider font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0
                    ? <tr><td colSpan={8} className="text-center text-gray-700 py-6">Aguardando dados...</td></tr>
                    : history.map((r, i) => (
                        <tr key={i} className="border-b border-[#0f1118] hover:bg-white/[0.02]">
                          <td className="px-4 py-2 text-gray-500">{r.t}</td>
                          <td className="px-4 py-2 text-red-400">{fmtPrice(r.spotAsk)}</td>
                          <td className="px-4 py-2 text-green-400">{fmtPrice(r.futBid)}</td>
                          <td className={`px-4 py-2 font-semibold ${r.entrySpread >= 0.05 ? "text-green-400" : r.entrySpread < 0 ? "text-red-400" : "text-gray-500"}`}>
                            {fmtSpread(r.entrySpread)}
                          </td>
                          <td className="px-4 py-2 text-green-400">{fmtPrice(r.spotBid)}</td>
                          <td className="px-4 py-2 text-red-400">{fmtPrice(r.futAsk)}</td>
                          <td className={`px-4 py-2 font-semibold ${r.exitSpread >= 0.02 ? "text-yellow-400" : r.exitSpread < 0 ? "text-red-400" : "text-gray-500"}`}>
                            {fmtSpread(r.exitSpread)}
                          </td>
                          <td className="px-4 py-2">
                            {r.entrySpread > 0.05
                              ? <span className="text-green-400">ENTRADA</span>
                              : r.exitSpread > 0.02
                              ? <span className="text-yellow-400">SAÍDA</span>
                              : <span className="text-gray-700">—</span>}
                          </td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          </div>

        </main>
      </div>
    </div>
  );
}
