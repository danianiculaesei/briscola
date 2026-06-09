const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const crypto     = require('crypto');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout:  60000,   // 60s prima di considerare disconnesso
  pingInterval: 25000,   // ping ogni 25s per tenere viva la connessione
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/carte', express.static(path.join(__dirname, 'carte')));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── COSTANTI ──────────────────────────────────────────
const SEMI   = ['bastoni','coppe','denari','spade'];
const VALORI = ['2','4','5','6','7','J','Q','K','3','A'];
const FORZA  = { '2':0,'4':1,'5':2,'6':3,'7':4,'J':5,'Q':6,'K':7,'3':8,'A':9 };
const PUNTI  = { 'A':11,'3':10,'K':4,'Q':3,'J':2,'7':0,'6':0,'5':0,'4':0,'2':0 };

const rooms = {}; // roomId → stanza

function mkToken() { return crypto.randomBytes(6).toString('hex'); }

// ── MAZZO ─────────────────────────────────────────────
function creaMazzo() {
  const m = [];
  for (const s of SEMI) for (const v of VALORI) m.push({ seme:s, valore:v, punti:PUNTI[v] });
  for (let i = m.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1)); [m[i],m[j]] = [m[j],m[i]];
  }
  return m;
}

// ── VINCITORE ─────────────────────────────────────────
function calcolaVincitore(carteGiocate, semePartenza, briscola) {
  let bIdx = 0, best = carteGiocate[0];
  for (let i = 1; i < carteGiocate.length; i++) {
    const curr = carteGiocate[i];
    const bB = best.carta.seme === briscola;
    const cB = curr.carta.seme === briscola;
    if (cB && !bB)                                                              { best=curr; bIdx=i; }
    else if (cB && bB && FORZA[curr.carta.valore]>FORZA[best.carta.valore])    { best=curr; bIdx=i; }
    else if (!bB && curr.carta.seme===semePartenza &&
             FORZA[curr.carta.valore]>FORZA[best.carta.valore])                { best=curr; bIdx=i; }
  }
  return bIdx;
}

// ── NUOVA PARTITA ─────────────────────────────────────
function nuovaPartita(giocatori) {
  const mazzo    = creaMazzo();
  const briscola = mazzo[mazzo.length - 1]; // ultima carta = briscola, rimane in fondo
  const mani={}, punteggi={}, prese={};
  for (const g of giocatori) {
    // Pesca 3 carte (pop toglie dall'ultimo, briscola è già protetta perché è all'indice length-1
    // e pop() toglie da length-1... quindi la briscola verrebbe presa!
    // Soluzione: la briscola è mazzo[0], pop() toglie da mazzo[length-1])
    // Rifacciamo: metti briscola in mazzo[0], pescata per ultima
    mani[g.token]     = [];
    punteggi[g.token] = 0;
    prese[g.token]    = [];
  }
  // Rimetti la briscola in fondo (pop() pesca da destra, quindi la briscola esce per ultima)
  // La briscola è già mazzo[length-1], ma pop() la prenderebbe subito.
  // Spostiamola in posizione 0 (viene pescata per ultima con pop())
  const briscolaIdx = mazzo.length - 1;
  const briscolaCard = mazzo.splice(briscolaIdx, 1)[0];
  mazzo.unshift(briscolaCard); // in posizione 0 = ultima pescata con pop()

  for (const g of giocatori) {
    mani[g.token] = [mazzo.pop(), mazzo.pop(), mazzo.pop()];
  }

  return {
    giocatori, mani, mazzo, briscola: briscolaCard,
    turnoDi: giocatori[0].token,
    carteGiocate: [], semePartenza: null,
    punteggi, prese, finita: false,
  };
}

