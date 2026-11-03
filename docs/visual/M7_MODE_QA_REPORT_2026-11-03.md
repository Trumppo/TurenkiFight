# M7 pelimuotojen lopullinen riippumaton QA (2026-11-03)

**Tekijä:** Tester-agentti (riippumaton; ei osallistunut M7-muotojen toteutukseen).
**Tehtävä:** M7-MODE-QA — kolmen pelimuodon lopullinen QA, paikallisesti ja verkossa, yhtenä todisteasiakirjana.
**Testattu commit:** `review/m7-mode-qa` @ `ea04487`. Tämä on main `7ffc110` (PR #135 -merge) **plussa designerin tehtävätilakommit**, joka muuttaa vain `.github/AGENT_TASKS.yaml` (diff 7ffc110..ea04487 = vain tuo tiedosto, +4/−2). Pelikoodi on tavumerkilleen identtinen mainin `7ffc110` kanssa.
**Ympäristö:** Windows (win32), Node v26.5.1, npm 11.16.0, Chromium Playwright 1.56 -asennuksella, 60 Hz deterministinen simulaatio, 640×360 logiikkaesitys.
**Rajoitteet:** Ei muutoksia tuotantokoodiin, testeihin tai `.github/AGENT_TASKS.yaml`. Ei committeja, puskuja, mergeä tai PR:ia.

Merkitseminen: **[mittaus]** = toistettu havainto tässä QA:ssa; **[automaattinen]** = arkiston testi suoritettu vihreänä osana tätä QA:ta; **[arvio]** = katselmoijan päätelmä, ei suora todiste.

## 1. Laajuus, komennot ja tulokset

| Komento (worktree-juuressa ellei muuta mainittu) | Tulos | Alue |
| --- | --- | --- |
| `npm ci` | OK. `npm warn allow-scripts`: esbuild 0.25.12 postinstall (ympäristön allow-scripts-käytäntö, ei testivika). **[mittaus]** | asennus |
| `npx playwright install chromium` | no-op — Chromium jo valmiina. **[mittaus]** | asennus |
| `npm test` (Vitest, koko repo) | 48 testitiedostoa, **363/363 läpi** (~18 s). Mukana `tests/m7-mode-rules.test.ts`, `src/game/simulation/modes.test.ts`, `tests/m7-mode-protocol.test.ts`, `src/game/protocol/stateSnapshot.test.ts`, `tests/m7-match-server.test.ts`, `tests/m2-benchmark-*.test.ts`, `tests/ws-split-roles.test.ts`. **[automaattinen + mittaus]** | simulaatio + protokolla |
| `npm run build` | OK (`tsc --noEmit` + Vite). Vain tunnettu >500 kB -chunk-varoitus. **[mittaus]** | build |
| `$env:PLAYWRIGHT_PORT='47311'; npx playwright test` (koko selainsarja, 1 worker, 2.4 min) | **59 läpi, 31 skip, 0 fail**. Jokainen skip on `VITE_VISUAL_STYLE`-rajattu (vaatii retro-buildin, esim. `meskuArena.spec.ts:14`); skip-ehdot tarkistettiin speceistä. `online-mode.spec` ajoi sisällä (ok 40–43). **[mittaus]** | selain |
| `$env:PLAYWRIGHT_PORT='47321'; npx playwright test online-mode` | **4/4 läpi** (32.8 s) — stabiliteettiajo 2 **[mittaus]** | verkko |
| `$env:PLAYWRIGHT_PORT='47399'; npx playwright test online-mode` | **4/4 läpi** (32.8 s) — stabiliteettiajo 3 **[mittaus]** | verkko |
| heittoskriptit `modeqa-replay.ts`, `modeqa-tiebreak.ts`, `modeqa-scorebrawl.ts` | ks. §4, §5, §6 **[mittaus]** | determinismi |
| `npm run serve:match -- --host=127.0.0.1 --port=0 --players=2 --mode=deathmatch` (taustaprosessi) + kaksi oikeaa selainasiakasta | ks. §3 **[mittaus]** | verkko |
| sama `--mode=last-man-standing` | ks. §3 **[mittaus]** | verkko |
| `npm run serve:match -- --port=0 --mode=coconut` | epäonnistuu selkeästi: `match server: Invalid mode: coconut (expected score-brawl, last-man-standing, deathmatch)` — ei hiljaista palautumista **[mittaus]** (ADR 0002 gate 4) | palvelin |
| paikallismuotojen selainsarja (heitinspec, 4 testiä, portti 47411) | **4/4 läpi** (51.1 s), kuvakaappaukset talteen **[mittaus]** | paikalliset muodot |

Heittoskriptit asuvat arkiston ulkopuolella (`C:\Users\Marko\AppData\Local\Temp\opencode\modeqa-scripts\`). Vite hylkää repo-rootin ulkopuolisen lähdekoodilatauksen, joten suoritusajaksi tehtiin mekaaniset kopiot gitignore-merkittyyn `node_modules/.qa-tmp/` -kansioon ja ne poistettiin lopuksi; alkuperäiset skriptit pysyivät arkiston ulkopuolella. Lopuksi `git status` ja `git diff --check` olivat tyhjiä. **[mittaus]**

Kuvakaappaukset: `artifacts/visual/qa-local-*.png` (7 kpl), `artifacts/visual/qa-online-*.png` (4 kpl) sekä `m7-*.png`-kuvat, jotka `mode-ui.spec.ts` tuotti koko sarjan ajossa. `artifacts/` on gitignore-merkitty; mitään binääriä ei lisätty gittiin.

## 2. Paikalliset muodot

Kaikki ajot kulkivat lobbyvirran kautta: `#game-mode`-valinta, Shift-liity, Enter-starti, oikeat näppäimistöohjaimet (P1: A/D/W/S + kick `g`; P2: nuolet). **[mittaus]**

### Score Brawl (2 pelaajaa)

- Käynnistyy oikeasta lobbyvirrasta. `#player-hud` **ei** saa `mode-specific`-luokkaa; P1-kortti `0` / `H100` (title `HP 100`); ajastin tikittää. Kuvakaappaus `qa-local-score-brawl-fighting.png`. **[mittaus]**
- `tests/browser/harness.spec.ts` vihreänä: neljä virtuaalipelaajaa oikean 120 s Score Brawl -ottelun läpi. **[automaattinen]**

### Last Man Standing (4 pelaajaa)

- Asetelma: P1 näppäimistöhost, P2 näppäimistö, P3/P4 `B`-näppäimellä lisätyt botit (botit pelaavat simulaation omalla `botInput`-logiikalla; ks. §8 vaikutus todistusvoimaan).
- Alku: neljä korttia `S1` / `ALIVE`; `#player-hud.mode-specific` läsnä; kuvakaappaus `qa-local-lms-fighting.png`. **[mittaus]**
- Yksi **oikea** KO näppäimistöpolulla (P1 lähestyy ja potkaisee P2:ta): P2-kortti `S0` / `OUT`, `is-eliminated`-luokka, aria-label `P2, stock 0, eliminated`; kuvakaappaus `qa-local-lms-eliminated.png`. **[mittaus]**
- **Eliminoitua ei voi ohjata:** pidin jokaista P2-näppäintä alhaalla ~2 s, kun live-simulaatio pyöri edelleen; P2:n `x`, `y`, `facing` ja `attackMove` jäivät täsmälleen samoiksi. **[mittaus]**
- **Eliminoitua ei voi osua:** asetin P1:n ruumiin viereen ja potkaisin kolmen sekunnin ajan; `HitLanded`- tai `Knockout`-tapahtumaa, jonka `target === 'P2'`, **ei syntynyt yhtään**; P2 `health`=0 ja `eliminated`=true koko ajan. **[mittaus]**
- Ottelu jatkui botteja pelatessa: lopullinen tila näkyi suoraan `match-status`-elementissä `RESULTS · WINNER: P1 · REASON: elimination · P2 OUT · P3 OUT · P4 OUT` (ensimmäisen ajon havainto). **[mittaus]**

### Last Man Standing (2 pelaajaa)

- Yksi KO päättää ottelun heti: `MatchEnded { reason: 'elimination', winner: 'P1' }`; `#match-status` näyttää `WINNER: P1` ja `REASON: elimination`. Kuvakaappaus `qa-local-lms-results.png`. **[mittaus]**
- `tests/m7-mode-rules.test.ts`: "eliminates on KO instead of respawning", "ignores ghost input and never targets an eliminated fighter" — ajetut vihreänä. **[automaattinen]**

### Deathmatch (2 pelaajaa)

- Alku: `F0` / `D0`, `mode-specific` läsnä; kuvakaappaus `qa-local-deathmatch-fighting.png`. **[mittaus]**
- Yksi todellinen KO näppäimistöpolulla: P1 `F1` / `D0`, P2 `F0` / `D1`; kohteessa P2 `koTimer > 0`. Luvut lasketaan simulaation tuloksesta, eivät esityspuolella. Kuvakaappaus `qa-local-deathmatch-frag.png`. **[mittaus]**
- **20-fragon raja:** asetin P1:n `frags = 19` (keinotekoinen — kts. §8), sitten yksi oikea KO → ottelu loppui `MatchEnded { reason: 'frag-limit', winner: 'P1' }`; tulokset `WINNER: P1` + `REASON: frag-limit`. Kuvakaappaus `qa-local-deathmatch-results.png`. **[mittaus]** Vain rajapäätepiste todistettiin; pacing on omistajan playtest-listassa (§7).
- `tests/m7-mode-rules.test.ts`: frag-attribuutio, simultaanin KO:n suppressio ja ketjuprofiili ajettu vihreänä (mm. "credits no frag for a mutual or multi-fighter simultaneous KO", "credits only the attacker that lands the single knockout on a double-team target"). **[automaattinen]**

## 3. Online-tilat

Kolme toisistaan riippumatonta ketjua:

1. **Sisäistetty spec, kolme ajoa** — `tests/browser/online-mode.spec.ts` käynnistää `startMatchServer`-palvelun prosessin sisällä, antaa kahden Chromium-asiakkaan ottaa molemmat slotit, ajaa yhden oikean KO:n näppäimistöstä ja vertaa DOM:ia asiakkaan itse vastaanottamaan snapshotiin (`window.__turenkiOnline.latestSnapshot()`), ei kovakoodattuihin arvoihin.
   - Ajo 1 (koko sarja, portti 47311): 4/4 läpi (12.9 s, 13.1 s, 2.4 s, 712 ms). **[mittaus]**
   - Ajo 2 (portti 47321): 4/4 läpi. **[mittaus]**
   - Ajo 3 (portti 47399): 4/4 läpi. **[mittaus]**

2. **Tuotantopolku `npm run serve:match`** — erilliset palvelinprosessit (`--port=0 --players=2`, ready-luettelo `{"kind":"match-server-ready", …,"mode":…}`). Kaksi selainasiakasta (P1/P2) ottivat slotit, kuvasin ennen ja jälkeen oikean KO:n:
   - Deathmatch (ws://127.0.0.1:58589): `#match-mode` = `ONLINE MODE · DEATHMATCH`; langalla `mode:"deathmatch"` ja molemmilla taistelijoilla numeeriset `frags`/`deaths` ennen KO:ta; KO:n jälkeen snapshotissa `frags=1`/`deaths=1` ja DOM `FRAGS 1`/`DEATHS 1`/`DEATHS 0`; aria-label `1 frags, 0 deaths`. Kuvat `qa-online-deathmatch-fighting.png` ja `qa-online-deathmatch-frag.png`. **[mittaus]**
   - Last Man Standing (ws://127.0.0.1:58665): `#match-mode` = `ONLINE MODE · LAST MAN STANDING`; elossa olevilla `eliminated` **puuttuu** langasta; KO:n jälkeen `eliminated:true`, `phase:"results"`, kortti `STOCK 0`/`ELIMINATED`, renderöinti pose `ko` alfa 0.72. Kuvat `qa-online-lms-fighting.png` ja `qa-online-lms-eliminated.png`. **[mittaus]**

3. **Puuttuvat mode-tiedot** — paikan päällä syötein asiakkaalle Deathmatch-tila, josta `frags`/`deaths` oli poistettu:
   - näyttö `FRAGS —`, `DEATHS —` ja aria `P1, frags not measured, deaths not measured, health 100` — ei keksittyjä nollia; noll-snapshot palauttaa labelin `ONLINE MODE · SCORE BRAWL (SERVER DEFAULT)`. Kuvakaappaus `qa-online-missing-counter.png`. **[mittaus]** (ajettu kahdesti riippumattomasti.)
   - Tiukka dekooderi estää tämän tilan verkossa: `stateSnapshot.test.ts` hylkäystapaukset (mm. `frags` ilman `mode`, epäparit `frags`/`deaths`, `eliminated` elävällä) ajetut vihreänä. **[automaattinen]**
4. **Tuntematon mode** — `--mode=coconut` tulostaa selkeän virherivin, ei hiljaista palautumista Score Brawl:iin (ks. §1). **[mittaus]**

## 4. Determinismi (riippumattomat uusintajot)

Heittoskripti `modeqa-replay.ts` (arkiston ulkopuolella) rakensi kuvaukset itsenäisesti, ajoi jokaisen kuvauksen **kahdesti** (toinen ajo JSON:lla palautetusta alkutilasta) ja laski omat SHA-256:t:

| Muoto | Final-state SHA-256 | Ordered-events SHA-256 | Ajot täsmäävät |
| --- | --- | --- | --- |
| last-man-standing | `95c0e63b3344635094e3436d060bb393077b79efbc48e7109caa6a77bd9447f1` | `87be89ee9228dfab5463a69f3f014f6dea8048a3367f561a58ef1a89ecf872cd` | true |
| deathmatch | `6e92d22dd779d6a193ffc8d97f8066937a97e643bdedd26257eda20a5b0f03e3` | `eba64c270d28a4ae02d839cb0d45b0fc6c65b878c8fccbc4c39cb614cde164f1` | true |

Molemmat hashit täsmäävät `tests/m7-mode-rules.test.ts` kiinnitettyihin arvoihin, ja LMS sai `MatchEnded { tick:146, reason:'elimination', winner:'P1' }`, deathmatch `MatchEnded { tick:186, reason:'time', winner:'P1' }`. **[mittaus]** — nämä ovat omat uudelleenlasketut arvot, eivät vain kiinnitettyjen testien vahvistuksia. Samaa tukee **[automaattinen]**: `tests/m1-5-robustness.test.ts` (1000 erillistä 7200-tikkistä nelinpelialaa identtisillä tuloksilla) ajettu vihreänä tässä QA:ssa.

## 5. Score Brawl muuttumattomana (tarkat arvot)

Heittoskripti `modeqa-scorebrawl.ts` laski 7200-tikkisen (BASE-4-60-20) Score Brawl -ajon kahdessa erillisessä ajossa, ilman socketteja:

- finalTick 7200, phase `results`, 47 tapahtumaa (molemmat ajot täsmälleen samat).
- koodatun tilan SHA-256: `de544fcd7fae1bd2c25fd8ccf97ed7fb315014adafd692d45577913a01dff150`
- järjestetyt tapahtumat SHA-256: `5bb44bd6fc1173ab0b2a3d45c9662f65ad84b6619acd403a57d269108a11ebd5`

**Nelinpelaaja-fiksuuritavut** — heittoskripti `modeqa-replay.ts` laski:

- fighting-fiksuurin SHA-256 `1d23bad2d6686a6196d3267a608c6b9c12ebd0ec84af2dbc7b5691538fc603f7` = pinned (bytemäärä 1086 = pinned 1086).
- stepped-fiksuurin SHA-256 `15d9df677d8d6de4c5cd3ba9b26ae080c51afe9fbf56ecef92a50a79019f4996` = pinned (bytemäärä 1088 = pinned 1088).
- Samaa tukee `stateSnapshot.test.ts`:n "keeps four-player Score Brawl snapshot bytes identical after the cap change" testi — ajettu vihreänä. **[automaattinen]**

## 6. Tasapelit ja tie-breakit

Heittoskripti `modeqa-tiebreak.ts` rakensi alkutilat (`remainingTicks = 1`) ja luki todellisen tuloksen jokaista reittiä kohti:

| Reitti (LMS: HP → KOs → damage) | Havaittu tapahtuma | Odotus |
| --- | --- | --- |
| LMS time-out, selvä HP-ero (90/80/80) | `{reason:'time', winner:'P1'}` | täsmää | 
| LMS time-out, HP tasan, KOs eri (2/1/2) | `{reason:'time', winner:null}` — P1 ja P3 samat kaikin mittapuin, säännön mukainen tasapeli | täsmää |
| LMS time-out, HP tasan, damage eri (50/40/50) | `{reason:'time', winner:null}` — sama kolmen pelaajan tasatilanne | täsmää |
| LMS time-out, kokonaan sama | `{reason:'time', winner:null}` | täsmää (tasapeli havaittiin) |
| DM time-out, frags eri (3/4/3) | `{reason:'time', winner:'P2'}` | täsmää (enemmän fradia voittaa) |
| DM time-out, frags tasan, vähiten kuolemia voittaa (1/0/1) | `{reason:'time', winner:'P2'}` | täsmää |
| DM time-out, frags+deaths tasattu, damage eri (60/40/40) | `{reason:'time', winner:'P1'}` | täsmää |
| DM time-out, kokonaan sama | `{reason:'time', winner:null}` | täsmää (tasapeli) |
| DM vertailun suunta | `compareTieBreak(vähemmän kuoleminen, enemmän kuoleminen) = 2 > 0` — vähemmän kuoleminen VOITTAA | täsmää |
| Score Brawl time-out | `MatchEnded` ilman `reason`-/`winner`-kenttiä (identtinen vanhaan muotoon) | täsmää |
| DM frag-raja nimenomaan 20 | P1 19→20 fradia: `MatchEnded {reason:'frag-limit', winner:'P1'}`, phase `results` | täsmää |

Havainto [arvio]: `modeWinner` kolmen pelaajan osittaisessa tasatilanteessa palauttaa tasapelin (null), kun kaksi huippupelaajaa ovat keskenaen tasapisteissa (esim. P1=P3 > P2). Spekin sanamuoto "ties ... otherwise the match is a draw" tukee tata tulkintaa. Omistajan kannattaa vahvistaa tulkinnan noudattavan intentiota.

## 7. Omistajan playtest-lista

Tama QA ei arvioi pelituntumaa. Ehdotettava tarkistuslista omistajan pelitestiin. **[arvio]**

1. LMS-eliminaation luettavuus: onko `OUT`-kortti ja himmennetty (alfa 0.72) KO-asento selkea pelin kesken? Riittaako HUD-viesti vai tarvitaanko suurempi ilmoitus?
2. LMS-tunne: onko yksi elama kohtuullinen; onko areena liian tyhja usean poistumisen jalkeen; loppuuko peli tyydyttavasti?
3. Deathmatch frag-tahti: saavutetaanko 20 fragia 120 s aikana normaalipelissa (kytketty 19-frag-injektio ei todista tahtia); onko raja liian nopea tai liian hidas?
4. Deathmatch-tunne: lukeeko `F/D`-lyhenteet nopeasti; onko kuolemat selkeita?
5. Tulosten ruutu: ovatko WINNER/REASON/DRAW-tekstit luettavia kaikissa muodoissa; onko frag-taulukko selkeä?
6. Online-viiveen tunne 20 Hz -snapshot-pohjana oikeassa pelissä (ei mitattu tässä QA:ssa).

## 8. Tunnetut rajat ja testaamattomat olosuhteet

1. Ei verkkosuorituskykymittauksia: loopback ja localhost vain; NAT/TURN, todellinen LAN, TLS ja autentikointi testaamatta. Tama ei ole kuljetusvalintanaytos. **[arvio]**
2. Palvelimen elinkaari: `serve:match` ajaa yhden ottelun per prosessi (koodin oma dokumentaatio). Toisen ottelun pelaaminen vaatii uudelleenkäynnistyksen; saman havaitsin itse QA:n aikana.


3. 19-frag-injektio todisti vain rajatilanteen, ei pacingia.
4. 120 s todellista aika-ajoa ei ajettu selaimessa; tie-breakit todistettiin simulaatiotasolla (§6).
5. Peliohjain (gamepad) ei saatavilla laitteistona; simuloitu-pado-testit ajetut vihreana koko sarjassa (four-player, gamepad-rejoin, p1-gamepad-start).
6. Vain 2 pelaajaa verkossa; 4-8 pelaajan verkkomuotoa ei ajettu (paikallinen 4p ajettu).
7. Matkapuhelin: paikallis-HUD-fontti >= 14 px mobiilivariantissa tarkistettu automaattisesti (mode-ui.spec), online-muodon mobiiliasettelus ei erikseen.

## 9. Yhteenveto

- **Verdict: PASS.** Kolme pelimuotoa toimivat paikallisesti ja verkossa; determinismi- ja Score Brawl -todisteet uusittiin itsenaisesti; puuttuviin mode-tietoihin reagoidaan tuntemattomalla merkilla; tuntematon mode epaonnistuu selkeasti.

### Kolme tärkeinta havaintoa

1. **Ei havaittuja tuotantovirheitä.** Kaikki hyväksymiskriteerit (M7_GAME_MODES.md §5 ja ADR 0002:sen gate 1–4) toteutuivat: eliminaatio immunisoi pelaajan kokonaan (myös live-ottelussa), frag-attribuutio ja 20:n raja toimivat, tie-breakit ja tasapelit ovat specin mukaisia, online-asiakas näyttää luvut vain vastaanotetuista snapshoteista, ja kaikki kiinnitetyt sormenjäljet täsmäävät.
2. **Kolmen pelaajan osittainen tasatila päättyy tasapeliin** (esim. LMS-aikakatkaisu, P1=P3 molemmilla mittapuilla, P2 huonompi): `modeWinner` palauttaa null. Tämä on spec-mukainen tulkinta, mutta kannattaa vahvistaa omistajalle [arvio].
3. **Toinen ottelu vaatii käynnistyksen uudelleen:** `serve:match` ei tarjoa rematchia tai uusliittymistä ottelun päättymisen jälkeen (dokumentoitu raja; havaitsin sen itse QA:n aikana, kun toinen ajoa yritettiin samaan istuntoon). Ei pelivirhe.
