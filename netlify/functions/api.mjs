// ══════════════════════════════════════════════════════
// Briscola — backend su Netlify Functions
//
// Sostituisce server.js (Socket.io), che Netlify non può eseguire.
// Le funzioni serverless non hanno memoria fra una chiamata e l'altra:
// lo stato di ogni stanza vive su Netlify Blobs, e al posto del push
// WebSocket ogni stanza tiene un log di eventi che i client leggono
// in polling (azione 'poll') a partire da un cursore.
//
// Logica di gioco identica a server.js: mazzo, forza, punti, squadre.
// ══════════════════════════════════════════════════════

import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

// ── COSTANTI ──────────────────────────────────────────
const SEMI   = ['bastoni','coppe','denari','spade'];
const VALORI = ['2','4','5','6','7','J','Q','K','3','A'];
const FORZA  = { '2':0,'4':1,'5':2,'6':3,'7':4,'J':5,'Q':6,'K':7,'3':8,'A':9 };
const PUNTI  = { 'A':11,'3':10,'K':4,'Q':3,'J':2,'7':0,'6':0,'5':0,'4':0,'2':0 };

const PAUSA_FINE_PARTITA = 2200;   // era il setTimeout di server.js
const TIMEOUT_LOBBY      = 30000;  // slot liberato se il client non chiama più
const TIMEOUT_GIOCO      = 20000;  // soglia per l'avviso "si è disconnesso"
const TIMEOUT_RIVINCITA  = 5 * 60 * 1000; // scadenza attesa rivincita a fine partita
const PRESENZA_MIN_GAP   = 5000;   // non riscrive lastSeen più spesso di così
const MAX_EVENTI         = 300;    // il log tiene solo la coda recente
const TTL_STANZA         = 6 * 60 * 60 * 1000;
const LOCK_TTL           = 8000;   // oltre questa età il lock è considerato appeso
const LOCK_TENTATIVI     = 25;
const MUTA_TENTATIVI     = 8;      // ritenta se la scrittura è stata sovrascritta

function mkToken() { return crypto.randomBytes(6).toString('hex'); }

// ── BLOBS ─────────────────────────────────────────────
const store = () => getStore({ name: 'briscola', consistency: 'strong' });
const chiave = roomId => `room:${roomId}`;

async function leggiStanza(roomId) {
  return store().get(chiave(roomId), { type: 'json', consistency: 'strong' });
}

const attendi = ms => new Promise(r => setTimeout(r, ms));

// Mutex fra invocazioni concorrenti della function.
//
// Il compare-and-swap sarebbe la scelta naturale, ma `getWithMetadata` non
// restituisce l'etag in lettura: `onlyIfMatch` riceverebbe undefined e la
// scrittura diventerebbe incondizionata, perdendo le mutazioni parallele
// (tre giocatori che entrano insieme si sovrascrivono a vicenda).
// `onlyIfNew` è invece atomico e affidabile, quindi lo si usa come lock.
async function conLock(roomId, fn) {
  const s  = store();
  const lk = `lock:${roomId}`;
  let preso = false;

  for (let i = 0; i < LOCK_TENTATIVI; i++) {
    if ((await s.setJSON(lk, { ts: Date.now() }, { onlyIfNew: true })).modified) { preso = true; break; }
    // Un'invocazione morta a metà lascerebbe il lock appeso: dopo la scadenza si forza.
    const cur = await s.get(lk, { type: 'json', consistency: 'strong' });
    if (cur && Date.now() - cur.ts > LOCK_TTL) { await s.delete(lk); continue; }
    await attendi(40 + i * 15);
  }
  if (!preso) return { errore: 'Server occupato, riprova.' };

  try { return await fn(); }
  finally { await s.delete(lk); }
}

