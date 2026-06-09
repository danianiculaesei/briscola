// ══════════════════════════════════════════════════════
// carte.js — SVG delle 40 carte italiane
// ══════════════════════════════════════════════════════

const CARTE_SVG = {};

// ── PALETTE ───────────────────────────────────────────
const C = {
  oro:    '#DAA520',
  oro2:   '#FFD700',
  rosso:  '#C41E3A',
  verde:  '#2D6A1F',
  blu:    '#1A3A7A',
  nero:   '#1a1a1a',
  bianco: '#FFFEF5',
  skin:   '#F5CBA7',
};

// ── WRAPPER SVG ───────────────────────────────────────
function svg(content, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 105" ${extra}>
    <rect width="70" height="105" rx="5" fill="${C.bianco}" stroke="#c8a96e" stroke-width="1.5"/>
    <rect x="3" y="3" width="64" height="99" rx="3" fill="none" stroke="rgba(180,140,80,0.25)" stroke-width="0.8"/>
    ${content}
  </svg>`;
}

// ── SIMBOLI BASE ──────────────────────────────────────

function denaro(x, y, r = 9) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.oro}" stroke="${C.oro2}" stroke-width="1"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.6}" fill="${C.rosso}" stroke="${C.oro}" stroke-width="0.5"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.3}" fill="${C.oro2}"/>`;
}

function coppa(x, y, s = 1) {
  const w = 14 * s, h = 16 * s;
  return `<g transform="translate(${x - w/2},${y - h * 0.3})">
    <ellipse cx="${w/2}" cy="0" rx="${w/2}" ry="${h*0.18}" fill="${C.rosso}" stroke="${C.oro}" stroke-width="0.8"/>
    <path d="M${w*0.15},0 Q${w*0.08},${h*0.45} ${w*0.35},${h*0.6} L${w*0.65},${h*0.6} Q${w*0.92},${h*0.45} ${w*0.85},0 Z" fill="${C.rosso}" stroke="${C.oro}" stroke-width="0.8"/>
    <rect x="${w*0.38}" y="${h*0.6}" width="${w*0.24}" height="${h*0.2}" fill="${C.oro}" stroke="${C.oro}" stroke-width="0.5"/>
    <ellipse cx="${w/2}" cy="${h*0.82}" rx="${w*0.32}" ry="${h*0.08}" fill="${C.oro}" stroke="${C.oro2}" stroke-width="0.5"/>
  </g>`;
}

function bastone(x, y, angle = 0, s = 1) {
  const len = 28 * s, w = 5 * s;
  return `<g transform="translate(${x},${y}) rotate(${angle})">
    <rect x="${-w/2}" y="${-len/2}" width="${w}" height="${len}" rx="${w/2}"
      fill="${C.verde}" stroke="#1a4a0a" stroke-width="0.8"/>
    <circle cx="0" cy="${-len/2 + w/2}" r="${w * 0.8}" fill="#3a8a2a" stroke="#1a4a0a" stroke-width="0.6"/>
    <circle cx="0" cy="${len/2 - w/2}"  r="${w * 0.8}" fill="#3a8a2a" stroke="#1a4a0a" stroke-width="0.6"/>
  </g>`;
}

function spada(x, y, angle = 0, s = 1) {
  const len = 28 * s;
  return `<g transform="translate(${x},${y}) rotate(${angle})">
    <polygon points="0,${-len/2} ${2.5*s},${len*0.15} ${-2.5*s},${len*0.15}"
      fill="${C.blu}" stroke="#0a1a5a" stroke-width="0.6"/>
    <rect x="${-1.2*s}" y="${len*0.15}" width="${2.4*s}" height="${len*0.35}" rx="1"
      fill="${C.blu}" stroke="#0a1a5a" stroke-width="0.6"/>
    <rect x="${-6*s}" y="${len*0.12}" width="${12*s}" height="${2.5*s}" rx="1"
      fill="${C.oro}" stroke="${C.oro2}" stroke-width="0.5"/>
    <rect x="${-2*s}" y="${len*0.5}" width="${4*s}" height="${len*0.15}" rx="1"
      fill="${C.oro}" stroke="${C.oro2}" stroke-width="0.5"/>
  </g>`;
}

// ── ANGOLI VALORE ─────────────────────────────────────
function angoli(val, colore = C.nero) {
  return `
    <text x="6" y="14" font-family="Georgia,serif" font-size="10" font-weight="bold"
      fill="${colore}" text-anchor="middle">${val}</text>
    <text x="64" y="95" font-family="Georgia,serif" font-size="10" font-weight="bold"
      fill="${colore}" text-anchor="middle" transform="rotate(180,64,95)">${val}</text>`;
}

// ── FIGURE ────────────────────────────────────────────

