# 🃏 Briscola Multiplayer

Gioco della briscola real-time per 2, 3 o 4 giocatori su dispositivi diversi.
Costruito con **Node.js + Socket.io**.

---

## Struttura

```
briscola/
  ├── server.js          ← backend Node.js + Socket.io
  ├── package.json
  └── public/
      ├── index.html     ← lobby (crea/entra stanza)
      ├── game.html      ← tavolo di gioco
      ├── game.js        ← logica client
      └── style.css
```

---

## Sviluppo locale

```bash
cd briscola
npm install
npm start          # oppure: npm run dev  (con nodemon)
```

Apri `http://localhost:3000` nel browser.

---

## Deploy su Railway (gratuito)

1. Vai su [railway.app](https://railway.app) e crea un account gratuito
2. Clicca **New Project → Deploy from GitHub repo**
3. Collega il tuo repository GitHub (carica questa cartella `briscola/`)
4. Railway rileva automaticamente Node.js e avvia `npm start`
5. Vai su **Settings → Networking → Generate Domain** per ottenere il tuo link pubblico

La variabile `PORT` viene impostata automaticamente da Railway.

---

## Come si gioca

1. Un giocatore apre il sito e clicca **Crea partita**, sceglie il numero di giocatori
2. Condivide il **codice stanza** (o il link) con gli altri
3. Gli altri aprono il link e inseriscono il codice
4. La partita parte automaticamente quando la stanza è piena
5. Ogni giocatore gioca sul proprio dispositivo

---

## Regole implementate

- Mazzo da 40 carte (bastoni, coppe, denari, spade)
- Distribuzione 3 carte a testa + carta briscola scoperta
- Ordine di forza: Asso (11pt) > Tre (10pt) > Re (4pt) > Cavallo (3pt) > Fante (2pt) > 7/6/5/4/2 (0pt)
- Chi gioca la briscola più alta vince la mano
- In assenza di briscole vince la carta più alta del seme di partenza
- Pesca automatica dopo ogni mano
- Fine partita quando tutte le carte sono esaurite
- Classifica finale con punteggi