// ── SOCKET ────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  socket.on('crea_stanza', ({ nome, maxGiocatori }) => {
    const roomId = Math.random().toString(36).slice(2,7).toUpperCase();
    const token  = mkToken();
    rooms[roomId] = {
      id: roomId, maxGiocatori: maxGiocatori||2, stato: 'attesa', game: null,
      giocatori: [{ token, nome, socketId: socket.id }],
    };
    socket.join(roomId);
    socket.token  = token;
    socket.roomId = roomId;
    socket.emit('stanza_creata', {
      token, roomId,
      giocatori: rooms[roomId].giocatori.map(g=>({token:g.token,nome:g.nome})),
    });
    console.log(`[${roomId}] Creata da ${nome} (token:${token})`);
  });

  socket.on('entra_stanza', ({ nome, roomId }) => {
    const st = rooms[roomId];
    if (!st)                              { socket.emit('errore',{msg:'Stanza non trovata.'}); return; }
    if (st.stato !== 'attesa')            { socket.emit('errore',{msg:'Partita già iniziata.'}); return; }
    if (st.giocatori.length>=st.maxGiocatori){ socket.emit('errore',{msg:'Stanza piena.'}); return; }
    const token = mkToken();
    st.giocatori.push({ token, nome, socketId: socket.id });
    socket.join(roomId);
    socket.token  = token;
    socket.roomId = roomId;
    io.to(roomId).emit('aggiornamento_lobby', {
      giocatori: st.giocatori.map(g=>({token:g.token,nome:g.nome})),
      maxGiocatori: st.maxGiocatori,
    });
    console.log(`[${roomId}] ${nome} entrato (token:${token})`);
    if (st.giocatori.length === st.maxGiocatori) avviaPartita(roomId);
  });

  socket.on('gioca_carta', ({ carta }) => {
    const st = rooms[socket.roomId];
    if (!st || !st.game) { socket.emit('errore',{msg:'Partita non attiva.'}); return; }
    const game  = st.game;
    const token = socket.token;

    if (game.turnoDi !== token) { socket.emit('errore',{msg:'Non è il tuo turno.'}); return; }
    const mano = game.mani[token];
    if (!mano)                  { socket.emit('errore',{msg:'Mano non trovata.'}); return; }
    const idx = mano.findIndex(c => c.seme===carta.seme && c.valore===carta.valore);
    if (idx===-1)               { socket.emit('errore',{msg:'Carta non in mano.'}); return; }

    mano.splice(idx, 1);
    if (game.carteGiocate.length===0) game.semePartenza = carta.seme;
    game.carteGiocate.push({ token, carta });

    io.to(socket.roomId).emit('carta_giocata', { token, carta, carteGiocate: game.carteGiocate });

    const nG = game.giocatori.length;
    if (game.carteGiocate.length < nG) {
      const ci = game.giocatori.findIndex(g=>g.token===game.turnoDi);
      game.turnoDi = game.giocatori[(ci+1)%nG].token;
      io.to(socket.roomId).emit('turno', { token: game.turnoDi });
      return;
    }

    // Calcola vincitore mano
    const wIdx = calcolaVincitore(game.carteGiocate, game.semePartenza, game.briscola.seme);
    const wTok = game.carteGiocate[wIdx].token;
    for (const cg of game.carteGiocate) {
      game.prese[wTok].push(cg.carta);
      game.punteggi[wTok] += cg.carta.punti;
    }

    io.to(socket.roomId).emit('fine_mano', {
      vincitoreToken: wTok,
      carteGiocate:  game.carteGiocate,
      punteggi:      game.punteggi,
    });

    game.carteGiocate = [];
    game.semePartenza = null;
    game.turnoDi      = wTok;

    // ── PESCA ──────────────────────────────────────────
    // Ordine: vincitore prima, poi gli altri in sequenza
    const si = game.giocatori.findIndex(g => g.token === wTok);
    const ordinePesca = Array.from({length: nG}, (_, i) => game.giocatori[(si + i) % nG]);

    // Quante carte normali rimangono (esclusa la briscola in pos 0)
    const carteNormali = game.mazzo.length - 1; // mazzo[0] è la briscola

    for (let i = 0; i < ordinePesca.length; i++) {
      const g = ordinePesca[i];
      let cartaPescata = null;

      if (carteNormali > 0 && i < carteNormali) {
        // Pesca carta normale (pop() toglie dall'ultimo = carte normali)
        cartaPescata = game.mazzo.pop();
        game.mani[g.token].push(cartaPescata);
      } else if (game.mazzo.length === 1) {
        // Ultima carta = briscola → va all'ultimo giocatore dell'ordine di pesca
        // La briscola va a chi pesca per ultimo (i === nG - 1)
        if (i === ordinePesca.length - 1) {
          cartaPescata = game.mazzo.pop(); // prende la briscola
          game.mani[g.token].push(cartaPescata);
          // Avvisa tutti che la briscola è stata presa
          io.to(socket.roomId).emit('briscola_presa', {
            token:   g.token,
            nome:    g.nome,
            briscola: cartaPescata,
          });
        }
        // Gli altri giocatori con i < nG-1 ma carteNormali === 0 non pescano
      }
      // Se mazzo vuoto: nessuno pesca

      // Manda mano aggiornata al proprietario
      const sock = [...io.sockets.sockets.values()].find(s => s.token === g.token);
      if (sock) sock.emit('aggiornamento_mano', {
        mano:           game.mani[g.token],
        mazzoRimanente: game.mazzo.length,
        punteggi:       game.punteggi,
      });
    }

    const tutteVuote = game.giocatori.every(g => (game.mani[g.token] || []).length === 0);
    if (tutteVuote) finePartita(socket.roomId);
    else io.to(socket.roomId).emit('turno', { token: game.turnoDi });
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const st = rooms[roomId];
    if (st.stato==='attesa') {
      st.giocatori = st.giocatori.filter(g=>g.token!==socket.token);
      if (st.giocatori.length===0) delete rooms[roomId];
      else io.to(roomId).emit('aggiornamento_lobby',{
        giocatori: st.giocatori.map(g=>({token:g.token,nome:g.nome})),
        maxGiocatori: st.maxGiocatori,
      });
    } else if (st.stato==='in_gioco') {
      const g = st.giocatori.find(g=>g.token===socket.token);
      io.to(roomId).emit('giocatore_disconnesso',{ msg:`${g?g.nome:'Un giocatore'} si è disconnesso.` });
    }
    console.log(`[-] ${socket.id} (${socket.token||'?'})`);
  });
});

