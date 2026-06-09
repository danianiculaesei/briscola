// ══════════════════════════════════════════════════════
// game.js — Briscola Client
// ══════════════════════════════════════════════════════

const socket = io();

// ── STATO ─────────────────────────────────────────────
let gameData    = null;   // dati partita
let myId        = null;   // socket.id corrente
let myNome      = null;
let myRoomId    = null;
let mioTurno    = false;
let punteggi    = {};

// ── SIMBOLI E NOMI ────────────────────────────────────
const SEMI_IT = { bastoni:'Bastoni', coppe:'Coppe', denari:'Denari', spade:'Spade' };
const NOME_VALORE = {
  'A':'Asso','3':'Tre','K':'Re','Q':'Cavallo','J':'Fante',
  '7':'Sette','6':'Sei','5':'Cinque','4':'Quattro','2':'Due'
};
const PUNTI_VALORE = { 'A':11,'3':10,'K':4,'Q':3,'J':2,'7':0,'6':0,'5':0,'4':0,'2':0 };

// ── COLORI SEMI ───────────────────────────────────────
const COLORE_SEME = {
  bastoni: '#5a3000',
  coppe:   '#8B0000',
  denari:  '#7a6000',
  spade:   '#1a1a3a',
};

// ── INIT ──────────────────────────────────────────────
(function init() {
  const raw = sessionStorage.getItem('briscola_game');
  if (!raw) { window.location.href = '/'; return; }

  gameData = JSON.parse(raw);
  myNome   = gameData.myNome;
  myRoomId = gameData.roomId;

  // Riconnettiti al server con nome + stanza
  socket.emit('riconnetti', { nome: myNome, roomId: myRoomId });
})();

// ── SOCKET EVENTI ─────────────────────────────────────

// Stato ripristinato dopo riconnessione
socket.on('partita_ripresa', (data) => {
  myId     = socket.id;
  punteggi = data.punteggi || {};
  setupGame(data);
});

// Prima connessione (fallback se la pagina non viene ricaricata)
socket.on('partita_iniziata', (data) => {
  myId     = socket.id;
  punteggi = data.punteggi || {};
  setupGame(data);
});

socket.on('carta_giocata', ({ socketId, carta, carteGiocate }) => {
  renderPlayedCards(carteGiocate);
  // Aggiorna le carte coperte dell'avversario
  const g = gameData.giocatori.find(g => g.id === socketId);
  if (g && socketId !== myId) {
    const handEl = document.getElementById(`hand-${socketId}`);
    if (handEl) {
      const cards = handEl.querySelectorAll('.carta-retro');
      if (cards.length > 0) cards[cards.length - 1].remove();
    }
  }
});

socket.on('turno', ({ socketId }) => {
  updateTurn(socketId);
});

socket.on('fine_mano', ({ vincitore, carteGiocate, punteggi: pts }) => {
  punteggi = pts;
  const vNome = gameData.giocatori.find(g => g.id === vincitore)?.nome || '?';
  showToast(vincitore === myId ? '🃏 Hai preso la mano!' : `🃏 ${vNome} prende la mano!`);
  updateAllScores();
  setTimeout(() => {
    document.getElementById('played-cards').innerHTML = '';
  }, 1000);
});

socket.on('aggiornamento_mano', ({ mano, mazzoRimanente, punteggi: pts }) => {
  gameData.mano = mano;
  punteggi      = pts || punteggi;
  renderMyHand(mano);
  updateDeckCount(mazzoRimanente);
  updateAllScores();
});

socket.on('partita_finita', ({ risultati, vincitore }) => {
  showEndModal(risultati, vincitore);
});

socket.on('giocatore_disconnesso', ({ msg }) => {
  showToast('⚠ ' + msg, 5000);
});

socket.on('errore', ({ msg }) => {
  showToast('⚠ ' + msg, 3000);
  console.error('Errore server:', msg);
});

// ── SETUP ─────────────────────────────────────────────

function setupGame(data) {
  gameData = { ...gameData, ...data };

  const me = data.giocatori.find(g => g.nome === myNome);
  if (me) {
    myId    = me.id;
    gameData.mano = data.mano;
  }

  document.getElementById('my-name').textContent = myNome;

  renderBriscola(data.briscola);
  renderOpponents(data.giocatori);
  renderMyHand(data.mano || gameData.mano);
  updateDeckCount(data.mazzoRimanente);
  updateAllScores();

  if (data.carteGiocate && data.carteGiocate.length > 0) {
    renderPlayedCards(data.carteGiocate);
  }

  updateTurn(data.turnoDi);
}

// ── RENDER BRISCOLA ───────────────────────────────────

function renderBriscola(briscola) {
  const slot = document.getElementById('briscola-slot');
  slot.innerHTML = `
    <div class="slot-label">Briscola</div>
    <div class="carta briscola-card" style="--suit-color:${COLORE_SEME[briscola.seme]}">
      ${cartaInnerHTML(briscola)}
    </div>
  `;
}

// ── RENDER MANO ───────────────────────────────────────

function renderMyHand(mano) {
  const container = document.getElementById('my-hand');
  container.innerHTML = '';
  if (!mano) return;

  mano.forEach(carta => {
    const el = document.createElement('div');
    el.className = 'carta mia-carta' + (mioTurno ? ' giocabile' : '');
    el.style.setProperty('--suit-color', COLORE_SEME[carta.seme]);
    el.innerHTML = cartaInnerHTML(carta);
    if (mioTurno) el.onclick = () => giocaCarta(carta, el);
    container.appendChild(el);
  });
}

// ── RENDER AVVERSARI ──────────────────────────────────

