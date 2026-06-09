// ══════════════════════════════════════════════════════
// game.js — Briscola Client
// ══════════════════════════════════════════════════════

const socket = io();

// ── STATO ──────────────────────────────────────────────
let state = null;  // dati partita dal sessionStorage
let myId  = null;
let mioTurno = false;

// Simboli semi
const SEMI_SYMBOL = {
  bastoni: '🪄',
  coppe:   '🏆',
  denari:  '🪙',
  spade:   '⚔️',
};

const SEMI_COLOR = {
  bastoni: '#8B4513',
  coppe:   '#c8392b',
  denari:  '#B8860B',
  spade:   '#1a1a2e',
};

const NOME_VALORE = {
  'A': 'Asso', '3': 'Tre', 'K': 'Re', 'Q': 'Cavallo',
  'J': 'Fante', '7': 'Sette', '6': 'Sei', '5': 'Cinque',
  '4': 'Quattro', '2': 'Due',
};

const PUNTI_VALORE = { 'A':11,'3':10,'K':4,'Q':3,'J':2,'7':0,'6':0,'5':0,'4':0,'2':0 };

// ── INIT ───────────────────────────────────────────────

(function init() {
  const raw = sessionStorage.getItem('briscola_game');
  if (!raw) { window.location.href = '/'; return; }

  state = JSON.parse(raw);
  myId  = state.socketId;

  const me = state.giocatori.find(g => g.id === myId);
  document.getElementById('my-name').textContent = me ? me.nome : 'Tu';

  // Render briscola
  renderBriscola(state.briscola);
  // Render mano iniziale
  renderMyHand(state.mano);
  // Render avversari
  renderOpponents(state.giocatori, {});
  // Mazzo
  updateDeckCount(state.mazzoRimanente);
  // Turno
  updateTurn(state.turnoDi);
})();

// ── EVENTI SOCKET ──────────────────────────────────────

socket.on('carta_giocata', ({ socketId, carta, carteGiocate }) => {
  renderPlayedCards(carteGiocate);
});

socket.on('turno', ({ socketId }) => {
  updateTurn(socketId);
});

socket.on('fine_mano', ({ vincitore, carteGiocate, punteggi }) => {
  const vNome = state.giocatori.find(g => g.id === vincitore)?.nome || '—';
  showToast(`${vincitore === myId ? 'Hai preso' : vNome + ' prende'} la mano!`);

  // Aggiorna punteggi
  updateScores(punteggi);
  document.getElementById('my-score').textContent = punteggi[myId] || 0;

  // Svuota il tavolo dopo 1.2s
  setTimeout(() => {
    document.getElementById('played-cards').innerHTML = '';
  }, 1200);
});

socket.on('carta_pescata', ({ carta }) => {
  // La carta pescata viene aggiunta tramite aggiornamento_mano
});

socket.on('aggiornamento_mano', ({ mano, mazzoRimanente }) => {
  state.mano = mano;
  renderMyHand(mano);
  updateDeckCount(mazzoRimanente);
});

socket.on('partita_finita', ({ risultati, vincitore, briscola }) => {
  showEndModal(risultati, vincitore);
});

socket.on('giocatore_disconnesso', ({ msg }) => {
  showToast(msg, 4000);
});

socket.on('errore', ({ msg }) => {
  showToast('⚠ ' + msg, 3000);
});

// ── RENDER ─────────────────────────────────────────────

function renderBriscola(briscola) {
  const slot = document.getElementById('briscola-slot');
  slot.innerHTML = `
    <div class="slot-label">Briscola</div>
    ${cartaHTML(briscola, false, 'briscola-card')}
  `;
}

function renderMyHand(mano) {
  const container = document.getElementById('my-hand');
  container.innerHTML = '';
  mano.forEach(carta => {
    const el = document.createElement('div');
    el.className = 'carta mia-carta' + (mioTurno ? ' giocabile' : '');
    el.innerHTML = cartaInnerHTML(carta);
    el.style.setProperty('--suit-color', SEMI_COLOR[carta.seme]);
    if (mioTurno) {
      el.onclick = () => giocaCarta(carta);
    }
    container.appendChild(el);
  });
}