function fante(seme) {
  const col1 = seme === 'coppe' || seme === 'denari' ? C.rosso : C.blu;
  const col2 = seme === 'coppe' || seme === 'denari' ? C.blu : C.verde;
  return `
    <!-- corpo -->
    <rect x="22" y="42" width="26" height="36" rx="4" fill="${col1}" stroke="${C.nero}" stroke-width="0.8"/>
    <!-- testa -->
    <circle cx="35" cy="36" r="10" fill="${C.skin}" stroke="${C.nero}" stroke-width="0.8"/>
    <!-- capelli -->
    <path d="M25,32 Q35,22 45,32" fill="${col2}" stroke="${C.nero}" stroke-width="0.6"/>
    <!-- cappello -->
    <rect x="23" y="25" width="24" height="4" rx="2" fill="${col2}" stroke="${C.nero}" stroke-width="0.6"/>
    <!-- occhi -->
    <circle cx="31" cy="35" r="1.5" fill="${C.nero}"/>
    <circle cx="39" cy="35" r="1.5" fill="${C.nero}"/>
    <!-- bocca -->
    <path d="M31,40 Q35,43 39,40" fill="none" stroke="${C.nero}" stroke-width="0.8"/>
    <!-- gambe -->
    <rect x="26" y="76" width="8"  height="16" rx="3" fill="${col2}" stroke="${C.nero}" stroke-width="0.6"/>
    <rect x="36" y="76" width="8"  height="16" rx="3" fill="${col2}" stroke="${C.nero}" stroke-width="0.6"/>
    <!-- braccia -->
    <rect x="10" y="46" width="14" height="6" rx="3" fill="${col1}" stroke="${C.nero}" stroke-width="0.6"/>
    <rect x="46" y="46" width="14" height="6" rx="3" fill="${col1}" stroke="${C.nero}" stroke-width="0.6"/>`;
}

function cavallo(seme) {
  const col1 = seme === 'coppe' || seme === 'denari' ? C.rosso  : C.verde;
  const col2 = seme === 'coppe' || seme === 'denari' ? '#8B0000' : '#1a4a0a';
  return `
    <!-- cavaliere -->
    <circle cx="38" cy="28" r="9" fill="${C.skin}" stroke="${C.nero}" stroke-width="0.8"/>
    <path d="M30,24 Q38,15 46,24" fill="${col1}" stroke="${C.nero}" stroke-width="0.6"/>
    <rect x="28" y="32" width="22" height="18" rx="4" fill="${col1}" stroke="${C.nero}" stroke-width="0.7"/>
    <circle cx="33" cy="27" r="1.5" fill="${C.nero}"/>
    <circle cx="43" cy="27" r="1.5" fill="${C.nero}"/>
    <!-- corpo cavallo -->
    <ellipse cx="33" cy="70" rx="22" ry="14" fill="#8B7355" stroke="${C.nero}" stroke-width="0.8"/>
    <circle  cx="18" cy="62" r="10" fill="#8B7355" stroke="${C.nero}" stroke-width="0.8"/>
    <!-- zampe -->
    <rect x="14" y="79" width="6" height="18" rx="3" fill="#6B5335" stroke="${C.nero}" stroke-width="0.6"/>
    <rect x="24" y="81" width="6" height="16" rx="3" fill="#6B5335" stroke="${C.nero}" stroke-width="0.6"/>
    <rect x="36" y="81" width="6" height="16" rx="3" fill="#6B5335" stroke="${C.nero}" stroke-width="0.6"/>
    <rect x="46" y="79" width="6" height="18" rx="3" fill="#6B5335" stroke="${C.nero}" stroke-width="0.6"/>
    <!-- criniera -->
    <path d="M18,52 Q12,58 14,68" fill="none" stroke="#5a3a1a" stroke-width="3" stroke-linecap="round"/>`;
}

function re(seme) {
  const col1 = seme === 'coppe' || seme === 'denari' ? C.rosso : C.blu;
  const col2 = seme === 'coppe' || seme === 'denari' ? '#8B0000' : '#0a1a5a';
  return `
    <!-- manto -->
    <path d="M15,48 Q35,40 55,48 L58,95 Q35,100 12,95 Z" fill="${col1}" stroke="${C.nero}" stroke-width="0.8"/>
    <!-- corpo -->
    <rect x="22" y="44" width="26" height="30" rx="4" fill="${col2}" stroke="${C.nero}" stroke-width="0.7"/>
    <!-- testa -->
    <circle cx="35" cy="33" r="10" fill="${C.skin}" stroke="${C.nero}" stroke-width="0.8"/>
    <!-- corona -->
    <path d="M24,24 L26,18 L29,23 L32,16 L35,22 L38,16 L41,23 L44,18 L46,24 Z"
      fill="${C.oro}" stroke="${C.oro2}" stroke-width="0.8"/>
    <rect x="24" y="24" width="22" height="5" rx="1" fill="${C.oro}" stroke="${C.oro2}" stroke-width="0.6"/>
    <!-- viso -->
    <circle cx="31" cy="32" r="1.5" fill="${C.nero}"/>
    <circle cx="39" cy="32" r="1.5" fill="${C.nero}"/>
    <path d="M30,37 Q35,40 40,37" fill="none" stroke="${C.nero}" stroke-width="0.8"/>
    <!-- barba -->
    <path d="M28,38 Q35,46 42,38" fill="#8B6914" stroke="#6B4914" stroke-width="1"/>
    <!-- scettro -->
    <rect x="52" y="30" width="4" height="40" rx="2" fill="${C.oro}" stroke="${C.oro2}" stroke-width="0.5"/>
    <circle cx="54" cy="28" r="5" fill="${C.oro2}" stroke="${C.oro}" stroke-width="0.8"/>`;
}

