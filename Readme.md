# 🃏 Briscola Multiplayer

Gioco della briscola per 2, 3 o 4 giocatori su dispositivi diversi.
Interamente su **Netlify**: pagina statica + Netlify Functions + Netlify Blobs.

---

## Struttura

```
briscola/
  ├── netlify.toml           ← publish=public, functions=netlify/functions
  ├── netlify/functions/
  │   └── api.mjs            ← backend: logica di gioco + stato su Blobs
  ├── public/
  │   ├── index.html         ← lobby + tavolo + shim di trasporto
  │   ├── style.css
  │   └── carte/             ← immagini delle 40 carte
  └── server.js              ← vecchio backend Socket.io (vedi sotto)
```

---

## Come funziona senza WebSocket

Netlify non esegue processi persistenti, quindi Socket.io non è utilizzabile.
Al suo posto:

- lo **stato di ogni stanza** vive su Netlify Blobs, non in memoria;
- ogni stanza tiene un **log di eventi**; i client leggono da un cursore
  (`POST /api/poll`) ogni 1,2 s in partita e 2,5 s in lobby;
- nel client un piccolo **shim** espone la stessa interfaccia `.on()`/`.emit()`
  di Socket.io, così la logica di gioco è rimasta invariata.

Differenza percepibile: le mosse degli altri compaiono con un ritardo fino a
circa un secondo invece che istantaneamente.

Le mutazioni sono protette da un lock su Blobs **e** riverificate dopo la
scrittura: se una mutazione viene sovrascritta da un'invocazione concorrente,
viene ripetuta sullo stato fresco. Senza quella riverifica, tre giocatori che
entrano nello stesso istante si sovrascrivono a vicenda.

---

## Sviluppo locale

```bash
npm install
npm start          # netlify dev
```

Apri `http://localhost:8888`. Serve `netlify dev` (non `node server.js`):
è lui a esporre `/api/*` e l'emulazione di Blobs.

---

## Deploy su Netlify

1. Collega il repository GitHub su [netlify.com](https://netlify.com)
2. `netlify.toml` è già configurato: publish `public`, functions `netlify/functions`
3. Nessun comando di build, nessuna variabile d'ambiente da impostare

Netlify Blobs si attiva da solo sui siti con Functions.

### Limiti da tenere presenti

- **Invocazioni**: ogni giocatore chiama la function ~1 volta al secondo.
  Una partita da 10 minuti in 3 costa circa 1.800 invocazioni; il piano free
  ne include 125.000 al mese, cioè una settantina di partite.
- Le stanze scadono dopo 6 ore e vengono cancellate alla prima chiamata utile.

---

## Il vecchio `server.js`

Resta nel repo ma non è più usato dal client, che ora parla solo con `/api/*`.
Serve solo se in futuro vorrai tornare a un host con processi persistenti
(Railway, Render, Fly.io): in quel caso si riavvia con `npm run start:socketio`
e il client va riportato a Socket.io.

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