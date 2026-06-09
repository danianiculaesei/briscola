// ══════════════════════════════════════════════════════
// server.js — Briscola Multiplayer
// Node.js + Socket.io
// ══════════════════════════════════════════════════════

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// ── COSTANTI ───────────────────────────────────────────

const SEMI   = ['bastoni', 'coppe', 'denari', 'spade'];
const VALORI = ['2', '4', '5', '6', '7', 'J', 'Q', 'K', '3', 'A'];

// Ordine di forza (0 = più debole, 9 = più forte)
const FORZA = { '2':0, '4':1, '5':2, '6':3, '7':4, 'J':5, 'Q':6, 'K':7, '3':8, 'A':9 };

// Punti per carta
const PUNTI = { 'A':11, '3':10, 'K':4, 'Q':3, 'J':2, '7':0, '6':0, '5':0, '4':0, '2':0 };

// Stanze attive: roomId → GameState
const rooms = {};

// ── CREAZIONE MAZZO ────────────────────────────────────

function creaMazzo() {
  const mazzo = [];
  for (const seme of SEMI) {
    for (const valore of VALORI) {
      mazzo.push({ seme, valore, punti: PUNTI[valore] });
    }
  }
  // Fisher-Yates shuffle
  for (let i = mazzo.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [mazzo[i], mazzo[j]] = [mazzo[j], mazzo[i]];
  }
  return mazzo;
}

// ── LOGICA PRESA ───────────────────────────────────────

/**
 * Determina l'indice del vincitore tra le carte giocate.
 * @param {Array} carteGiocate  [{socketId, carta}, ...]
 * @param {string} semePartenza seme della prima carta
 * @param {string} briscola     seme di briscola
 */
function calcolaVincitore(carteGiocate, semePartenza, briscola) {
  let bestIdx = 0;
  let best    = carteGiocate[0];

  for (let i = 1; i < carteGiocate.length; i++) {
    const curr = carteGiocate[i];
    const bestIsBriscola = best.carta.seme === briscola;
    const currIsBriscola = curr.carta.seme === briscola;

    if (currIsBriscola && !bestIsBriscola) {
      // briscola batte tutto il resto
      best = curr; bestIdx = i;
    } else if (currIsBriscola && bestIsBriscola) {
      // entrambe briscola: vince la più forte
      if (FORZA[curr.carta.valore] > FORZA[best.carta.valore]) {
        best = curr; bestIdx = i;
      }
    } else if (!bestIsBriscola) {
      // nessuna briscola: vince la più forte del seme di partenza
      if (curr.carta.seme === semePartenza &&
          FORZA[curr.carta.valore] > FORZA[best.carta.valore]) {
        best = curr; bestIdx = i;
      }
    }
  }
  return bestIdx;
}

// ── STATO INIZIALE PARTITA ─────────────────────────────

function nuovaPartita(giocatori) {
  const mazzo    = creaMazzo();
  const briscola = mazzo[mazzo.length - 1]; // ultima carta = briscola

  // Distribuisce 3 carte a testa (in senso antiorario = ordine array)
  const mani = {};
  for (const g of giocatori) {
    mani[g.id] = [mazzo.pop(), mazzo.pop(), mazzo.pop()];
  }

  return {
    giocatori,                // [{id, nome}]
    mani,                     // { socketId: [carta, ...] }
    mazzo,                    // carte rimanenti
    briscola,                 // carta di briscola
    turnoDi: giocatori[0].id, // chi gioca per primo
    carteGiocate: [],         // [{socketId, carta}] nella mano corrente
    semePartenza: null,
    prese: {},                // { socketId: [carte prese] }
    punteggi: {},             // { socketId: punti }
    faseFinale: false,        // true quando il mazzo è finito
    partitaFinita: false,
  };
}

// ── SOCKET.IO ──────────────────────────────────────────