// ── AVVIA PARTITA ─────────────────────────────────────
function avviaPartita(roomId) {
  const st = rooms[roomId];
  st.stato = 'in_gioco';
  st.game  = nuovaPartita(st.giocatori);
  const g  = st.game;

  for (const gioc of st.giocatori) {
    const sock = [...io.sockets.sockets.values()].find(s=>s.token===gioc.token);
    if (sock) sock.emit('partita_iniziata', {
      token:          gioc.token,
      giocatori:      g.giocatori.map(x=>({token:x.token,nome:x.nome})),
      mano:           g.mani[gioc.token],
      briscola:       g.briscola,
      turnoDi:        g.turnoDi,
      punteggi:       g.punteggi,
      mazzoRimanente: g.mazzo.length,
    });
  }
  console.log(`[${roomId}] Avviata | Briscola: ${g.briscola.valore} di ${g.briscola.seme}`);
}

// ── FINE PARTITA ──────────────────────────────────────
function finePartita(roomId) {
  const st = rooms[roomId];
  const g  = st.game;
  st.stato = 'finita';
  const risultati = st.giocatori
    .map(p=>({ token:p.token, nome:p.nome, punti:g.punteggi[p.token]||0 }))
    .sort((a,b)=>b.punti-a.punti);
  io.to(roomId).emit('partita_finita', { risultati, vincitore: risultati[0] });
  console.log(`[${roomId}] Fine | Vince ${risultati[0].nome} (${risultati[0].punti}pt)`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Briscola on port ${PORT}`));