// Il lock riduce le collisioni ma non basta come garanzia: qui la correttezza
// sta nella verifica a valle. Ogni mutazione marchia i propri eventi con un id;
// dopo la scrittura si rilegge, e se quegli eventi non ci sono la scrittura è
// stata persa (sovrascritta da un'altra invocazione) e si riparte da capo sullo
// stato fresco. Nessun aggiornamento può quindi sparire in silenzio.
async function mutaStanza(roomId, mutatore) {
  for (let tentativo = 0; tentativo < MUTA_TENTATIVI; tentativo++) {
    const mid = crypto.randomBytes(5).toString('hex');

    const esito = await conLock(roomId, async () => {
      const room = await leggiStanza(roomId);
      if (!room) return { errore: 'Stanza non trovata.' };

      room._mid = mid;                       // raccolto da push()
      const out = mutatore(room) || {};
      delete room._mid;
      if (out.errore || out.soloLettura) return out;

      await store().setJSON(chiave(roomId), room);
      // Una mutazione senza eventi (solo lastSeen) non è verificabile né vale
      // un retry: se va persa, il polling successivo la rifà.
      const tracciabile = room.events.some(e => e.mid === mid);
      return { ...out, room, mid: tracciabile ? mid : null };
    });

    if (esito.errore || esito.soloLettura || !esito.mid) return esito;

    const dopo = await leggiStanza(roomId);
    if (dopo && dopo.events.some(e => e.mid === mid)) return { ...esito, room: dopo };

    await attendi(50 + tentativo * 40);
  }
  return { errore: 'Server occupato, riprova.' };
}

// ── LOG EVENTI ────────────────────────────────────────
// to = null → evento per tutta la stanza; altrimenti solo per quel token.
// dopo = ritardo in ms prima che l'evento diventi consegnabile.
function push(room, name, data, to = null, dopo = 0) {
  room.seq = (room.seq || 0) + 1;
  room.events.push({ seq: room.seq, to, name, data, at: Date.now() + dopo, mid: room._mid });
  if (room.events.length > MAX_EVENTI) room.events = room.events.slice(-MAX_EVENTI);
}

// Consegna in ordine di seq, fermandosi al primo evento ancora "in ritardo":
// così la pausa di fine partita resta visibile come nell'originale.
function raccogli(room, token, cursor) {
  const ora = Date.now();
  const out = [];
  let nuovoCursor = cursor;
  for (const e of room.events) {
    if (e.seq <= cursor) continue;
    if (e.at > ora) break;
    nuovoCursor = e.seq;
    if (e.to === null || e.to === token) out.push({ name: e.name, data: e.data });
  }
  return { events: out, cursor: nuovoCursor };
}