function renderOpponents(giocatori, punteggi) {
  const row = document.getElementById('opponents-row');
  row.innerHTML = '';
  giocatori.filter(g => g.id !== myId).forEach(g => {
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
        ${Array(3).fill('<div class="carta carta-retro"></div>').join('')}
      </div>
    `;
    row.appendChild(div);
  });
}

function renderPlayedCards(carteGiocate) {
  const container = document.getElementById('played-cards');
  container.innerHTML = '';
  carteGiocate.forEach(cg => {
    const g    = state.giocatori.find(g => g.id === cg.socketId);
    const nome = g ? g.nome : '?';
    const wrap = document.createElement('div');
    wrap.className = 'played-card-wrap';
    wrap.innerHTML = `
      <div class="played-player-name">${cg.socketId === myId ? 'Tu' : nome}</div>
      ${cartaHTML(cg.carta, false, 'played')}
    `;
    container.appendChild(wrap);
  });
}

// ── CARTA HTML ─────────────────────────────────────────

function cartaHTML(carta, retro = false, extraClass = '') {
  if (retro) return `<div class="carta carta-retro ${extraClass}"></div>`;
  const el = document.createElement('div');
  el.className = `carta ${extraClass}`;
  el.style.setProperty('--suit-color', SEMI_COLOR[carta.seme]);
  el.innerHTML = cartaInnerHTML(carta);
  return el.outerHTML;
}

function cartaInnerHTML(carta) {
  const sym  = SEMI_SYMBOL[carta.seme];
  const pts  = PUNTI_VALORE[carta.valore];
  const nome = NOME_VALORE[carta.valore];
  return `
    <div class="carta-top">${carta.valore}<br><small>${sym}</small></div>
    <div class="carta-center">${sym}</div>
    <div class="carta-bottom">${carta.valore}<br><small>${sym}</small></div>
    ${pts > 0 ? `<div class="carta-pts">${pts}pt</div>` : ''}
    <div class="carta-nome">${nome}</div>
  `;
}

// ── TURNO ──────────────────────────────────────────────

function updateTurn(socketId) {
  mioTurno = socketId === myId;
  const badge = document.getElementById('turn-badge');

  if (mioTurno) {
    badge.textContent = '🟢 Tuo turno';
    badge.className   = 'turn-badge active';
  } else {
    const g = state.giocatori.find(g => g.id === socketId);
    badge.textContent = `⏳ Turno di ${g ? g.nome : '…'}`;
    badge.className   = 'turn-badge';
  }

  // Riabilita/disabilita le carte
  document.querySelectorAll('.mia-carta').forEach(el => {
    el.classList.toggle('giocabile', mioTurno);
    el.onclick = mioTurno
      ? () => giocaCartaFromEl(el)
      : null;
  });
}

// ── GIOCA CARTA ────────────────────────────────────────

function giocaCarta(carta) {
  if (!mioTurno) return;
  mioTurno = false; // previene doppio click
  socket.emit('gioca_carta', { carta });

  // Aggiorna localmente la mano (ottimistic UI)
  state.mano = state.mano.filter(c => !(c.seme === carta.seme && c.valore === carta.valore));
  renderMyHand(state.mano);

  // Aggiorna turno badge
  document.getElementById('turn-badge').textContent = '⏳ In attesa…';
  document.getElementById('turn-badge').className   = 'turn-badge';
}

function giocaCartaFromEl(el) {
  // recupera la carta dall'elemento (non usato, manteniamo l'approccio data-driven)
}

// ── PUNTEGGI ───────────────────────────────────────────

function updateScores(punteggi) {
  state.giocatori.forEach(g => {
    const el = document.getElementById(`pts-${g.id}`);
    if (el) el.textContent = `${punteggi[g.id] || 0} pt`;
  });
}

function updateDeckCount(n) {
  document.getElementById('deck-count').textContent = `🂠 ${n}`;
}

function openScores()  { document.getElementById('scores-panel').style.display = 'flex'; }
function closeScores() { document.getElementById('scores-panel').style.display = 'none'; }

// ── FINE PARTITA ───────────────────────────────────────

function showEndModal(risultati, vincitore) {
  const isWinner = vincitore.id === myId;
  document.getElementById('modal-icon').textContent    = isWinner ? '🏆' : '😔';
  document.getElementById('modal-title').textContent   = isWinner ? 'Hai vinto!' : `${vincitore.nome} vince!`;
  document.getElementById('modal-subtitle').textContent = `con ${vincitore.punti} punti`;

  const list = document.getElementById('results-list');
  list.innerHTML = risultati.map((r, i) => `
    <div class="result-row ${r.id === myId ? 'is-me' : ''}">
      <span class="result-pos">${i + 1}°</span>
      <span class="result-name">${r.nome}${r.id === myId ? ' (Tu)' : ''}</span>
      <span class="result-pts">${r.punti} pt</span>
    </div>
  `).join('');

  document.getElementById('modal-end').style.display = 'flex';
}

// ── TOAST ──────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), ms);
}