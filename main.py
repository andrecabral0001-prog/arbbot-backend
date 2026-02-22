"""
ArbBot - Backend Render.com
Conecta simultaneamente no Spot WS e Futuros WS da MEXC.
Calcula spreads e envia para o frontend em tempo real.
"""

import asyncio
import json
import logging
import os
import aiohttp
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from typing import Dict, Set

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ArbBot")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── ESTADO GLOBAL ────────────────────────────────────────────────────
# prices[COIN] = { spotAsk, spotBid, futAsk, futBid }
prices: Dict[str, dict] = {}
clients: Set[WebSocket] = set()
all_spot: list = []
all_futures: list = []

# controle de subscrições
spot_subbed: Set[str] = set()
fut_subbed:  Set[str] = set()

# fila de moedas a subscrever (pedidas pelo frontend)
pending_spot: asyncio.Queue = None
pending_fut:  asyncio.Queue = None


# ── HEALTH ───────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "online", "pairs_with_data": len(prices)}

@app.get("/health")
async def health():
    return {"ok": True}


# ── WEBSOCKET FRONTEND ───────────────────────────────────────────────
@app.websocket("/ws")
async def ws_frontend(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    log.info(f"Frontend conectado ({len(clients)} total)")
    try:
        # Envia lista de moedas imediatamente
        await ws.send_json({
            "type": "symbols",
            "spot":    all_spot,
            "futures": all_futures,
        })
        # Envia preços já disponíveis
        for coin, p in list(prices.items()):
            if _has_full(p):
                await ws.send_json(_build_msg(coin, p))

        while True:
            data = await ws.receive_json()
            if data.get("action") == "watch":
                syms = [s.upper() for s in data.get("symbols", [])]
                for sym in syms:
                    if sym not in spot_subbed and pending_spot:
                        await pending_spot.put(sym)
                    if sym not in fut_subbed and pending_fut:
                        await pending_fut.put(sym)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.error(f"WS frontend erro: {e}")
    finally:
        clients.discard(ws)


def _has_full(p: dict) -> bool:
    return all(p.get(k) for k in ("spotAsk", "spotBid", "futAsk", "futBid"))

def _build_msg(coin: str, p: dict) -> dict:
    sa = p["spotAsk"]
    sb = p["spotBid"]
    fa = p["futAsk"]
    fb = p["futBid"]
    entry = round((fb - sa) / sa * 100, 6)
    exit_ = round((sb - fa) / fa * 100, 6)
    return {
        "type":        "price",
        "symbol":      coin,
        "spotAsk":     sa,
        "spotBid":     sb,
        "futAsk":      fa,
        "futBid":      fb,
        "entrySpread": entry,
        "exitSpread":  exit_,
    }

async def broadcast(msg: dict):
    if not clients:
        return
    dead = set()
    txt = json.dumps(msg)
    for ws in list(clients):
        try:
            await ws.send_text(txt)
        except Exception:
            dead.add(ws)
    clients.difference_update(dead)

async def update_price(coin: str, field: str, ask: float, bid: float):
    if coin not in prices:
        prices[coin] = {}
    prices[coin][f"{field}Ask"] = ask
    prices[coin][f"{field}Bid"] = bid
    p = prices[coin]
    if _has_full(p):
        await broadcast(_build_msg(coin, p))


# ── BUSCAR LISTA DE SÍMBOLOS ─────────────────────────────────────────
async def fetch_symbols():
    global all_spot, all_futures
    async with aiohttp.ClientSession() as sess:
        # SPOT
        try:
            async with sess.get("https://api.mexc.com/api/v3/exchangeInfo",
                                timeout=aiohttp.ClientTimeout(total=20)) as r:
                d = await r.json()
                all_spot = sorted([
                    s["symbol"][:-4]
                    for s in d.get("symbols", [])
                    if s["symbol"].endswith("USDT") and s.get("status") == "1"
                ])
                log.info(f"Spot: {len(all_spot)} pares")
        except Exception as e:
            log.error(f"Erro spot symbols: {e}")
            all_spot = ["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","DOT","LINK"]

        # FUTUROS
        try:
            async with sess.get("https://contract.mexc.com/api/v1/contract/detail",
                                timeout=aiohttp.ClientTimeout(total=20)) as r:
                d = await r.json()
                all_futures = sorted([
                    s["symbol"][:-5]
                    for s in d.get("data", [])
                    if s.get("symbol","").endswith("_USDT")
                ])
                log.info(f"Futuros: {len(all_futures)} pares")
        except Exception as e:
            log.error(f"Erro fut symbols: {e}")
            all_futures = ["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","DOT","LINK"]


# ── WEBSOCKET SPOT ───────────────────────────────────────────────────
SPOT_INITIAL = [
    "BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","DOT","LINK",
    "MATIC","UNI","ATOM","LTC","ARB","NEAR","OP","SUI","APT","TRX",
    "INJ","FTM","SAND","MANA","AXS","GALA","ENJ","CHZ","FLOW","ALGO",
    "AAVE","MKR","SNX","CRV","1INCH","LDO","RPL","FXS","BLUR","PEPE",
    "SHIB","FLOKI","BONE","ELON","BABYDOGE",
]

async def mexc_spot_ws():
    global spot_subbed
    uri = "wss://wbs.mexc.com/ws"
    while True:
        try:
            async with websockets.connect(uri, ping_interval=20, ping_timeout=10) as ws:
                log.info("✅ Spot WS conectado")
                spot_subbed = set()

                async def subscribe(sym):
                    if sym not in spot_subbed and sym in all_spot:
                        await ws.send(json.dumps({
                            "method": "SUBSCRIPTION",
                            "params": [f"spot@public.bookTicker.v3.api@{sym}USDT"]
                        }))
                        spot_subbed.add(sym)

                # Subscrever iniciais
                for sym in SPOT_INITIAL:
                    await subscribe(sym)
                    await asyncio.sleep(0.03)

                async def drain_pending():
                    while True:
                        try:
                            sym = pending_spot.get_nowait()
                            await subscribe(sym)
                        except asyncio.QueueEmpty:
                            break

                async for raw in ws:
                    await drain_pending()
                    try:
                        data = json.loads(raw)
                        d = data.get("d", {})
                        symbol = d.get("s", "")
                        if symbol.endswith("USDT"):
                            coin = symbol[:-4]
                            ask = d.get("a")
                            bid = d.get("b")
                            if ask and bid:
                                await update_price(coin, "spot", float(ask), float(bid))
                    except Exception:
                        pass

        except Exception as e:
            log.error(f"Spot WS erro: {e}. Reconect. em 5s")
            await asyncio.sleep(5)


# ── WEBSOCKET FUTUROS ────────────────────────────────────────────────
FUT_INITIAL = [
    "BTC_USDT","ETH_USDT","SOL_USDT","BNB_USDT","XRP_USDT",
    "DOGE_USDT","ADA_USDT","AVAX_USDT","DOT_USDT","LINK_USDT",
    "MATIC_USDT","UNI_USDT","ATOM_USDT","LTC_USDT","ARB_USDT",
    "NEAR_USDT","OP_USDT","SUI_USDT","APT_USDT","TRX_USDT",
    "INJ_USDT","FTM_USDT","SAND_USDT","MANA_USDT","AXS_USDT",
    "GALA_USDT","ENJ_USDT","CHZ_USDT","FLOW_USDT","ALGO_USDT",
    "AAVE_USDT","MKR_USDT","SNX_USDT","CRV_USDT","1INCH_USDT",
    "LDO_USDT","PEPE_USDT","SHIB_USDT","FLOKI_USDT",
]

async def mexc_futures_ws():
    global fut_subbed
    uri = "wss://contract.mexc.com/edge"
    while True:
        try:
            async with websockets.connect(uri, ping_interval=20, ping_timeout=10) as ws:
                log.info("✅ Futuros WS conectado")
                fut_subbed = set()

                # Keep-alive ping
                async def ping_loop():
                    while True:
                        await asyncio.sleep(15)
                        try:
                            await ws.send(json.dumps({"method": "ping"}))
                        except Exception:
                            break
                asyncio.create_task(ping_loop())

                async def subscribe(sym_usdt):
                    sym = sym_usdt.replace("_USDT", "")
                    if sym not in fut_subbed and sym in all_futures:
                        await ws.send(json.dumps({
                            "method": "sub.ticker",
                            "param": {"symbol": sym_usdt}
                        }))
                        fut_subbed.add(sym)

                for sym in FUT_INITIAL:
                    await subscribe(sym)
                    await asyncio.sleep(0.03)

                async def drain_pending_fut():
                    while True:
                        try:
                            sym = pending_fut.get_nowait()
                            await subscribe(f"{sym}_USDT")
                        except asyncio.QueueEmpty:
                            break

                async for raw in ws:
                    await drain_pending_fut()
                    try:
                        data = json.loads(raw)
                        if data.get("channel") == "push.ticker":
                            d = data.get("data", {})
                            symbol = d.get("symbol", "")
                            if symbol.endswith("_USDT"):
                                coin = symbol[:-5]
                                ask = d.get("ask1")
                                bid = d.get("bid1")
                                if ask and bid:
                                    await update_price(coin, "fut", float(ask), float(bid))
                    except Exception:
                        pass

        except Exception as e:
            log.error(f"Fut WS erro: {e}. Reconect. em 5s")
            await asyncio.sleep(5)


# ── STARTUP ──────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    global pending_spot, pending_fut
    pending_spot = asyncio.Queue()
    pending_fut  = asyncio.Queue()
    log.info("🚀 ArbBot iniciando...")
    await fetch_symbols()
    asyncio.create_task(mexc_spot_ws())
    asyncio.create_task(mexc_futures_ws())
    log.info("✅ ArbBot online!")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
