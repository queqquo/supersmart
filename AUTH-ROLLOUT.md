# Rilascio dell'accesso Google verificato

Il frontend usa Firebase Authentication con il provider Google. Firestore decide chi può leggere o scrivere ogni documento. Le scritture di `/api/draws` verificano il Firebase ID token per il progetto atteso con Firebase Admin SDK e richiedono un esito positivo dalla policy Firestore riservata all'Admin. Le richieste anonime non ricevono la lista degli utenti. Nessun segreto nuovo va inserito nel repository o in una variabile `VITE_*`.

## Prima del merge in produzione

1. Nel progetto Firebase indicato in `firebase-applet-config.json`, abilitare **Authentication → Sign-in method → Google**, selezionando un indirizzo di supporto. In **Authentication → Settings → Authorized domains** autorizzare `supersmart-ten.vercel.app` e un dominio di test controllato. Il dominio di una preview generata a caso non è automaticamente autorizzato.
2. In un progetto di test, usare la configurazione Firebase del progetto di test e le stesse regole. Verificare Google, richieste, approvazione, revoca, logout, salvataggio e cancellazione di una schedina sintetica e accesso all'archivio. Non usare un progetto di produzione in un ambiente locale non fidato.
3. Pianificare il passaggio: applicare `firestore.rules` al **database nominato** configurato in `firebase.json`, non al database `(default)`. Dalla root, con Firebase CLI autenticata come operatore autorizzato, usare `firebase deploy --only firestore:rules --project <ID_PROGETTO_FIREBASE>`. Questo repository dichiara un solo database. Il push a GitHub non distribuisce queste regole. Durante il passaggio il vecchio frontend non potrà più usare le collezioni ora protette.
4. Unire a `main` solo quando Google e regole sono pronti. Verificare su Vercel il commit effettivamente servito. Verificare con l'account Admin approvato e un secondo account Gmail dedicato ai test. La vecchia lista degli accessi non viene importata, perché era scrivibile dal client: ogni utente effettua un vero accesso e viene approvato nuovamente.
5. Verificare i log, revocare eventuali inviti non riconosciuti e rimuovere le vecchie anteprime non necessarie. Non ripristinare le regole permissive per aggirare un problema di configurazione.

## Regressioni essenziali

- Anonimo: vede il solo invito all'accesso; nessun dato privato o lista account.
- Google annullato o non configurato: resta fuori; nessuna sessione basata su input manuale.
- Gmail verificato, mai approvato: può vedere lo stato della propria richiesta, non accedere al motore o ai dati riservati.
- Gmail approvato: può lavorare con le proprie schedine, simulazioni e sistemi, non amministrare accessi o scrivere nell'archivio condiviso.
- Revoca: Firestore blocca nuove operazioni protette anche con il token ancora valido; il frontend connesso torna alla schermata d'accesso. Disconnettersi non cancella le cache locali già salvate sul dispositivo dalle versioni precedenti: usare profili browser separati su dispositivi condivisi.
- Admin: può approvare o revocare e aggiornare l'archivio. Non vengono copiati permessi legacy, ma le collezioni dei dati restano al loro posto. Le vecchie schedine senza proprietario sono accessibili solo all'Admin. Le vecchie API locali per dati e ruoli non vengono riattivate.

Test locali: `npm run lint`, `npm run build`, `npm run test:auth` e, con Java ed emulatori Firebase disponibili, `npx firebase-tools emulators:exec --project demo-supersmart --only firestore 'npm run test:rules'`.
