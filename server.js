const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const crypto     = require('crypto');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout:  60000,
  pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/carte', express.static(path.join(__dirname, 'carte')));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── COSTANTI ──────────────────────────────────────────
const SEMI   = ['bastoni','coppe','denari','spade'];
const VALORI = ['2','4','5','6','7','J','Q','K','3','A'];
const FORZA  = { '2':0,'4':1,'5':2,'6':3,'7':4,'J':5,'Q':6,'K':7,'3':8,'A':9 };
const PUNTI  = { 'A':11,'3':10,'K':4,'Q':3,'J':2,'7':0,'6':0,'5':0,'4':0,'2':0 };

const rooms = {};

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

// ── VINCITORE MANO ────────────────────────────────────
function calcolaVincitore(carteGiocate, semePartenza, briscola) {
  let bIdx = 0, best = carteGiocate[0];
  for (let i = 1; i < carteGiocate.length; i++) {
    const curr = carteGiocate[i];
    const bB = best.carta.seme === briscola;
    const cB = curr.carta.seme === briscola;
    if (cB && !bB)                                                           { best=curr; bIdx=i; }
    else if (cB && bB && FORZA[curr.carta.valore]>FORZA[best.carta.valore]) { best=curr; bIdx=i; }
    else if (!bB && curr.carta.seme===semePartenza &&
             FORZA[curr.carta.valore]>FORZA[best.carta.valore])             { best=curr; bIdx=i; }
  }
  return bIdx;
}

// ── SQUADRE per 4 giocatori ───────────────────────────
// Posizioni: 0,1,2,3 in senso antiorario
// Coppia A: posizioni 0 e 2  (si siedono di fronte)
// Coppia B: posizioni 1 e 3
function assegnaSquadre(giocatori) {
  if (giocatori.length !== 4) return null;
  return {
    A: [giocatori[0].token, giocatori[2].token],
    B: [giocatori[1].token, giocatori[3].token],
  };
}

function squadraDi(token, squadre) {
  if (!squadre) return null;
  if (squadre.A.includes(token)) return 'A';
  if (squadre.B.includes(token)) return 'B';
  return null;
}

function compagnoDi(token, squadre) {
  if (!squadre) return null;
  const sq = squadre.A.includes(token) ? squadre.A : squadre.B.includes(token) ? squadre.B : null;
  if (!sq) return null;
  return sq.find(t => t !== token) || null;
}

// ── NUOVA PARTITA ─────────────────────────────────────
function nuovaPartita(giocatori) {
  const mazzo = creaMazzo();
  const mani={}, punteggiIndividuali={}, prese={};

  for (const g of giocatori) {
    mani[g.token]                = [];
    punteggiIndividuali[g.token] = 0;
    prese[g.token]               = [];
  }

  // Briscola: prima carta del mazzo → messa in pos 0 (pop pesca da destra, quindi esce per ultima)
  const briscolaCard = mazzo.pop();
  mazzo.unshift(briscolaCard);

  // Distribuisci 3 carte a testa
  for (const g of giocatori) {
    mani[g.token] = [mazzo.pop(), mazzo.pop(), mazzo.pop()];
  }

  // Squadre (solo per 4 giocatori)
  const squadre = giocatori.length === 4 ? assegnaSquadre(giocatori) : null;

  // Punteggi di squadra (o individuali per 2/3)
  const punteggiSquadra = squadre
    ? { A: 0, B: 0 }
    : null;

  return {
    giocatori, mani, mazzo,
    briscola: briscolaCard,
    squadre,
    turnoDi: giocatori[0].token,
    carteGiocate: [], semePartenza: null,
    punteggiIndividuali,
    punteggiSquadra,
    prese, finita: false,
  };
}