io.on('connection', (socket) => {

  // ── CREA STANZA ──
  socket.on('crea_stanza', ({ nome, maxGiocatori }) => {
    const roomId = Math.random().toString(36).slice(2, 7).toUpperCase();
    rooms[roomId] = {
      id:           roomId,
      maxGiocatori: maxGiocatori || 2,
      giocatori:    [{ id: socket.id, nome }],
      stato:        'attesa',  // 'attesa' | 'in_gioco' | 'finita'
      game:         null,
    };
    socket.join(roomId);
    socket.roomId = roomId;

    socket.emit('stanza_creata', {
      roomId,
      giocatori: rooms[roomId].giocatori,
    });
    console.log(`[${roomId}] Stanza creata da ${nome}`);
  });

  // ── ENTRA IN STANZA ──
  socket.on('entra_stanza', ({ nome, roomId }) => {
    const stanza = rooms[roomId];

    if (!stanza) {
      socket.emit('errore', { msg: 'Stanza non trovata.' }); return;
    }
    if (stanza.stato !== 'attesa') {
      socket.emit('errore', { msg: 'Partita già iniziata.' }); return;
    }
    if (stanza.giocatori.length >= stanza.maxGiocatori) {
      socket.emit('errore', { msg: 'Stanza piena.' }); return;
    }

    stanza.giocatori.push({ id: socket.id, nome });
    socket.join(roomId);
    socket.roomId = roomId;

    io.to(roomId).emit('aggiornamento_lobby', { giocatori: stanza.giocatori });
    console.log(`[${roomId}] ${nome} è entrato`);

    // Avvia automaticamente quando la stanza è piena
    if (stanza.giocatori.length === stanza.maxGiocatori) {
      avviaPartita(roomId);
    }
  });

  // ── GIOCA CARTA ──
  socket.on('gioca_carta', ({ carta }) => {
    const roomId = socket.roomId;
    const stanza = rooms[roomId];
    if (!stanza || !stanza.game) return;

    const game = stanza.game;

    // Controlla che sia il turno del giocatore
    if (game.turnoDi !== socket.id) {
      socket.emit('errore', { msg: 'Non è il tuo turno.' }); return;
    }

    // Rimuove la carta dalla mano
    const mano = game.mani[socket.id];
    const idx  = mano.findIndex(c => c.seme === carta.seme && c.valore === carta.valore);
    if (idx === -1) {
      socket.emit('errore', { msg: 'Carta non in mano.' }); return;
    }
    mano.splice(idx, 1);

    // Registra la carta giocata
    if (game.carteGiocate.length === 0) {
      game.semePartenza = carta.seme;
    }
    game.carteGiocate.push({ socketId: socket.id, carta });

    io.to(roomId).emit('carta_giocata', {
      socketId: socket.id,
      carta,
      carteGiocate: game.carteGiocate,
    });

    // Passa il turno al prossimo giocatore
    const nGioc = game.giocatori.length;
    if (game.carteGiocate.length < nGioc) {
      const currIdx  = game.giocatori.findIndex(g => g.id === game.turnoDi);
      game.turnoDi   = game.giocatori[(currIdx + 1) % nGioc].id;
      io.to(roomId).emit('turno', { socketId: game.turnoDi });
      return;
    }

    // Tutte le carte giocate → calcola vincitore
    const winIdx    = calcolaVincitore(game.carteGiocate, game.semePartenza, game.briscola.seme);
    const vincitore = game.carteGiocate[winIdx].socketId;

    // Accumula prese e punti
    if (!game.prese[vincitore])    game.prese[vincitore]    = [];
    if (!game.punteggi[vincitore]) game.punteggi[vincitore] = 0;

    for (const cg of game.carteGiocate) {
      game.prese[vincitore].push(cg.carta);
      game.punteggi[vincitore] += cg.carta.punti;
    }

    io.to(roomId).emit('fine_mano', {
      vincitore,
      carteGiocate: game.carteGiocate,
      punteggi: game.punteggi,
    });

    // Resetta per la prossima mano
    game.carteGiocate = [];
    game.semePartenza = null;
    game.turnoDi      = vincitore;

    // Pesca (vincitore prima, poi gli altri in ordine)
    const ordine = [];
    ordine.push(vincitore);
    const startIdx = game.giocatori.findIndex(g => g.id === vincitore);
    for (let i = 1; i < nGioc; i++) {
      ordine.push(game.giocatori[(startIdx + i) % nGioc].id);
    }

    const pescate = {};
    for (const pid of ordine) {
      if (game.mazzo.length > 0) {
        const nuova = game.mazzo.pop();
        game.mani[pid].push(nuova);
        pescate[pid] = nuova;
      }
    }

    // Comunica le nuove carte (ognuno riceve solo la propria)
    for (const pid of ordine) {
      if (pescate[pid]) {
        io.to(pid).emit('carta_pescata', { carta: pescate[pid] });
      }
    }

    // Manda lo stato aggiornato delle mani (solo la propria)
    for (const g of game.giocatori) {
      io.to(g.id).emit('aggiornamento_mano', {
        mano:          game.mani[g.id],
        mazzoRimanente: game.mazzo.length,
      });
    }

    // Controlla fine partita
    const tutteVuote = game.giocatori.every(g => game.mani[g.id].length === 0);
    if (tutteVuote) {
      finePartita(roomId);
    } else {
      io.to(roomId).emit('turno', { socketId: game.turnoDi });
    }
  });

  // ── DISCONNESSIONE ──
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const stanza = rooms[roomId];
    stanza.giocatori = stanza.giocatori.filter(g => g.id !== socket.id);
    if (stanza.giocatori.length === 0) {
      delete rooms[roomId];
      console.log(`[${roomId}] Stanza eliminata`);
    } else {
      io.to(roomId).emit('giocatore_disconnesso', {
        giocatori: stanza.giocatori,
        msg: 'Un giocatore si è disconnesso.',
      });
    }
  });
});

// ── FUNZIONI PARTITA ───────────────────────────────────

function avviaPartita(roomId) {
  const stanza = rooms[roomId];
  stanza.stato = 'in_gioco';
  stanza.game  = nuovaPartita(stanza.giocatori);

  const game = stanza.game;

  // Inizializza punteggi
  for (const g of game.giocatori) {
    game.punteggi[g.id] = 0;
    game.prese[g.id]    = [];
  }

  // Invia a ogni giocatore la propria mano + info generali
  for (const g of game.giocatori) {
    io.to(g.id).emit('partita_iniziata', {
      giocatori:    game.giocatori,
      mano:         game.mani[g.id],
      briscola:     game.briscola,
      turnoDi:      game.turnoDi,
      mazzoRimanente: game.mazzo.length,
    });
  }

  console.log(`[${roomId}] Partita iniziata | Briscola: ${game.briscola.valore} di ${game.briscola.seme}`);
}

function finePartita(roomId) {
  const stanza = rooms[roomId];
  const game   = stanza.game;
  stanza.stato = 'finita';

  // Classifica
  const risultati = game.giocatori.map(g => ({
    id:     g.id,
    nome:   g.nome,
    punti:  game.punteggi[g.id] || 0,
  })).sort((a, b) => b.punti - a.punti);

  const vincitore = risultati[0];

  io.to(roomId).emit('partita_finita', {
    risultati,
    vincitore,
    briscola: game.briscola,
  });

  console.log(`[${roomId}] Partita finita | Vince ${vincitore.nome} con ${vincitore.punti} punti`);
}

// ── AVVIO SERVER ───────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Briscola server running on port ${PORT}`);
});