// ── MAZZO ─────────────────────────────────────────────
function creaMazzo() {
  const m = [];
  for (const s of SEMI) for (const v of VALORI) m.push({ seme:s, valore:v, punti:PUNTI[v] });
  for (let i = m.length-1; i > 0; i--) {
    const j = crypto.randomInt(i + 1); [m[i],m[j]] = [m[j],m[i]];
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
function nuovaPartita(giocatori, primoIdx = 0) {
  const mazzo = creaMazzo();
  const mani={}, punteggiIndividuali={}, prese={};

  for (const g of giocatori) {
    mani[g.token]                = [];
    punteggiIndividuali[g.token] = 0;
    prese[g.token]               = [];
  }

  const briscolaCard = mazzo.pop();
  mazzo.unshift(briscolaCard);

  for (const g of giocatori) {
    mani[g.token] = [mazzo.pop(), mazzo.pop(), mazzo.pop()];
  }

  const squadre = giocatori.length === 4 ? assegnaSquadre(giocatori) : null;

  return {
    giocatori: giocatori.map(g => ({ token: g.token, nome: g.nome })),
    mani, mazzo,
    briscola: briscolaCard,
    squadre,
    turnoDi: giocatori[primoIdx % giocatori.length].token,
    carteGiocate: [], semePartenza: null,
    punteggiIndividuali,
    punteggiSquadra: squadre ? { A: 0, B: 0 } : null,
    prese, finita: false,
    briscolaPresa: false,
  };
}

function punteggiPerClient(game) {
  if (game.squadre) {
    const map = {};
    for (const g of game.giocatori) {
      map[g.token] = game.punteggiSquadra[squadraDi(g.token, game.squadre)] || 0;
    }
    return map;
  }
  return game.punteggiIndividuali;
}

const pubblici = giocatori => giocatori.map(g => ({ token: g.token, nome: g.nome }));

// ── AVVIA PARTITA ─────────────────────────────────────
function avviaPartita(room) {
  room.stato         = 'in_gioco';
  room.rematchPronti = [];
  room.numeroPartita = (room.numeroPartita || 0) + 1;
  room.creata        = Date.now();
  const primoIdx     = (room.numeroPartita - 1) % room.giocatori.length;
  room.game          = nuovaPartita(room.giocatori, primoIdx);
  const g = room.game;

  for (const gioc of room.giocatori) {
    const compagno = g.squadre ? compagnoDi(gioc.token, g.squadre) : null;
    push(room, 'partita_iniziata', {
      token:          gioc.token,
      giocatori:      pubblici(g.giocatori),
      mano:           g.mani[gioc.token],
      briscola:       g.briscola,
      turnoDi:        g.turnoDi,
      punteggi:       punteggiPerClient(g),
      mazzoRimanente: g.mazzo.length,
      squadre:        g.squadre,
      compagnoToken:  compagno,
      compagnoNome:   compagno ? (g.giocatori.find(x => x.token === compagno)?.nome || null) : null,
      numeroPartita:  room.numeroPartita,
    }, gioc.token);
  }
}

// ── FINE PARTITA ──────────────────────────────────────
// Nell'originale era un setTimeout; qui l'evento nasce subito ma
// diventa consegnabile solo dopo la pausa.
function finePartita(room, dopo) {
  const g = room.game;
  const ora = Date.now();
  room.stato         = 'finita';
  room.rematchPronti = [];
  room.finitaAt      = ora + dopo;
  for (const gioc of room.giocatori) {
    gioc.lastSeen = Math.max(gioc.lastSeen || 0, ora + dopo);
  }

  let risultati;
  if (g.squadre) {
    const nomi = tokens => tokens.map(t => g.giocatori.find(x => x.token === t)?.nome || '?');
    risultati = [
      { squadra:'A', nomi: nomi(g.squadre.A), tokens: g.squadre.A, punti: g.punteggiSquadra.A },
      { squadra:'B', nomi: nomi(g.squadre.B), tokens: g.squadre.B, punti: g.punteggiSquadra.B },
    ].sort((a,b) => b.punti - a.punti);
  } else {
    risultati = room.giocatori
      .map(p => ({ token:p.token, nome:p.nome, punti:g.punteggiIndividuali[p.token]||0 }))
      .sort((a,b) => b.punti - a.punti);
  }

  push(room, 'partita_finita', {
    risultati, vincitore: risultati[0], modalitaSquadre: !!g.squadre,
  }, null, dopo);
}

// ── PRESENZA ──────────────────────────────────────────
// Rimpiazza l'evento 'disconnect' del socket: chi smette di fare polling
// viene considerato assente. Ritorna true se ha modificato la stanza.
function aggiornaPresenza(room, token) {
  const ora = Date.now();
  let modificata = false;

  const me = room.giocatori.find(g => g.token === token);
  if (me && ora - (me.lastSeen || 0) > PRESENZA_MIN_GAP) {
    me.lastSeen = ora;
    me.assente  = false;
    modificata  = true;
  }

  if (room.stato === 'attesa') {
    const vivi = room.giocatori.filter(g => ora - (g.lastSeen || 0) < TIMEOUT_LOBBY);
    if (vivi.length !== room.giocatori.length) {
      room.giocatori = vivi;
      push(room, 'aggiornamento_lobby', {
        giocatori: pubblici(room.giocatori), maxGiocatori: room.maxGiocatori,
      });
      modificata = true;
    }
  } else if (room.stato === 'in_gioco') {
    for (const g of room.giocatori) {
      if (g.token !== token && !g.assente && ora - (g.lastSeen || 0) > TIMEOUT_GIOCO) {
        g.assente = true;
        push(room, 'giocatore_disconnesso', { msg: `${g.nome} si è disconnesso.` });
        modificata = true;
      }
    }
  } else if (room.stato === 'finita' && ora > (room.finitaAt || 0)) {
    if (ora - (room.finitaAt || 0) > TIMEOUT_RIVINCITA) {
      room.stato = 'chiusa';
      push(room, 'giocatore_uscito', { nome: null, msg: 'Tempo scaduto per una nuova partita.' });
      modificata = true;
    } else {
      const uscito = room.giocatori.find(g => g.token !== token && ora - (g.lastSeen || 0) > TIMEOUT_LOBBY);
      if (uscito) {
        room.stato = 'chiusa';
        push(room, 'giocatore_uscito', { nome: uscito.nome, msg: `${uscito.nome} ha lasciato la stanza.` });
        modificata = true;
      }
    }
  }
  return modificata;
}

// ══════════════════════════════════════════════════════
// AZIONI
// ══════════════════════════════════════════════════════

async function creaStanza({ nome, maxGiocatori }) {
  const roomId = crypto.randomBytes(3).toString('hex').slice(0,5).toUpperCase();
  const token  = mkToken();
  const room = {
    id: roomId, maxGiocatori: maxGiocatori || 2, stato: 'attesa', game: null,
    giocatori: [{ token, nome, lastSeen: Date.now(), assente: false }],
    events: [], seq: 0, creata: Date.now(),
  };
  push(room, 'stanza_creata', { token, roomId, giocatori: pubblici(room.giocatori) }, token);

  const w = await store().setJSON(chiave(roomId), room, { onlyIfNew: true });
  if (!w.modified) return { errore: 'Codice stanza già in uso, riprova.' };

  return { room, token, roomId, cursorForzato: 0 };
}

async function entraStanza({ nome, roomId }) {
  let token = mkToken();
  const esito = await mutaStanza(roomId, room => {
    if (room.stato !== 'attesa')                        return { errore: 'Partita già iniziata.' };
    if (room.giocatori.length >= room.maxGiocatori)     return { errore: 'Stanza piena.' };

    room.giocatori.push({ token, nome, lastSeen: Date.now(), assente: false });
    push(room, 'aggiornamento_lobby', {
      giocatori: pubblici(room.giocatori), maxGiocatori: room.maxGiocatori,
    });
    if (room.giocatori.length === room.maxGiocatori) avviaPartita(room);
  });
  if (esito.errore) return esito;
  return { room: esito.room, token, roomId, cursorForzato: 0 };
}

async function riconnetti({ roomId, token }) {
  const room = await leggiStanza(roomId);
  if (!room || !room.game || room.stato !== 'in_gioco') {
    return { eventiDiretti: [{ name: 'riconnessione_fallita', data: {} }] };
  }
  const g = room.giocatori.find(x => x.token === token);
  if (!g) return { eventiDiretti: [{ name: 'riconnessione_fallita', data: {} }] };

  const game     = room.game;
  const compagno = game.squadre ? compagnoDi(token, game.squadre) : null;

  // Lo stato completo va solo a chi rientra: non passa dal log condiviso,
  // che potrebbe aver già scartato gli eventi vecchi.
  const stato = {
    token,
    giocatori:      pubblici(game.giocatori),
    mano:           game.mani[token],
    briscola:       game.briscola,
    turnoDi:        game.turnoDi,
    punteggi:       punteggiPerClient(game),
    mazzoRimanente: game.mazzo.length,
    carteGiocate:   game.carteGiocate,
    squadre:        game.squadre,
    compagnoToken:  compagno,
    compagnoNome:   compagno ? (game.giocatori.find(x => x.token === compagno)?.nome || null) : null,
    briscolaPresa:  game.briscolaPresa,
  };

  if (g.assente) {
    await mutaStanza(roomId, r => {
      const gg = r.giocatori.find(x => x.token === token);
      if (!gg || !gg.assente) return { soloLettura: true };
      gg.assente  = false;
      gg.lastSeen = Date.now();
      push(r, 'giocatore_riconnesso', { msg: `${gg.nome} è tornato in partita.` });
    });
  }

  // Il cursore riparte dalla fine: lo stato appena inviato è già aggiornato.
  const fresco = await leggiStanza(roomId);
  return {
    room: fresco,
    cursorForzato: fresco.seq,
    eventiDiretti: [{ name: 'partita_ripresa', data: stato }],
  };
}

async function giocaCarta({ roomId, token, carta }) {
  return mutaStanza(roomId, room => {
    const game = room.game;
    if (!game || room.stato !== 'in_gioco') return { errore: 'Partita non attiva.' };
    if (game.turnoDi !== token)             return { errore: 'Non è il tuo turno.' };

    const mano = game.mani[token];
    if (!mano)                              return { errore: 'Mano non trovata.' };
    const idx = mano.findIndex(c => c.seme === carta.seme && c.valore === carta.valore);
    if (idx === -1)                         return { errore: 'Carta non in mano.' };

    mano.splice(idx, 1);
    if (game.carteGiocate.length === 0) game.semePartenza = carta.seme;
    game.carteGiocate.push({ token, carta });

    push(room, 'carta_giocata', { token, carta, carteGiocate: game.carteGiocate });

    const nG = game.giocatori.length;
    if (game.carteGiocate.length < nG) {
      const ci = game.giocatori.findIndex(g => g.token === game.turnoDi);
      game.turnoDi = game.giocatori[(ci+1) % nG].token;
      push(room, 'turno', { token: game.turnoDi });
      return;
    }

    // ── Vincitore mano ────────────────────────────────
    const wIdx = calcolaVincitore(game.carteGiocate, game.semePartenza, game.briscola.seme);
    const wTok = game.carteGiocate[wIdx].token;

    let puntiMano = 0;
    for (const cg of game.carteGiocate) {
      game.prese[wTok].push(cg.carta);
      game.punteggiIndividuali[wTok] += cg.carta.punti;
      puntiMano += cg.carta.punti;
    }
    if (game.squadre) game.punteggiSquadra[squadraDi(wTok, game.squadre)] += puntiMano;

    push(room, 'fine_mano', {
      vincitoreToken: wTok,
      carteGiocate:   game.carteGiocate,
      punteggi:       punteggiPerClient(game),
    });

    game.carteGiocate = [];
    game.semePartenza = null;
    game.turnoDi      = wTok;

    // ── Pesca ─────────────────────────────────────────
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
        game.briscolaPresa = true;
        push(room, 'briscola_presa', { token: g.token, nome: g.nome, briscola: bCard });
      }
    }

    // Conteggio mazzo uniforme: le mani partono dopo che tutti hanno pescato.
    for (const g of ordinePesca) {
      push(room, 'aggiornamento_mano', {
        mano:           game.mani[g.token],
        mazzoRimanente: game.mazzo.length,
        punteggi:       punteggiPerClient(game),
      }, g.token);
    }

    if (game.giocatori.every(g => (game.mani[g.token] || []).length === 0)) {
      finePartita(room, PAUSA_FINE_PARTITA);
    } else {
      push(room, 'turno', { token: game.turnoDi });
    }
  });
}

