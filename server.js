// ══════════════════════════════════════════════════════
// server.js — Briscola Multiplayer
// ══════════════════════════════════════════════════════

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── COSTANTI ──────────────────────────────────────────

const SEMI   = ['bastoni', 'coppe', 'denari', 'spade'];
const VALORI = ['2', '4', '5', '6', '7', 'J', 'Q', 'K', '3', 'A'];
const FORZA  = { '2':0,'4':1,'5':2,'6':3,'7':4,'J':5,'Q':6,'K':7,'3':8,'A':9 };
const PUNTI  = { 'A':11,'3':10,'K':4,'Q':3,'J':2,'7':0,'6':0,'5':0,'4':0,'2':0 };

const rooms = {}; // roomId → stanza

// ── MAZZO ─────────────────────────────────────────────

function creaMazzo() {
  const mazzo = [];
  for (const seme of SEMI)
    for (const valore of VALORI)
      mazzo.push({ seme, valore, punti: PUNTI[valore] });

  // Fisher-Yates
  for (let i = mazzo.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [mazzo[i], mazzo[j]] = [mazzo[j], mazzo[i]];
  }
  return mazzo;
}

// ── VINCITORE MANO ────────────────────────────────────

function calcolaVincitore(carteGiocate, semePartenza, briscola) {
  let bestIdx = 0;
  let best    = carteGiocate[0];

  for (let i = 1; i < carteGiocate.length; i++) {
    const curr          = carteGiocate[i];
    const bestIsBriscola = best.carta.seme === briscola;
    const currIsBriscola = curr.carta.seme === briscola;

    if (currIsBriscola && !bestIsBriscola) {
      best = curr; bestIdx = i;
    } else if (currIsBriscola && bestIsBriscola) {
      if (FORZA[curr.carta.valore] > FORZA[best.carta.valore]) { best = curr; bestIdx = i; }
    } else if (!bestIsBriscola) {
      if (curr.carta.seme === semePartenza &&
          FORZA[curr.carta.valore] > FORZA[best.carta.valore]) { best = curr; bestIdx = i; }
    }
  }
  return bestIdx;
}

// ── NUOVA PARTITA ─────────────────────────────────────

function nuovaPartita(giocatori) {
  const mazzo    = creaMazzo();
  const briscola = mazzo[mazzo.length - 1]; // ultima carta sotto il mazzo

  const mani = {};
  for (const g of giocatori)
    mani[g.id] = [mazzo.pop(), mazzo.pop(), mazzo.pop()];

  const punteggi = {}, prese = {};
  for (const g of giocatori) { punteggi[g.id] = 0; prese[g.id] = []; }

  return {
    giocatori, mani, mazzo, briscola,
    turnoDi:      giocatori[0].id,
    carteGiocate: [],
    semePartenza: null,
    punteggi, prese,
    partitaFinita: false,
  };
}

