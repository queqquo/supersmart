# Guida al Deploy su Synology DS215+ (ARMv7 • 1 GB RAM • No Docker)

Il modello **Synology DS215+** utilizza una CPU **Annapurna Labs Alpine AL-212 (ARMv7 a 32-bit)** con **1 GB di RAM** e non supporta Docker.

Per evitare di saturare la RAM del NAS con Python (`camel-ai` richiede PyTorch e librerie C++/Rust difficili da compilare su ARMv7) o con `npm install` pesanti:
- Tutta la **Workforce Multi-Agente CAMEL** e il **Motore Combinatorio 2-Opt Kempe** girano in TypeScript/JavaScript puro direttamente nel browser del client (0% carico CPU sul NAS durante i calcoli!).
- Il backend Express (`server.ts`) viene pre-impacchettato sul tuo PC in un **singolo file `server.cjs` autonomo** (zero `node_modules` richiesti sul NAS!) che consuma appena **~25–35 MB di RAM**.

---

## Passo 1: Compila il pacchetto sul tuo PC

Dalla cartella del progetto (`C:\Users\giuse\.gemini\antigravity\scratch\supersmart`), esegui:

```bash
npm install
npm run build:synology
```

Questo comando genera:
1. La cartella **`dist/`** (tutte le pagine web, il motore combinatorio e gli agenti CAMEL).
2. Il file singolo **`server.cjs`** (il server Express già completo di tutte le dipendenze, compatibile con Node.js 16/18/20 di Synology).

---

## Passo 2: Copia i 3 elementi sul Synology DS215+

1. Dal **Centro Pacchetti (Package Center)** del tuo Synology DSM, assicurati che sia installato **Node.js** (v16, v18 o v20).
2. Crea una cartella sul NAS, ad esempio `/volume1/web/supersmart` (tramite File Station).
3. Copia dentro `/volume1/web/supersmart` **solo questi 4 elementi** (non serve copiare `node_modules`!):
   - `dist/`
   - `data/`
   - `server.cjs`
   - `synology-start.sh`

---

## Passo 3: Avvio automatico sul DSM (Utilità di Pianificazione)

1. Apri il **Pannello di controllo** di Synology DSM $\rightarrow$ **Utilità di pianificazione (Task Scheduler)**.
2. Clicca su **Crea** $\rightarrow$ **Attività attivata** $\rightarrow$ **Script definito dall'utente**.
3. Scheda **Generale**:
   - Nome attività: `SuperSmart Multi-Agent Server`
   - Utente: `root` (o il tuo utente amministratore)
   - Evento: **Avvio (Boot-up)**
4. Scheda **Impostazioni attività** $\rightarrow$ nel riquadro *Esegui comando*, incolla:
   ```bash
   sh /volume1/web/supersmart/synology-start.sh
   ```
5. Salva, seleziona l'attività appena creata e clicca su **Esegui** in alto.

Ora puoi aprire da qualsiasi PC, smartphone o tablet nella tua rete locale:
**`http://<IP-DEL-TUO-SYNOLOGY>:3000`**