// ── HELPER: punteggi da mandare al client ─────────────
// Per 4p manda punteggi di squadra; per 2/3p manda individuali
function punteggiPerClient(game) {
  if (game.squadre) {
    // Mappa token → punti della sua squadra (per compatibilità col client)
    const map = {};
    for (const g of game.giocatori) {
      const sq = squadraDi(g.token, game.squadre);
      map[g.token] = game.punteggiSquadra[sq] || 0;
    }
    return map;
  }
  return game.punteggiIndividuali;
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
    if (!st)                                 { socket.emit('errore',{msg:'Stanza non trovata.'}); return; }
    if (st.stato !== 'attesa')               { socket.emit('errore',{msg:'Partita già iniziata.'}); return; }
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

    // ── Calcola vincitore mano ──────────────────────────
    const wIdx = calcolaVincitore(game.carteGiocate, game.semePartenza, game.briscola.seme);
    const wTok = game.carteGiocate[wIdx].token;

    // Accredita punti
    let puntiMano = 0;
    for (const cg of game.carteGiocate) {
      game.prese[wTok].push(cg.carta);
      game.punteggiIndividuali[wTok] += cg.carta.punti;
      puntiMano += cg.carta.punti;
    }
    if (game.squadre) {
      const sq = squadraDi(wTok, game.squadre);
      game.punteggiSquadra[sq] += puntiMano;
    }

    const pts = punteggiPerClient(game);
    io.to(socket.roomId).emit('fine_mano', {
      vincitoreToken: wTok,
      carteGiocate:  game.carteGiocate,
      punteggi:      pts,
    });

    game.carteGiocate = [];
    game.semePartenza = null;
    game.turnoDi      = wTok;

    // ── Pesca ───────────────────────────────────────────
    const si = game.giocatori.findIndex(g => g.token === wTok);
    const ordinePesca = Array.from({length: nG}, (_, i) => game.giocatori[(si + i) % nG]);
    const carteNormali = game.mazzo.length - 1; // mazzo[0] è la briscola

    for (let i = 0; i < ordinePesca.length; i++) {
      const g = ordinePesca[i];

      if (carteNormali > 0 && i < carteNormali) {
        game.mani[g.token].push(game.mazzo.pop());
      } else if (game.mazzo.length === 1 && i === ordinePesca.length - 1) {
        const bCard = game.mazzo.pop();
        game.mani[g.token].push(bCard);
        io.to(socket.roomId).emit('briscola_presa', {
          token: g.token, nome: g.nome, briscola: bCard,
        });
      }

      const sock = [...io.sockets.sockets.values()].find(s => s.token === g.token);
      if (sock) sock.emit('aggiornamento_mano', {
        mano:           game.mani[g.token],
        mazzoRimanente: game.mazzo.length,
        punteggi:       punteggiPerClient(game),
      });
    }

    // ── Fine partita? ───────────────────────────────────
    const tutteVuote = game.giocatori.every(g => (game.mani[g.token]||[]).length === 0);
    if (tutteVuote) {
      finePartita(socket.roomId);
    } else {
      io.to(socket.roomId).emit('turno', { token: game.turnoDi });
    }
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
    if (!sock) continue;

    // Calcola token del compagno (solo per 4p)
    const compagno = g.squadre ? compagnoDi(gioc.token, g.squadre) : null;
    const compagnoNome = compagno
      ? (g.giocatori.find(x=>x.token===compagno)?.nome || null)
      : null;

    sock.emit('partita_iniziata', {
      token:          gioc.token,
      giocatori:      g.giocatori.map(x=>({token:x.token,nome:x.nome})),
      mano:           g.mani[gioc.token],
      briscola:       g.briscola,
      turnoDi:        g.turnoDi,
      punteggi:       punteggiPerClient(g),
      mazzoRimanente: g.mazzo.length,
      squadre:        g.squadre,          // { A:[tok,tok], B:[tok,tok] } oppure null
      compagnoToken:  compagno,
      compagnoNome,
    });
  }
  console.log(`[${roomId}] Avviata | Briscola: ${g.briscola.valore} di ${g.briscola.seme} | Squadre: ${JSON.stringify(g.squadre)}`);
}

// ── FINE PARTITA ──────────────────────────────────────
function finePartita(roomId) {
  const st = rooms[roomId];
  const g  = st.game;
  st.stato = 'finita';

  let risultati, vincitore;

  if (g.squadre) {
    // Modalità squadre: costruisci risultati per coppia
    const ptA = g.punteggiSquadra.A;
    const ptB = g.punteggiSquadra.B;

    const nomiA = g.squadre.A.map(t => g.giocatori.find(x=>x.token===t)?.nome || '?');
    const nomiB = g.squadre.B.map(t => g.giocatori.find(x=>x.token===t)?.nome || '?');

    risultati = [
      { squadra:'A', nomi: nomiA, tokens: g.squadre.A, punti: ptA },
      { squadra:'B', nomi: nomiB, tokens: g.squadre.B, punti: ptB },
    ].sort((a,b) => b.punti - a.punti);

    vincitore = risultati[0];
  } else {
    risultati = st.giocatori
      .map(p=>({ token:p.token, nome:p.nome, punti:g.punteggiIndividuali[p.token]||0 }))
      .sort((a,b)=>b.punti-a.punti);
    vincitore = risultati[0];
  }

  io.to(roomId).emit('partita_finita', { risultati, vincitore, modalitaSquadre: !!g.squadre });
  console.log(`[${roomId}] Fine | ${g.squadre ? `Squadra ${vincitore.squadra} vince (${vincitore.punti}pt)` : `Vince ${vincitore.nome} (${vincitore.punti}pt)`}`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Briscola on port ${PORT}`));