// ── SOCKET ────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── CREA STANZA ──
  socket.on('crea_stanza', ({ nome, maxGiocatori }) => {
    const roomId = Math.random().toString(36).slice(2, 7).toUpperCase();
    rooms[roomId] = {
      id: roomId,
      maxGiocatori: maxGiocatori || 2,
      giocatori: [{ id: socket.id, nome }],
      stato: 'attesa',
      game:  null,
    };
    socket.join(roomId);
    socket.roomId  = roomId;
    socket.myNome  = nome;

    socket.emit('stanza_creata', { roomId, giocatori: rooms[roomId].giocatori });
    console.log(`[${roomId}] Creata da ${nome}`);
  });

  // ── ENTRA IN STANZA ──
  socket.on('entra_stanza', ({ nome, roomId }) => {
    const stanza = rooms[roomId];
    if (!stanza)                                       { socket.emit('errore', { msg: 'Stanza non trovata.' }); return; }
    if (stanza.stato !== 'attesa')                     { socket.emit('errore', { msg: 'Partita già iniziata.' }); return; }
    if (stanza.giocatori.length >= stanza.maxGiocatori){ socket.emit('errore', { msg: 'Stanza piena.' }); return; }

    stanza.giocatori.push({ id: socket.id, nome });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.myNome = nome;

    io.to(roomId).emit('aggiornamento_lobby', { giocatori: stanza.giocatori });
    console.log(`[${roomId}] ${nome} entrato`);

    if (stanza.giocatori.length === stanza.maxGiocatori)
      avviaPartita(roomId);
  });

  // ── RICONNESSIONE (da game.html con nuovo socketId) ──
  socket.on('riconnetti', ({ nome, roomId }) => {
    const stanza = rooms[roomId];
    if (!stanza || !stanza.game) {
      socket.emit('errore', { msg: 'Partita non trovata.' }); return;
    }

    const game = stanza.game;
    const vecchio = game.giocatori.find(g => g.nome === nome);
    if (!vecchio) { socket.emit('errore', { msg: 'Giocatore non trovato.' }); return; }

    const oldId = vecchio.id;

    // Aggiorna ID ovunque
    vecchio.id = socket.id;
    if (game.mani[oldId])     { game.mani[socket.id]     = game.mani[oldId];     delete game.mani[oldId]; }
    if (game.punteggi[oldId] !== undefined) { game.punteggi[socket.id] = game.punteggi[oldId]; delete game.punteggi[oldId]; }
    if (game.prese[oldId])    { game.prese[socket.id]    = game.prese[oldId];    delete game.prese[oldId]; }
    if (game.turnoDi === oldId) game.turnoDi = socket.id;
    game.carteGiocate = game.carteGiocate.map(cg =>
      cg.socketId === oldId ? { ...cg, socketId: socket.id } : cg
    );

    // Aggiorna stanza
    const sg = stanza.giocatori.find(g => g.nome === nome);
    if (sg) sg.id = socket.id;

    socket.join(roomId);
    socket.roomId = roomId;
    socket.myNome = nome;

    console.log(`[${roomId}] ${nome} riconnesso (${oldId} → ${socket.id})`);

    // Rimanda lo stato completo al giocatore
    socket.emit('partita_ripresa', {
      giocatori:      game.giocatori,
      mano:           game.mani[socket.id],
      briscola:       game.briscola,
      turnoDi:        game.turnoDi,
      carteGiocate:   game.carteGiocate,
      semePartenza:   game.semePartenza,
      punteggi:       game.punteggi,
      mazzoRimanente: game.mazzo.length,
    });
  });

  // ── GIOCA CARTA ──
  socket.on('gioca_carta', ({ carta }) => {
    const roomId = socket.roomId;
    const stanza = rooms[roomId];
    if (!stanza || !stanza.game) { socket.emit('errore', { msg: 'Partita non attiva.' }); return; }

    const game = stanza.game;

    if (game.turnoDi !== socket.id) {
      socket.emit('errore', { msg: 'Non è il tuo turno.' }); return;
    }

    const mano = game.mani[socket.id];
    if (!mano) { socket.emit('errore', { msg: 'Mano non trovata.' }); return; }

    const idx = mano.findIndex(c => c.seme === carta.seme && c.valore === carta.valore);
    if (idx === -1) { socket.emit('errore', { msg: 'Carta non in mano.' }); return; }

    mano.splice(idx, 1);

    if (game.carteGiocate.length === 0) game.semePartenza = carta.seme;
    game.carteGiocate.push({ socketId: socket.id, carta });

    io.to(roomId).emit('carta_giocata', {
      socketId: socket.id,
      carta,
      carteGiocate: game.carteGiocate,
    });

    const nGioc = game.giocatori.length;

    // Non tutte le carte ancora giocate → passa il turno
    if (game.carteGiocate.length < nGioc) {
      const currIdx = game.giocatori.findIndex(g => g.id === game.turnoDi);
      game.turnoDi  = game.giocatori[(currIdx + 1) % nGioc].id;
      io.to(roomId).emit('turno', { socketId: game.turnoDi });
      return;
    }

    // Tutte le carte giocate → calcola vincitore
    const winIdx    = calcolaVincitore(game.carteGiocate, game.semePartenza, game.briscola.seme);
    const vincitore = game.carteGiocate[winIdx].socketId;

    for (const cg of game.carteGiocate) {
      game.prese[vincitore].push(cg.carta);
      game.punteggi[vincitore] = (game.punteggi[vincitore] || 0) + cg.carta.punti;
    }

    io.to(roomId).emit('fine_mano', {
      vincitore,
      carteGiocate: game.carteGiocate,
      punteggi:     game.punteggi,
    });

    game.carteGiocate = [];
    game.semePartenza = null;
    game.turnoDi      = vincitore;

    // Pesca: vincitore prima, poi gli altri in ordine
    const startIdx = game.giocatori.findIndex(g => g.id === vincitore);
    for (let i = 0; i < nGioc; i++) {
      const pid = game.giocatori[(startIdx + i) % nGioc].id;
      if (game.mazzo.length > 0) {
        const nuova = game.mazzo.pop();
        game.mani[pid].push(nuova);
        io.to(pid).emit('carta_pescata', { carta: nuova });
      }
      io.to(pid).emit('aggiornamento_mano', {
        mano:           game.mani[pid],
        mazzoRimanente: game.mazzo.length,
        punteggi:       game.punteggi,
      });
    }

    // Fine partita?
    const tutteVuote = game.giocatori.every(g => (game.mani[g.id] || []).length === 0);
    if (tutteVuote) {
      finePartita(roomId);
    } else {
      io.to(roomId).emit('turno', { socketId: game.turnoDi });
    }
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const stanza = rooms[roomId];
    // Non rimuovere subito il giocatore — potrebbe riconnettersi da game.html
    // Rimuovi solo se in attesa (non ancora in partita)
    if (stanza.stato === 'attesa') {
      stanza.giocatori = stanza.giocatori.filter(g => g.id !== socket.id);
      if (stanza.giocatori.length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('aggiornamento_lobby', { giocatori: stanza.giocatori });
      }
    }
    console.log(`[-] Disconnected: ${socket.id} (${socket.myNome || '?'})`);
  });
});