function asso(seme) {
  // Asso: simbolo grande centrale + decorazioni
  let simbolo = '';
  if (seme === 'denari') simbolo = denaro(35, 52, 20);
  if (seme === 'coppe')  simbolo = coppa(35, 52, 1.5);
  if (seme === 'bastoni') simbolo = bastone(35, 52, 0, 1.5);
  if (seme === 'spade')   simbolo = spada(35, 52, 0, 1.4);
  return `
    <!-- decorazione angoli -->
    <circle cx="12" cy="20" r="4" fill="${C.oro}" opacity="0.4"/>
    <circle cx="58" cy="85" r="4" fill="${C.oro}" opacity="0.4"/>
    ${simbolo}`;
}

// ── LAYOUT NUMERICHE ──────────────────────────────────

// Posizioni per ogni numero di simboli
const POS = {
  2: [[35,28],[35,77]],
  3: [[35,22],[35,52],[35,82]],
  4: [[22,28],[48,28],[22,77],[48,77]],
  5: [[22,22],[48,22],[35,52],[22,82],[48,82]],
  6: [[22,22],[48,22],[22,52],[48,52],[22,82],[48,82]],
  7: [[22,20],[48,20],[22,46],[48,46],[35,35],[22,78],[48,78]],
};

function simboliNumerici(seme, n) {
  const positions = POS[n] || POS[2];
  let out = '';
  const s = n >= 6 ? 0.78 : n >= 4 ? 0.88 : 1;
  for (const [x, y] of positions) {
    if (seme === 'denari')  out += denaro(x, y, 9 * s);
    if (seme === 'coppe')   out += coppa(x, y, s * 0.85);
    if (seme === 'bastoni') out += bastone(x, y, 0, s * 0.85);
    if (seme === 'spade')   out += spada(x, y, 0, s * 0.85);
  }
  return out;
}

// ── GENERAZIONE CARTE ─────────────────────────────────

function colSeme(seme) {
  if (seme === 'denari' || seme === 'coppe') return C.rosso;
  if (seme === 'bastoni') return C.verde;
  return C.blu;
}

const VALORI_DISPLAY = { 'A':'A','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','J':'J','Q':'Q','K':'K' };

function generaCarta(seme, valore) {
  const col = colSeme(seme);
  let corpo = '';

  if (valore === 'A') {
    corpo = asso(seme);
  } else if (valore === 'J') {
    corpo = fante(seme);
  } else if (valore === 'Q') {
    corpo = cavallo(seme);
  } else if (valore === 'K') {
    corpo = re(seme);
  } else {
    const n = parseInt(valore);
    corpo = simboliNumerici(seme, n);
  }

  return svg(angoli(VALORI_DISPLAY[valore], col) + corpo);
}

// ── POPOLA TUTTE LE 40 CARTE ──────────────────────────
const SEMI   = ['bastoni','coppe','denari','spade'];
const VALORI = ['A','2','3','4','5','6','7','J','Q','K'];

for (const seme of SEMI) {
  for (const valore of VALORI) {
    CARTE_SVG[`${valore}_${seme}`] = generaCarta(seme, valore);
  }
}

// ── FUNZIONE DI ACCESSO ───────────────────────────────
function getSVGCarta(carta) {
  const key = `${carta.valore}_${carta.seme}`;
  return CARTE_SVG[key] || generaCarta(carta.seme, carta.valore);
}

// SVG retro carta
const SVG_RETRO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 105">
  <rect width="70" height="105" rx="5" fill="#0e2147" stroke="#0a1830" stroke-width="1.5"/>
  <rect x="3" y="3" width="64" height="99" rx="3" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="0.8"/>
  <pattern id="bp" x="0" y="0" width="9" height="9" patternUnits="userSpaceOnUse">
    <rect width="9" height="9" fill="#0e2147"/>
    <rect x="0" y="0" width="4.5" height="4.5" fill="#1a3a6e" opacity="0.8"/>
    <rect x="4.5" y="4.5" width="4.5" height="4.5" fill="#1a3a6e" opacity="0.8"/>
  </pattern>
  <rect x="4" y="4" width="62" height="97" rx="3" fill="url(#bp)"/>
  <rect x="8" y="8" width="54" height="89" rx="3" fill="none" stroke="${C.oro}" stroke-width="1" opacity="0.3"/>
  <text x="35" y="58" font-family="Georgia,serif" font-size="22" font-weight="bold"
    fill="${C.oro}" opacity="0.25" text-anchor="middle">B</text>
</svg>`;
