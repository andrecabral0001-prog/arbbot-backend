"""
ArbBot - Backend para Railway
Conecta nos WebSockets da MEXC e serve os preços via WebSocket.
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

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger("ArbBot")

app = FastAPI(title="ArbBot MEXC")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── ESTADO GLOBAL ───────────────────────────────────────────────────
prices: Dict[str, dict] = {}
clients: Set[WebSocket] = set()
watched_symbols: Set[str] = set()
all_spot_symbols = []
all_futures_symbols = []


# ─── HEALTH CHECK (Railway precisa disso) ────────────────────────────
@app.get("/")
async def root():
    return {"status": "online", "pairs": len(prices)}

@app.get("/health")
async def health():
    return {"ok": True}


# ─── LISTA DE SÍMBOLOS ────────────────────────────────────────────────
@app.get("/api/symbols")
async def get_symbols():
    return {
        "spot": all_spot_symbols,
        "futures": all_futures_symbols,
    }


# ─── WEBSOCKET FRONTEND ──────────────────────────────────────────────
@app.websocket("/ws")
async def ws_frontend(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    log.info(f"Cliente conectado. Total: {len(clients)}")
    try:
        # Enviar lista de símbolos ao conectar
        await ws.send_json({
            "type": "symbols",
            "spot": all_spot_symbols,
            "futures": all_futures_symbols,
        })
        while True:
            data = await ws.receive_json()
            if data.get("action") == "watch":
                syms = [s.upper() for s in data.get("symbols", [])]
                new_syms = [s for s in syms if s not in watched_symbols]
                watched_symbols.update(syms)
                if new_syms:
                    log.info(f"Novos símbolos: {new_syms}")
    except WebSocketDisconnect:
        clients.discard(ws)
        log.info(f"Cliente desconectado. Total: {len(clients)}")
    except Exception as e:
        clients.discard(ws)
        log.error(f"Erro WS cliente: {e}")


# ─── BROADCAST ────────────────────────────────────────────────────────
async def broadcast(msg: dict):
    if not clients:
        return
    dead = set()
    data = json.dumps(msg)
    for ws in list(clients):
        try:
            await ws.send_text(data)
        except Exception:
            dead.add(ws)
    clients.difference_update(dead)


# ─── BUSCAR LISTA DE SÍMBOLOS DA MEXC ────────────────────────────────
async def fetch_symbol_lists():
    global all_spot_symbols, all_futures_symbols
    async with aiohttp.ClientSession() as session:
        # SPOT
        try:
            async with session.get(
                "https://api.mexc.com/api/v3/exchangeInfo",
                timeout=aiohttp.ClientTimeout(total=20)
            ) as r:
                data = await r.json()
                all_spot_symbols = sorted([
                    s["symbol"].replace("USDT", "")
                    for s in data.get("symbols", [])
                    if s["symbol"].endswith("USDT") and s.get("status") == "1"
                ])
                log.info(f"Spot: {len(all_spot_symbols)} pares carregados")
        except Exception as e:
            log.error(f"Erro spot symbols: {e}")
            all_spot_symbols = ["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","DOT","LINK"]

        # FUTUROS
        try:
            async with session.get(
                "https://contract.mexc.com/api/v1/contract/detail",
                timeout=aiohttp.ClientTimeout(total=20)
            ) as r:
                data = await r.json()
                all_futures_symbols = sorted([
                    s["symbol"].replace("_USDT", "")
                    for s in data.get("data", [])
                    if s.get("symbol", "").endswith("_USDT") and s.get("isDisplay", 1) == 1
                ])
                log.info(f"Futuros: {len(all_futures_symbols)} pares carregados")
        except Exception as e:
            log.error(f"Erro futures symbols: {e}")
            all_futures_symbols = ["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","DOT","LINK"]


# ─── SUBSCRITOR DINÂMICO ─────────────────────────────────────────────
# Controla quais subs já foram feitas para não duplicar
spot_subscribed: Set[str] = set()
fut_subscribed: Set[str] = set()


# ─── WEBSOCKET SPOT MEXC ─────────────────────────────────────────────
async def mexc_spot_ws():
    global spot_subscribed
    uri = "wss://wbs.mexc.com/ws"
    initial = ["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","DOT","LINK",
               "MATIC","UNI","ATOM","LTC","BCH","NEAR","FTM","SAND","MANA","ARB"]

    while True:
        try:
            async with websockets.connect(
                uri,
                ping_interval=20,
                ping_timeout=10,
                close_timeout=5,
            ) as ws:
                log.info("✅ Conectado ao Spot WS da MEXC")
                spot_subscribed = set()

                # Subscrever iniciais
                for sym in initial:
                    await ws.send(json.dumps({
                        "method": "SUBSCRIPTION",
                        "params": [f"spot@public.bookTicker.v3.api@{sym}USDT"]
                    }))
                    spot_subscribed.add(sym)
                    await asyncio.sleep(0.05)

                async for raw in ws:
                    data = json.loads(raw)

                    # Processar preço
                    d = data.get("d", {})
                    symbol = d.get("s", "")
                    if symbol.endswith("USDT"):
                        coin = symbol[:-4]
                        ask = d.get("a")
                        bid = d.get("b")
                        if ask and bid:
                            if coin not in prices:
                                prices[coin] = {}
                            prices[coin]["spotAsk"] = float(ask)
                            prices[coin]["spotBid"] = float(bid)
                            asyncio.create_task(push_price(coin))

                    # Subscrever novos símbolos pedidos pelo frontend
                    for sym in list(watched_symbols):
                        if sym not in spot_subscribed:
                            try:
                                await ws.send(json.dumps({
                                    "method": "SUBSCRIPTION",
                                    "params": [f"spot@public.bookTicker.v3.api@{sym}USDT"]
                                }))
                                spot_subscribed.add(sym)
                            except Exception:
                                pass

        except Exception as e:
            log.error(f"Spot WS erro: {e}. Reconectando em 5s...")
            await asyncio.sleep(5)


# ─── WEBSOCKET FUTUROS MEXC ──────────────────────────────────────────
async def mexc_futures_ws():
    global fut_subscribed
    uri = "wss://contract.mexc.com/edge"
    initial = ["BTC_USDT","ETH_USDT","SOL_USDT","BNB_USDT","XRP_USDT",
               "DOGE_USDT","ADA_USDT","AVAX_USDT","DOT_USDT","LINK_USDT",
               "MATIC_USDT","UNI_USDT","ATOM_USDT","LTC_USDT","ARB_USDT"]

    while True:
        try:
            async with websockets.connect(
                uri,
                ping_interval=20,
                ping_timeout=10,
                close_timeout=5,
            ) as ws:
                log.info("✅ Conectado ao Futuros WS da MEXC")
                fut_subscribed = set()

                # Ping loop para manter conexão
                asyncio.create_task(futures_ping(ws))

                # Subscrever iniciais
                for sym in initial:
                    await ws.send(json.dumps({
                        "method": "sub.ticker",
                        "param": {"symbol": sym}
                    }))
                    fut_subscribed.add(sym.replace("_USDT",""))
                    await asyncio.sleep(0.05)

                async for raw in ws:
                    data = json.loads(raw)

                    # Processar preço
                    channel = data.get("channel", "")
                    if channel == "push.ticker":
                        d = data.get("data", {})
                        symbol = d.get("symbol", "")
                        if symbol.endswith("_USDT"):
                            coin = symbol[:-5]
                            ask = d.get("ask1")
                            bid = d.get("bid1")
                            if ask and bid:
                                if coin not in prices:
                                    prices[coin] = {}
                                prices[coin]["futAsk"] = float(ask)
                                prices[coin]["futBid"] = float(bid)
                                asyncio.create_task(push_price(coin))

                    # Subscrever novos pedidos
                    for sym in list(watched_symbols):
                        if sym not in fut_subscribed:
                            try:
                                await ws.send(json.dumps({
                                    "method": "sub.ticker",
                                    "param": {"symbol": f"{sym}_USDT"}
                                }))
                                fut_subscribed.add(sym)
                            except Exception:
                                pass

        except Exception as e:
            log.error(f"Futuros WS erro: {e}. Reconectando em 5s...")
            await asyncio.sleep(5)


async def futures_ping(ws):
    """Mantém o WS de futuros vivo com ping periódico."""
    try:
        while True:
            await asyncio.sleep(15)
            await ws.send(json.dumps({"method": "ping"}))
    except Exception:
        pass


# ─── PUSH DE PREÇO PARA FRONTEND ─────────────────────────────────────
async def push_price(coin: str):
    p = prices.get(coin, {})
    spot_ask = p.get("spotAsk")
    spot_bid = p.get("spotBid")
    fut_ask  = p.get("futAsk")
    fut_bid  = p.get("futBid")

    if not all([spot_ask, spot_bid, fut_ask, fut_bid]):
        return

    entry_spread = (fut_bid - spot_ask) / spot_ask * 100
    exit_spread  = (spot_bid - fut_ask) / fut_ask * 100

    await broadcast({
        "type":        "price",
        "symbol":      coin,
        "spotAsk":     spot_ask,
        "spotBid":     spot_bid,
        "futAsk":      fut_ask,
        "futBid":      fut_bid,
        "entrySpread": round(entry_spread, 6),
        "exitSpread":  round(exit_spread, 6),
    })


# ─── STARTUP ─────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    log.info("🚀 Iniciando ArbBot no Railway...")
    await fetch_symbol_lists()
    asyncio.create_task(mexc_spot_ws())
    asyncio.create_task(mexc_futures_ws())
    log.info("✅ ArbBot online!")


# ─── MAIN ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