function renderOpponents(giocatori) {
  const row = document.getElementById('opponents-row');
  row.innerHTML = '';

  giocatori.filter(g => g.nome !== myNome).forEach(g => {
    const div = document.createElement('div');
    div.className = 'opponent-slot';
    div.id = `opp-${g.id}`;
    div.innerHTML = `
      <div class="opp-avatar">${g.nome[0].toUpperCase()}</div>
      <div class="opp-info">
        <span class="opp-name">${g.nome}</span>
        <span class="opp-pts" id="pts-${g.id}">${punteggi[g.id] || 0} pt</span>
      </div>
      <div class="opp-hand" id="hand-${g.id}">
        <div class="carta carta-retro"></div>
        <div class="carta carta-retro"></div>
        <div class="carta carta-retro"></div>
      </div>
    `;
    row.appendChild(div);
  });
}

// ── RENDER CARTE GIOCATE ──────────────────────────────

function renderPlayedCards(carteGiocate) {
  const container = document.getElementById('played-cards');
  container.innerHTML = '';
  carteGiocate.forEach(cg => {
    const g    = gameData.giocatori.find(g => g.id === cg.socketId);
    const nome = g ? g.nome : '?';
    const wrap = document.createElement('div');
    wrap.className = 'played-card-wrap';
    wrap.innerHTML = `
      <div class="played-player-name">${cg.socketId === myId ? 'Tu' : nome}</div>
      <div class="carta played" style="--suit-color:${COLORE_SEME[cg.carta.seme]}">
        ${cartaInnerHTML(cg.carta)}
      </div>
    `;
    container.appendChild(wrap);
  });
}

// ── HTML CARTA ────────────────────────────────────────

function cartaInnerHTML(carta) {
  const pts    = PUNTI_VALORE[carta.valore];
  const semeIt = SEMI_IT[carta.seme];
  const nomeV  = NOME_VALORE[carta.valore];
  const sym    = semeSymbol(carta.seme);

  return `
    <div class="c-corner c-tl">
      <span class="c-val">${carta.valore}</span>
      <span class="c-sym">${sym}</span>
    </div>
    <div class="c-center">
      <span class="c-sym-big">${sym}</span>
    </div>
    <div class="c-corner c-br">
      <span class="c-val">${carta.valore}</span>
      <span class="c-sym">${sym}</span>
    </div>
    ${pts > 0 ? `<div class="c-pts">${pts}pt</div>` : ''}
    <div class="c-name">${nomeV} di ${semeIt}</div>
  `;
}

function semeSymbol(seme) {
  const s = { bastoni:'🏑', coppe:'🏆', denari:'💰', spade:'⚔️' };
  return s[seme] || '?';
}

// ── TURNO ─────────────────────────────────────────────

function updateTurn(socketId) {
  // Cerca per ID o per nome (dopo riconnessione gli ID possono cambiare)
  const isMe  = socketId === myId;
  mioTurno    = isMe;
  const badge = document.getElementById('turn-badge');

  if (isMe) {
    badge.textContent = '🟢 Tuo turno — gioca una carta!';
    badge.className   = 'turn-badge active';
  } else {
    const g = gameData.giocatori.find(g => g.id === socketId);
    badge.textContent = `⏳ Turno di ${g ? g.nome : '…'}`;
    badge.className   = 'turn-badge';
  }

  // Riabilita/disabilita le carte
  document.querySelectorAll('.mia-carta').forEach(el => {
    el.classList.toggle('giocabile', mioTurno);
  });
  renderMyHand(gameData.mano);
}

// ── GIOCA CARTA ───────────────────────────────────────

function giocaCarta(carta, el) {
  if (!mioTurno) return;
  mioTurno = false;

  // Feedback visivo immediato
  if (el) { el.classList.add('playing'); el.onclick = null; }

  socket.emit('gioca_carta', { carta });

  // Aggiorna mano localmente (ottimistico)
  gameData.mano = gameData.mano.filter(
    c => !(c.seme === carta.seme && c.valore === carta.valore)
  );

  // Aggiorna turno badge
  document.getElementById('turn-badge').textContent = '⏳ In attesa…';
  document.getElementById('turn-badge').className   = 'turn-badge';
}

// ── PUNTEGGI ──────────────────────────────────────────

function updateAllScores() {
  const myPts = punteggi[myId] || 0;
  document.getElementById('my-score').textContent = myPts;

  gameData.giocatori.forEach(g => {
    const el = document.getElementById(`pts-${g.id}`);
    if (el) el.textContent = `${punteggi[g.id] || 0} pt`;
  });
}

function updateDeckCount(n) {
  document.getElementById('deck-count').textContent = `🂠 ${n}`;
}

function openScores()  { document.getElementById('scores-panel').style.display = 'flex'; }
function closeScores() { document.getElementById('scores-panel').style.display = 'none'; }

// ── FINE PARTITA ──────────────────────────────────────

function showEndModal(risultati, vincitore) {
  const isWinner = vincitore.nome === myNome;
  document.getElementById('modal-icon').textContent    = isWinner ? '🏆' : '😔';
  document.getElementById('modal-title').textContent   = isWinner ? 'Hai vinto!' : `${vincitore.nome} vince!`;
  document.getElementById('modal-subtitle').textContent = `con ${vincitore.punti} punti su 120`;

  document.getElementById('results-list').innerHTML = risultati.map((r, i) => `
    <div class="result-row ${r.nome === myNome ? 'is-me' : ''}">
      <span class="result-pos">${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>
      <span class="result-name">${r.nome}${r.nome === myNome ? ' (Tu)' : ''}</span>
      <span class="result-pts">${r.punti} pt</span>
    </div>
  `).join('');

  document.getElementById('modal-end').style.display = 'flex';
}

// ── TOAST ─────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), ms);
}