// ── AVVIA PARTITA ─────────────────────────────────────

function avviaPartita(roomId) {
  const stanza = rooms[roomId];
  stanza.stato = 'in_gioco';
  stanza.game  = nuovaPartita(stanza.giocatori);

  for (const g of stanza.giocatori) {
    io.to(g.id).emit('partita_iniziata', {
      giocatori:      stanza.game.giocatori,
      mano:           stanza.game.mani[g.id],
      briscola:       stanza.game.briscola,
      turnoDi:        stanza.game.turnoDi,
      carteGiocate:   [],
      punteggi:       stanza.game.punteggi,
      mazzoRimanente: stanza.game.mazzo.length,
    });
  }

  console.log(`[${roomId}] Partita avviata | Briscola: ${stanza.game.briscola.valore} di ${stanza.game.briscola.seme}`);
}

// ── FINE PARTITA ──────────────────────────────────────

function finePartita(roomId) {
  const stanza = rooms[roomId];
  const game   = stanza.game;
  stanza.stato = 'finita';

  const risultati = stanza.giocatori.map(g => ({
    id:    g.id,
    nome:  g.nome,
    punti: game.punteggi[g.id] || 0,
  })).sort((a, b) => b.punti - a.punti);

  io.to(roomId).emit('partita_finita', {
    risultati,
    vincitore: risultati[0],
    briscola:  game.briscola,
  });

  console.log(`[${roomId}] Fine | Vince ${risultati[0].nome} con ${risultati[0].punti}pt`);
}

// ── AVVIO ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Briscola server on port ${PORT}`));