async function chiediNuovaPartita({ roomId, token }) {
  return mutaStanza(roomId, room => {
    const g = room.giocatori.find(x => x.token === token);
    if (!g) return { errore: 'Giocatore non trovato.' };
    if (room.stato !== 'finita') return { soloLettura: true, room };

    g.lastSeen = Date.now();
    g.assente  = false;

    room.rematchPronti = room.rematchPronti || [];
    if (room.rematchPronti.includes(token)) return { soloLettura: true, room };
    room.rematchPronti.push(token);

    const nomiPronti = room.rematchPronti
      .map(t => room.giocatori.find(x => x.token === t)?.nome)
      .filter(Boolean);

    push(room, 'aggiornamento_rivincita', {
      pronti: [...room.rematchPronti],
      totale: room.giocatori.length,
      nomiPronti,
    });

    if (room.rematchPronti.length === room.giocatori.length) {
      avviaPartita(room);
    }
  });
}

async function lasciaStanza({ roomId, token }) {
  if (!roomId || !token) return { soloLettura: true };
  return mutaStanza(roomId, room => {
    if (room.stato !== 'finita') return { soloLettura: true };
    const g = room.giocatori.find(x => x.token === token);
    if (!g) return { soloLettura: true };
    room.stato = 'chiusa';
    push(room, 'giocatore_uscito', {
      nome: g.nome,
      msg:  `${g.nome} ha lasciato la stanza.`,
    });
  });
}

async function poll({ roomId, token }) {
  const room = await leggiStanza(roomId);
  if (!room) return { errore: 'Stanza non trovata.' };

  // Le stanze non si cancellano da sole: la prima chiamata dopo la scadenza pulisce.
  if (Date.now() - (room.creata || 0) > TTL_STANZA) {
    await store().delete(chiave(roomId));
    return { errore: 'Stanza scaduta.' };
  }

  // Il polling normale è in sola lettura. Si prende il lock solo quando c'è
  // davvero qualcosa da annotare (presenza scaduta o giocatore assente),
  // altrimenti ogni giro di ogni giocatore sarebbe una scrittura.
  const bozza = structuredClone(room);
  if (!aggiornaPresenza(bozza, token)) return { room };

  const esito = await mutaStanza(roomId, r => { aggiornaPresenza(r, token); });
  return esito.room ? { room: esito.room } : { room };
}

// ══════════════════════════════════════════════════════
// HANDLER HTTP
// ══════════════════════════════════════════════════════

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export default async (req) => {
  if (req.method !== 'POST') return json({ errore: 'Metodo non consentito.' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ errore: 'Richiesta non valida.' }, 400); }

  const azione = new URL(req.url).pathname.split('/').pop();
  const cursor = Number(body.cursor) || 0;

  try {
    let esito;
    switch (azione) {
      case 'crea_stanza':   esito = await creaStanza(body); break;
      case 'entra_stanza':  esito = await entraStanza(body); break;
      case 'riconnetti':    esito = await riconnetti(body); break;
      case 'gioca_carta':   esito = await giocaCarta(body); break;
      case 'nuova_partita': esito = await chiediNuovaPartita(body); break;
      case 'lascia_stanza': esito = await lasciaStanza(body); break;
      case 'poll':          esito = await poll(body); break;
      default: return json({ errore: 'Azione sconosciuta.' }, 404);
    }

    // Gli errori di gioco tornano come evento 'errore', come faceva socket.emit.
    if (esito.errore) {
      return json({ cursor, events: [{ name: 'errore', data: { msg: esito.errore } }] });
    }

    const token = esito.token || body.token;
    const base  = esito.cursorForzato != null ? esito.cursorForzato : cursor;
    const dal   = esito.room ? raccogli(esito.room, token, base) : { events: [], cursor: base };

    return json({
      roomId: esito.roomId || body.roomId,
      token,
      cursor: dal.cursor,
      events: [...(esito.eventiDiretti || []), ...dal.events],
      stato:  esito.room?.stato,
    });
  } catch (err) {
    console.error(`[${azione}]`, err);
    return json({ errore: 'Errore interno.', cursor, events: [
      { name: 'errore', data: { msg: 'Errore del server, riprova.' } },
    ] }, 500);
  }
};

export const config = { path: '/api/:azione' };
