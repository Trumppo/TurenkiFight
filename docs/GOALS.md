# Pitkän matkan tavoitteet

Tämä on projektin päivitettävä tavoitedokumentti harness- ja agenttityölle. Aktiivinen tavoite on rajattu itsenäiseksi kokonaisuudeksi, jolla on todennettavat hyväksymisehdot. Päivitä tavoite omistajan päätöksen ja uuden näytön perusteella; älä merkitse suunnitelmaa toteutetuksi, hyväksytyksi tai yhdistetyksi ilman näyttöä ja omistajan lupaa.

## Tila 2026-11-03

Ei avointa agenttityötä. Kaikki dokumentoidut tavoitteet on viety loppuun tai ne odottavat omistajan päätöstä:

| Alue | Tila |
| --- | --- |
| M1 ja M1.5 | hyväksytty rajoituksin (2026-10-30 / 2026-11-01) |
| M2 kuljetuspäätös | päätetty: keskitetty WebSocket-auktoriteetti ([ADR 0001](adr/0001-network-topology.md)); verkkoa ei mitattu |
| Pelimuodot | Score Brawl, Last Man Standing, Deathmatch — säännöt, UI, online-kentät ja QA valmiit; tasapeli vahvistettu |
| Botit ja kahdeksan pelaajaa | toteutettu ja QA:ttu; kahdeksan ei ole luettavasti erotettavissa taistelussa |
| Areena ja visuaalit | Mesku hyväksytty, VIS05-02/03 hyväksytty, 2×-tila ja ulkoinen HUD |
| Ääni | placeholder-moottori ja 11 cue'ta; oikeat samplet deferoitu |
| Verkkopeli | serveri, botit ja selainclient toimivat LAN/VPN-prototypyppinä; ei TLS/auth/rate limitiä |

**Avoimet omistajapäätökset:** (1) kolmen muodon playtest-tuomio, (2) kahdeksan pelaajan playtest ja
käytännön maksimi, (3) viedäänkö kahdeksan verkkoon (vaatii kaksikoneisen mittauksen), (4) äänen
samplet/miksaus, (5) lisenssit (M0).

## Arkisto: suljetut tavoitteet

### 2026-10-31 — PR:t #21, #25 ja #28

Suljettu 2026-11-01. Tulokset:

| PR | Lopputulos | Näyttö |
| --- | --- | --- |
| #21 M1.5-VIS-01 | Yhdistetty | merge `c0ae871`; headin `93603c0` pakolliset CI-tarkistukset vihreät; omistaja hyväksyi VIS-01-tyylisuunnan ja mergen 2026-10-31 |
| #28 OpenCode-työnkulku | Yhdistetty | merge `b78ad75`; check-task, quality, game-harness ja browser-smoke vihreät |
| #25 M2-protokolla | **Suljettu yhdistämättä** | sisältö integroitiin PR:issä #41 (`9486947`) ja #43 (`bb6058a`) |

Opetus: tarkista remote-PR:n todellinen tila ennen kuin jatkat paikallisesta haarasta.

### 2026-11-01 — M1.5 suljetaan ja M2 valmistellaan kuljetusporttia varten

Suljettu 2026-11-02, kun kaikki vaiheet olivat valmiit tai siirtyivät seuraavaan tavoitteeseen.

| Vaihe | Lopputulos |
| --- | --- |
| Dokumentaation reconciliation + M1.5-hyväksyntä | PR #87 (merge `ed623d7`); `docs/M1_5_ACCEPTANCE_REPORT.md` |
| M1.5-julkaisun varmistus | Tuotanto-Pages hakee `turenki-station-retro.svg` ilman konsolivirheitä; retro-build `deploy.yml`:ssä (#85) |
| Benchmark harness -gate | PR #79 (`b3b0166`) + itsenäinen QA PR #93 (`64e5747`), verdict PASS, korrektiusrajaus |
| Session envelope -päätös | PR #92 (`b4fa0a0`); omistaja hyväksyi omistajuuden, duplikaatit, myöhäiset inputit, reconnectin ja tikkiluennan |
| Oheistyöt | #88 lukitustiedosto + `npm ci`; #89 agenttipermissions; #77/#80/#81/#82/#90/#91 dokumentit ja tehtäväjono |
| Avoimeksi jäänyt | Kuljetusbenchmarkit (WebSocket vs WebRTC) siirtyivät uuteen tavoitteeseen |

Omistajan päätökset 2026-11-01: **areenatyö lykätty** myöhemmäksi, **VIS05-02/VIS05-03 siirretty M7-polishiin**, M1.5 hyväksytty rajoituksin, envelope-sopimus hyväksytty.

### 2026-11-02 — M2-kuljetuspäätös lähdekatsauksella ja yhden koneen mittauksilla (suljettu)

**Lopputulos (suljettu 2026-11-02):** Omistaja hyväksyi ADR 0001:n: **arkkitehtuuri A, keskitetty WebSocket-auktoriteetti**. Vaiheet 1–5 valmiit. Tila päivitetty `main` `09834c7` -pohjalta: Vaiheet 1–4 ovat valmiit ja yhdistetty: envelope (PR #94), skenaariot (PR #97), WS-arkkitehtuuri A (PR #98), WebRTC-arkkitehtuuri B (PR #100), täysimittainen 7200 tickin ajo (PR #102), WS-benchmarkin roolijako (PR #104), lähdekatsaus (PR #106) ja yhden koneen mittaukset (PR #107). Kaikki kahdeksan ovat läpäisseet itsenäisen Tester-gaten. Vaihe 5 päätettiin: ADR 0001 hyväksyttiin 2026-11-02. Verkkopeliä ei ole toteutettu; verkkokentät ovat edelleen `NOT_MEASURED` eikä verkkoa mitattu.

Täysimittainen korrektiusnäyttö on nyt olemassa: sekä WS että WebRTC ajavat 7200 tickiä samalla fixtuurilla `7fddf007…` ja seedillä `12345` ja tuottavat identtiset sormenjäljet — lopputila `de544fcd7fae…` ja 47 tapahtuman järjestys `5bb44bd6fc11…` (ei `sha256("[]")`). Toistettavuus varmistettu kahdella ajolla per arkkitehtuuri. Tämä on korrektiusnäyttö, ei suorituskykymittaus.

**Paikallismittaukset (PR #107, Tester PASS WITH LIMITATIONS):** yhdellä koneella, ei verkkopolkua. Input 202,0 B/tick asiakasta kohden (12 122 B/s), 4 asiakasta yhteensä 48 489 B/s. Snapshot 20 Hz:llä 1 264,7 B server-viestinä, 24 434 B/s asiakasta kohden ja 97 735 B/s serveriltä. Simulaatiotick p50 1,7–1,9 µs, p95 4,4–4,5 µs, p99 6,8–8,4 µs kahdessa ajossa; snapshotin enkoodaus p50 17,7 µs. 7200 tickiä 29,6–32,0 ms seinäkelloa, peak RSS 118,2–118,8 MiB. Nämä eivät ole verkkolatenssia eivätkä valitse kuljetusta.

**Omistajan päätös 2026-11-02 (muuttaa milestone 5 -porttia):** verkkotestejä (LAN, internet, TURN) **ei** vaadita. Kuljetusvalinta tehdään (1) huolellisella lähdekatsauksella ja (2) yhden koneen deterministisillä mittauksilla (tavut/s, snapshot-koot, tick-duration, CPU). Painotettu kriteeri on **alhainen latenssi ja sujuva liike**. ADR:n on sanottava suoraan, että päätös ei perustu verkkoympäristön mittauksiin, ja määritettävä ehdot, joilla päätös avataan uudelleen. Verkkotuloksia ei saa keksiä eikä esittää mitattuina.

### Tavoite

Tuota lähdekatsaukseen ja yhden koneen mittauksiin perustuva, jäljitettävä päätös WebSocket-palvelimen ja WebRTC-selainhostin välillä ja kirjaa se ADR:ään. Tavoite ei ennalta valitse voittajaa eikä lupaa verkkopeliä tuotantoon.

### Peruste ja riippuvuudet

- M1 hyväksytty rajoituksin 2026-10-30; M1.5 hyväksytty rajoituksin 2026-11-01.
- M2 v1 -kodeekit, authorized ingress ja hardening ovat `main`issa (#41, #43) ja itsenäisesti arvioitu (PASS WITH LIMITATIONS).
- Session envelope -sopimus on hyväksytty ([M2_SESSION_ENVELOPE_V1.md](M2_SESSION_ENVELOPE_V1.md)) ja toteutettu (`src/game/session/`, PR #94).
- Benchmark harness ja sen itsenäinen korrektius-QA ovat valmiit (PR #79, #93); manifesti ja fixtuurit ovat toistettavia.
- Skenaariogate on dokumentoitu ([M2_BENCHMARK_SCENARIO_GATES.md](M2_BENCHMARK_SCENARIO_GATES.md)) ja skenaariot ovat ajettavissa (PR #97); mittaussuunnitelma on [NETWORK_BENCHMARK_PLAN.md](NETWORK_BENCHMARK_PLAN.md).
- Molemmat arkkitehtuuriprototyypit ovat `main`issa ja itsenäisesti testattuja: WS `server/ws/**` (PR #98), WebRTC `server/signaling/**` + `src/game/networking/**` (PR #100).
- WS/WebRTC-valinta on **avoin** eikä sitä saa päätellä yhdestä mittarista.
- Lähdeosa on valmisteltu: [M2_TRANSPORT_EVIDENCE_REVIEW.md](M2_TRANSPORT_EVIDENCE_REVIEW.md) listaa seitsemän primäärilähdettä, mitä ne osoittavat kummastakin arkkitehtuurista ja mitä ADR ei saa väittää.

### Työvaiheet

1. **Envelope toteutus maaliin.** ✅ Tehty: PR #94 (`ce8c5a1`). Tester antoi PASS WITH LIMITATIONS: 46/46 itsenäistä hyökkäystä ja 48 000 kutsun deterministinen fuzz, ei toteutusvirheitä, ei tilan mutaatiota hylkäyksissä. Testerin jatkohuomiot kirjattu (encode-puolen kokoraja korjattiin PR:ssä #97; merkkijonopohjainen virheluokittelu on yhä avoin).
2. **Skenaariot toteutuskelpoisiksi.** ✅ Tehty: PR #97 (`dcf7f8d`). Kahdeksan skenaario-ID:tä, 4/8 pelaajan rosterit, impairment vain konfiguraationa, `FAIL-4-HOST-EXIT` ja `FAIL-4-RECONNECT` session-gaten kautta, baseline-sormenjäljet pinnattu.
3. **Sama työkuorma molemmille arkkitehtuureille.** ✅ Tehty: WS PR #98 (`db3112b`), WebRTC PR #100 (`ac19645`), täysimittainen ajo PR #102 (`56fa1ab`). Molemmat arkkitehtuurit tuottavat 7200 tickillä identtiset sormenjäljet samasta seedistä ja fixtuurista; Tester toisti ajon kahdesti kummallakin.
4. **Mittaa yhdellä koneella.** ✅ Tehty: PR #107 (`09834c7`). Tavut, tick-duration, snapshot-koodekkien kestot, CPU ja muisti mitattu ja committoitu `benchmarks/results/`-hakemistoon provenienssin kanssa. Tester vahvisti toistettavuuden ja sen, ettei manifesti voi väittää verkkotulosta; validaattoria kiristettiin (TESTER-107a).
5. **Päätä lähdekatsauksella ja paikallismittauksilla.** ✅ Päätetty 2026-11-02: omistaja hyväksyi ADR 0001:n sellaisenaan. Ehdotus oli: [`docs/adr/0001-network-topology.md`](adr/0001-network-topology.md) suosittaa **arkkitehtuuria A** (keskitetty WebSocket-auktoriteetti) ensimmäiselle verkkopelimilestoneille ja jättää B:n arvioiduksi vaihtoehdoksi. Perustelu: B:n auktoriteettiriskit (hostin jäädytys/lähtö, huijattavuus) tuottavat kovempia katkoksia kuin TCP:n head-of-line-esto tällä kuormalla, ja B:n latenssietu vaatisi vielä toteuttamattoman epäluotettavan kanavan ja redundantin inputin. **Valinta odottaa omistajan hyväksyntää.**
6. **Siivoa.** ⏳ Vanhentuneet paikalliset työpuut poistetaan, kun niiden sisältö on todistetusti `main`issa.

### Lisäys 2026-11-02: verkkotestauksen harness (omistajan pyyntö)

Omistaja pyysi, että verkkotestausta voidaan tehdä niin, että agentti (esim. Codex) pelaa headless-ympäristössä virtuaalikoneessa toisaalla ja omistaja pelaa selaimella tällä koneella — ja että samaa mekanismia käytetään moninpelitestaukseen usealla pelaajalla. Suunnitelma: [M7_ONLINE_TEST_HARNESS.md](M7_ONLINE_TEST_HARNESS.md).

Mitä tarvitaan (ei ole vielä olemassa): (1) oikean matsin serveritila fixture-ajurin sijaan, (2) headless bot-client, joka täyttää slotteja verkon yli ja kerää metriikat, (3) selattava online-sisäänkäynti, joka renderöi snapshotit interpoloimalla ja näyttää RTT:n, (4) verkkomittarien manifesti ja (5) omistajan runbook. Suositeltu järjestys: serveritila → bot → selainclient → mittaukset → runbook.

Tämä muuttaa ADR 0001:n riskin mitattavaksi: jos snapshot-välit ja RTT pysyvät pieninä oikealla yhteydellä, päätös vahvistuu; jos katkokset korreloivat häviön kanssa, ADR:n uudelleenarviointiehto laukeaa. Suojaukset säilyvät ennallaan: `ws://` ilman TLS:ää vain LANissa tai VPN:ssä, ei julkiseen internetiin.

### Lisäys 2026-11-02: botit ja kahdeksan pelaajan matsit (omistajan pyyntö)

Omistaja pyysi, että matsin alussa ja pelaajien liittyessä voisi valita taistelun yhtä tai useampaa bottia vastaan, jotta koko kahdeksan pelaajan erän voisi testata yksin tietokonetta vastaan. Suunnitelma: [M8_BOTS_AND_EIGHT_PLAYERS.md](M8_BOTS_AND_EIGHT_PLAYERS.md).

Nykytila: simulaatio hyväksyy mielivaltaisen rosterin, mutta **neljän pelaajan katto on tarkoituksellinen** ja toteutettu useassa kerroksessa (input-koodekki, snapshot- ja event-koodekit, sessio, match-server, HUD). Siksi työ jaetaan kahtia: ensin botit nykyiseen neljän pelaajan peliin, sitten katon nosto kahdeksaan yhdessä reviewoidussa muutoksessa, jonka regressioportti on **neljän pelaajan tavuidenttisyys**.

**Omistajan päätös 2026-11-02: tuettu enimmäispelaajamäärä on 8.** Neljä ei ollut koskaan tuotepäätös — design-dokumentti vaati konfiguroitavaa pelaajamäärää ilman pysyvää kovakoodattua kattoa, ja neljä oli M1-milestonin laajuus. Kahdeksan toteutetaan yhtenä vakiona, josta kaikki kerrokset johtavat; 9+ hylätään selkeästi. Slotit 1–4 säilyttävät näppäimistöasettelut, slotit 5–8 ovat gamepad- tai bottipaikkoja ja UI sanoo sen. Neljän pelaajan tavut ja sormenjäljet pysyvät identtisinä. Yli kahdeksan on myöhemmin uusi päätös + mittaus.

Tehtävät: `M8-BOT-OPPONENT` (tehty), `M8-EIGHT-PLAYER-CAP` (toteutettu, katselmoitavana), `M8-EIGHT-PLAYER-UI`, `M8-BOT-QA`.

Katon nosto toteutettiin yhtenä vakiona: kahdeksan pelaajan snapshot on mitattu (2,083 B tick 3:ssa, 2,333 B keskimäärin 7200 tickin ajalta) ja neljän pelaajan tavut pysyivät identtisinä. Schema-maksimi pakotti nostamaan snapshotin tavurajan 131 072:een, koska snapshot voi kantaa täyden tapahtumabatchin. BASE-8-benchmark muuttui deterministisesti (yksi frame per tick kahden sijaan) ja se raportoitiin, ei piilotettu. Rehellinen riski kirjattu: kahdeksan hahmoa 640×360-areenalla voi olla lukukelvoton — se on löydös, ei virhe, joka pitää piilottaa.

### Tila 2026-11-02: M8-tavoite valmis agentin osalta

Kahdeksan pelaajan katto, paikalliset botit ja kahdeksan slotin UI on yhdistetty ja QA tehty:

- `M8-BOT-OPPONENT` (PR #127), `M8-EIGHT-PLAYER-CAP` (PR #128), `M8-EIGHT-PLAYER-UI` (PR #129), `M8-BOT-QA` (PR #130).
- 12 (muoto × trace × seed) -yhdistelmää toistettiin identtisillä hasheilla; jokainen muoto päättyi omaan ehtoonsa ilman deadlockia. Neljän pelaajan tavut pysyivät identtisinä.
- QA vahvisti luettavuusongelman: KO-hahmo on litteä blob ilman tunnistetta, ja kahdeksan hahmon ruuhkassa areena ei kerro kuka on kuollut ilman HUD:ia.

**QA:n matalan prioriteetin korjaukset tehty 2026-11-03:** `M8-RESULTS-TICK` (PR #133) — simulaatio ei enää steppaa tulosten alettua, joten `MatchEnded` säilyy ja tick pysähtyy matsin loppuarvoon (ennen 7 382 → 7 472 kuudessa ruudussa, nyt 7 380 × 6). `M8-HUD-EDGE-CASES` (PR #132) — statusriville oma rivi ≥1024 px näytöillä, ei ellipsiä 1920×1080:llä. Negatiivinen pistemäärä todettiin säännöksi (+500 KO:sta, −200 KO:n kokeneelle) ja dokumentoitiin, ei koodattu piiloon.

**Jäljellä vain omistajan päätökset:** (1) pelaa kahdeksan pelaajan erä botteja vastaan ja päätä, onko se luettavissa ja hauskaa vai pitäisikö käytännön maksimin jäädä pienemmäksi; (2) päätä, viedäänkö kahdeksan myös verkkopeliin (mittaamatta). QA:n matalan prioriteetin löydökset on kirjattu tehtäviksi `M8-RESULTS-TICK` ja `M8-HUD-EDGE-CASES`.

### Tila 2026-11-03: pelimuototavoite valmis agentin osalta

- `M7-MODE-RULES` (#121), `M7-MODE-UI` (#122), `M7-MODE-ONLINE` (#124 + #135) ja `M7-MODE-QA` (#136) ovat yhdistetty.
- Online-client näyttää muodon ja sen laskurit **snapshotista**; puuttuva kenttä näytetään muodossa `—`, ei nollana (PR #135).
- Riippumaton QA vahvisti: eliminoitu hahmo ei liiku eikä ota osumia live-ottelussa, frag-attribuutio ja 20 fragin raja toimivat, deterministiset hashit täsmäävät, Score Brawl on tavuidenttinen.
- QA nosti esiin kaksi tulkintakysymystä: kolmen pelaajan osittainen tasatila päätyy **tasapeliin** (specin "ties … otherwise draw" mukaisesti) ja `serve:match` on yhden ottelun istunto ilman rematchia.

**Omistajan päätös 2026-11-03: tasapeli on oikea tulos.** Jos HP, KO:t ja damage ovat tasan, matsi jää ratkaisemattomaksi; sääntöä ei muuteta.

**Jäljellä vain omistajan päätökset:** (1) kahdeksan pelaajan playtest; (2) viedäänkö kahdeksan verkkoon.

### Lisäys 2026-11-03: voitonjuhla tulossivulle (omistajan pyyntö)

Omistaja pyysi, että matsin lopussa olisi animaatio voiton kunniaksi: voittajan nimi isolla ja sen jälkeen kaksi seuraavaa sijaa, kun pelaajia oli enemmän kuin kolme. Suunnitelma: [M9_RESULTS_CELEBRATION.md](M9_RESULTS_CELEBRATION.md).

Työ jaetaan kahtia: `M9-RESULT-RANKING` (gameplay) tuottaa puhtaan sijoitusjärjestyksen joka muodolle — Score Brawl pisteet, Deathmatch fragit/kuolemat, Last Man Standing pudotusjärjestys Knockout-tapahtumista ilman simulaatiomuutosta — ja `M9-RESULT-CELEBRATION` (graphics) renderöi ison voittajanimen, pronssikolmikon, 4.–8. sijan tiiviinä listana, ohitettavan animaation ja reduced-motion-tuen. Tasapeli näytetään tasapelinä, ei keksittynä voittajana.

### Tila 2026-11-03: voitonjuhla ja hahmot valmiit agentin osalta

- `M9-RESULT-RANKING` (#140, `72f3214`), `M9-CHARACTERS` (#141, `5836bc5`), `M9-RESET-CONTROL` (#142, `b743392`) ja `M9-RESULT-CELEBRATION` (#143, `c359e82`) ovat yhdistetty. Omistaja hyväksyi #143:n yhdistämisen 2026-11-03.
- Voitonjuhla näyttää voittajan nimen isolla pelaajan värillä, 2. ja 3. sijan mittareineen sekä 4.–8. sijan tiiviinä rivinä. Tasapeli näytetään `DRAW`-tekstinä sidottujen pelaajien kanssa. Paljastus on ohitettavissa ja kunnioittaa `prefers-reduced-motion`-asetusta; RESET ja Esc toimivat myös paljastuksen aikana.
- Järjestys tulee simulaatiosta (`rankMatch`), ja Last Man Standing käyttää koko ottelun Knockout-virtaa. Simulaatioon, protokollaan, palvelimeen tai botteihin ei koskettu; kiinnitetyt sormenjäljet pysyivät ennallaan.
- Riippumaton Tester antoi PASS WITH LIMITATIONS: täysi selainsarja 100/100, kohdetestit 11/11, ja mutaatiotesti osoitti LMS-kannan olevan ei-tyhjä. Avoin kosmeettinen löydös: kiinteä `PLACES 4–8` -otsikko, kirjattu tehtäväksi `M9-RESULT-LABEL`.
- Omistaja pyysi 2026-11-03 pientä polishia. Työpaketti: `M9-KO-READABILITY` (KO-hahmo ei enää litisty väritäytöksi, osumavälähdys säilyttää siluetin) ja `M9-RESULT-LABEL`. Spec: [M9_READABILITY_POLISH.md](M9_READABILITY_POLISH.md).

**Jäljellä vain omistajan päätökset:** (1) kolmen muodon playtest; (2) kahdeksan pelaajan playtest botteja vastaan; (3) viedäänkö kahdeksan pelaajaa verkkopeliin (vaatii kahden koneen mittauksen); (4) milestone-hyväksynnät.

### Tiedostorajaus ja omistus

- Designer: `docs/GOALS.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/M2_*.md`, `docs/adr/**`, `.github/AGENT_TASKS.yaml`, `.opencode/agents/**`, `opencode.json`, `AGENTS.md`.
- Gameplay: `src/game/simulation/**`, `src/game/modes/**`, `src/game/input/**`, `src/game/protocol/**`, `src/game/session/**`, `benchmarks/**`, `server/**` (vasta kun siivu on hyväksytty), relevant tests.
- Graphics: `public/assets/**`, `src/game/presentation/**`, `src/style.css`, visual tests. Ei protokolla- tai benchmark-tiedostoja.
- Tester: itsenäinen todentaminen; ei omista tuotantokoodia eikä hyväksy omia muutoksiaan.

### Hyväksyntätestit

- `python scripts/validate_agent_tasks.py` → PASS.
- `npm test`, `npm run build`, `npm run test:browser` vihreät jokaisella PR-headilla; kirjaa mitä itse ajoit.
- `git diff --check` puhdas.
- Envelope: negatiiviset testit hylkäävät spoofatun pelaajan, cross-room-viestin, replayed sequencen, myöhäisen ja liian aikaisen tickin, ylisuuren payloadin sekä reconnectin ilman uutta joinia.
- Benchmarkit: sama seed ja fixtuuri tuottavat identtiset loppu- ja tapahtumasormenjäljet molemmilla arkkitehtuureilla ennen kuin yhtään suorituskykylukua raportoidaan. (300 tickin ajo tuottaa tyhjän tapahtumalistan; ei-tyhjä tapahtumaketju vaatii 7200 tickiä.)
- ADR:ään ei merkitä valintaa ilman (a) lähdeluetteloa, jossa jokaisella väitteellä on lähde ja päiväys, (b) `M2-SINGLE-MACHINE-MEASUREMENTS`-tehtävän ajettuja lukuja, (c) eksplisiittistä mainintaa siitä, ettei verkkoympäristöä mitattu, ja (d) uudelleenarviointiehtoja.

### Riskit ja rajat

- Session envelope suojaa vain muodon ja omistajuuden; se ei ole autentikointi, salaus eikä DoS-suoja. Transport adapterin on todennettava connection ID.
- Fyysistä gamepad-laitteistoa ei ole varmennettu; testit käyttävät simuloituja ohjaimia.
- Playwright-sarja on kuormaherkkä (120 s harness aikakatkaisi kerran rinnakkaisajossa); flakeä seurataan.
- WS-manifestin validaattori tarkistaa muodon ja `tickMode`/`pacing`-parin, ei provenanssia: käsin muokattu manifesti voisi väittää reaaliaikapacingia. Estävä kerros on regressiotesti, joka ajaa prosessin itse (Tester, PR #102).
- Selaintuki WebRTC:lle, TURN-kustannukset ja CGNAT käyttäytyminen ovat avoimia: päätös ei mittaa niitä, joten ne on kirjattava riskeinä ja uudelleenarviointiehtoina.
- Verkkolatenssia, jitteriä, häviötä eikä join-onnistumista verkossa ei mitata tässä tavoitteessa. Latenssipainotus perustuu siirtokerroksen tunnettuun käyttäytymiseen (TCP vs. SCTP/UDP), ei meidän verkkomittauksiimme.
- Jos ADR 0001 hyväksytään, TCP:n head-of-line-esto on **tietoisesti hyväksytty rajoite** eikä mittaustulos. Se on kirjattava uudelleenarviointiehtoihin, ja asiakaspuolen interpolointi on seuraava keino pehmentää sitä.
- WS-manifestin `topology: network` tarkoittaa eri prosesseja socketin yli, ei LAN- tai internet-näyttöä. Sitä ei saa siteerata verkkotuloksena.
- VIS05-02/VIS05-03 ja areenatyö on tarkoituksella siirretty myöhemmäksi; älä avaa niitä ilman omistajan päätöstä.

### Haara-, PR- ja päätösportit

Työ tehdään omassa haarassa, yksi PR per yhtenäinen työpaketti (`DESIGNER:`/`LOGIC:`/`GRAPHICS:`/`TESTER:`-etuliite, `Task: <id>` kuvauksessa). Aja CI ja korjaa havainnot samassa PR:ssä. Älä yhdistä ilman omistajan lupaa. Jokainen milestone-hyväksyntä ja kuljetusvalinta on erillinen omistajapäätös.

**Omistajan päätökset, jotka ovat vielä auki:** (1) milestone 5:n hyväksyntä kokonaisuutena, (2) seuraava pitkän aikavälin tavoite (ks. alla), (3) lisenssit (M0).

**Päätetty 2026-11-02:** kuljetusvalinta — arkkitehtuuri A, keskitetty WebSocket-auktoriteetti ([ADR 0001](adr/0001-network-topology.md)). B jää vaihtoehdoksi; WebTransport on kirjattu seuraavaksi uudelleenarviointikandidaatiksi.

**Omistajan päätökset 2026-11-02 (M7):** VIS05-02/VIS05-03 hyväksytty sellaisenaan; areenaksi valittu **Ravintola Mesku**; ääni (taustamusiikki + efektit) otettu tavoitteen piiriin.

**Omistajan jo tekemät päätökset tässä tavoitteessa:** envelope-sopimus 2026-11-01; PR:ien #94–#107 merget on hyväksytty ja yhdistetty; 2026-11-02 milestone 5 -portti muutettu lähdekatsaukseksi ja yhden koneen mittauksiksi, painotuksena latenssi ja liikkeen sujuvuus.

### 2026-11-02 — M7 paikallisen pelin polish (suljettu)

**Lopputulos:** Tavoite suljettu 2026-11-02; omistaja valitsi seuraavaksi tavoitteeksi pelimuodot. Vaiheet 1–4 on tehty ja omistaja on hyväksynyt ne. Vaihe 5 (ääni) toteutettiin placeholder-tasolla omistajan tarkennuksen mukaan. Jäljellä on vain asioita, jotka vaativat omistajaa: verkkotestaus kahdella koneella (`M7-NETWORK-MEASUREMENTS`) ja äänen lopullinen kuuntelu/miksaus (`M7-AUDIO-MIX`, deferoitu). Roadmapin erilliset pelimuodot (Last Man Standing, Deathmatch) eivät kuulu tähän tavoitteeseen.

**Valittu omistajan päätöksellä 2026-11-02.** M2-kuljetuspäätös on suljettu (arkkitehtuuri A). Tämä tavoite keskittyy paikallisen pelin laatuun; verkkoon ei kosketa.

### Tavoite

Saata paikallinen neljän pelaajan peli visuaalisesti ja luettavuudeltaan hyväksyttävään kuntoon kaikilla tuetuilla näyttöko'oilla, ja avaa areenatyö omistajan valitsemalla konseptilla. Tavoite ei muuta simulaatiota, determinismiä eikä pelisääntöjä.

### Rajaus ja vaiheet

1. **Responsiivisuuden todentaminen (Tester).** Tehtävä `M1-5-RESPONSIVE-VISUAL-REVIEW`. Tuota tuore näyttö nykyisestä `main`-buildista 1920×1080- ja 390×844-viewporteilla: mittaa käyttämätön pinta-ala, HUD-tekstin todellinen pikselikoko, canvasin sijoittuminen ja skaalauskerroin. Tuloksena yksilöidyt, toistettavat löydökset (VIS05-02, VIS05-03) ja konkreettiset korjausvaihtoehdot kannanottoineen. Ei mutu-arvioita: jokainen väite perustuu kuvaan tai mittaan.

2. **Korjaukset vain vahvistettuihin löydöksiin (Graphics).** Tehtävä `M1-5-RESPONSIVE-VISUAL-FIX`. Säilytä 640×360-looginen kamera, pelaajamäärät, pose-sopimukset ja deterministinen simulaatio. Lisää kohdennettu selainregressiotesti jokaiselle korjatulle löydökselle. Ei uusia taidetyylejä tässä vaiheessa.

3. **Uudelleentestaus ja omistajan visuaalinen hyväksyntä (Tester + omistaja).** ✅ Tehty: PR #112 (`715cd8a`). Tester antoi PASS WITH LIMITATIONS ja sulki molemmat löydökset uusintatarkistuksessa; **omistaja hyväksyi tuloksen 2026-11-02**. VIS05-02 ja VIS05-03 ovat suljettuja.

4. **Areena omistajan valinnalla.** ✅ Valinta 2026-11-02: **Ravintola Mesku**. Toteutus yhdistetty PR #118 (`44f222a`) ja **omistaja hyväksyi areenan visuaalisesti 2026-11-02**. Manifestikerros (`arenaVisuals.ts`, importiton) + Mesku 320×180-ruudukolla; asema pysyy oletuksena ja Mesku valitaan `?arena=mesku`. Tester vahvisti, että aseman kuvakaappaukset pysyivät tavuidenttisinä, ja mutaatiotestit osoittivat areenatestit ei-vakuiksi.

5. **Ääni ja osumapalaute.** ✅ Omistaja pyysi 2026-11-02 taustamusiikin ja kunnon efektit lyönneille, potkuille ja hypyille. Suunnitelma: [M7_AUDIO_PLAN.md](M7_AUDIO_PLAN.md). Suositus on proseduraalinen chiptune ja syntetisoidut efektit, jotta lisenssitekijöitä ei tule ja koodi on testattavaa; cue-rajapinta pidetään äänilähde-agnostisena, jotta tallennetut samplet voi vaihtaa myöhemmin. Tehtävät: `M7-AUDIO-CORE` (nyt), `M7-AUDIO-MIX` ja `M7-AUDIO-ACCEPTANCE` (backlog). **Omistajan tarkennus 2026-11-02: tässä vaiheessa riittävät geneeriset placeholder-äänet ja teknologia niiden soittamiseen; oikeat samplet ja miksaus myöhemmin.** Ääni on vain presentaatio: simulaation sormenjäljet eivät saa muuttua, eikä agentti voi arvioida miltä se kuulostaa — se on omistajan kuuntelupäätös.

### Tiedostorajaus ja omistus

- Designer: `docs/GOALS.md`, `docs/ROADMAP.md`, `docs/visual/**`, `docs/adr/**`, `.github/AGENT_TASKS.yaml`.
- Graphics: `src/game/presentation/**`, `public/assets/**`, `src/style.css`, visuaaliset testit (`tests/browser/**`).
- Tester: itsenäinen kuvien ja mittausten todentaminen; ei omista tuotantokoodia.
- Gameplay: ei muutoksia tässä tavoitteessa ilman erillistä päätöstä. Simulaation sormenjälkien on pysyttävä ennallaan.

### Hyväksyntätestit

- `npm test`, `npm run build`, `npm run test:browser` vihreät jokaisella PR-headilla; kirjaa mitä itse ajoit.
- `python scripts/validate_agent_tasks.py` → PASS ja `git diff --check` puhdas.
- Simulaation determinismisormenjäljet (fixtuuri `7fddf007…`, lopputila `de544fcd…`, tapahtumat `5bb44bd6…`) pysyvät muuttumattomina.
- Jokaisesta korjatusta visuaalisesta löydöksestä on kuvapari ennen/jälkeen ja koneellinen regressio.
- 640×360-looginen kamera, neljän pelaajan asettelu ja nykyiset pose-sopimukset säilyvät.

### Riskit ja rajat

- Visuaalinen hyväksyntä on omistajan silmäpari; agentti ei voi sitä antaa.
- Mobiiililuettavuus fyysisellä laitteella jää varmistamatta, ellei omistaja testaa puhelimella.
- Playwright-kuvien ottaminen on ympäristöherkkää; kuvat tallennetaan artefakteina ja niiden olemassaolo ei yksin todista laatua.
- Areenatyö voi vaikuttaa hahmojen erottuvuuteen; se on testattava neljän pelaajan tilanteessa ennen hyväksyntää.

### Päätösportit

- Omistaja valitsee areenakonseptin ennen kuin `M2-VIS-ARENA-ARCH` aloitetaan.
- Omistaja hyväksyy visuaalisen lopputuloksen ennen kuin VIS05-02/VIS05-03 suljetaan.
- Milestone 7:n hyväksyntä on erillinen omistajapäätös.

## Aktiivinen tavoite 2026-11-02: pelimuodot — Last Man Standing ja Deathmatch

**Valittu omistajan päätöksellä 2026-11-02.** Edellinen M7-polish-tavoite on suljettu. Tämä tavoite lisää kaksi itsenäistä pelimuotoa nykyisen Score Brawlin rinnalle.

### Tavoite

Toteuta **Last Man Standing** ja **Deathmatch** deterministisinä, testattuina pelimuotoina niin, että Score Brawl pysyy täysin muuttumattomana. Säännöt, HUD ja tulossivu ovat kutakin muotoa varten, ja muoto valitaan ennen matsia.

### Rajaus ja vaiheet

1. **Säännöt ja tapahtumat (Gameplay).** Tehtävä `M7-MODE-RULES`. Muoto on tyypitetty sääntöobjekti matsin luonnissa, ei hajallaan olevia ehtoja. Last Man Standing: yksi elämä, KO eliminoi ilman respawnia, matsi päättyy kun yksi on jäljellä. Deathmatch: KO kirjaa hyökkääjälle fragin, 20 fragia tai 120 s päättää matsin. Ajastimen tasatilanteet ratkaistaan spesifikaation mukaan. Tapahtumiin tulee tyypitetty loppusyy ja voittaja.
2. **Käyttöliittymä (Graphics).** Tehtävä `M7-MODE-UI`. Muotovalinta ennen matsia, muotokohtainen HUD (stockit / fragit / pisteet) ja tulossivu, joka nimeää voittajan ja loppusyyn. Luettavuusvaatimukset (≥14 px, VIS-05-tarkistukset) säilyvät.
3. **Verkkopeli (Gameplay).** Tehtävä `M7-MODE-ONLINE`. Serveri ottaa muodon vastaan ja ajaa auktoriteettisession niillä säännöillä; online-client näyttää muodon tilan snapshoteista keksimättä arvoja. Tuntematon muoto epäonnistuu selkeästi.
4. **Itsenäinen QA (Tester).** Tehtävä `M7-MODE-QA`. Eliminointi ei saa olla lyötävissä eikä ohjattavissa, frag-attribuutio ja frag-raja testataan, tasatilanteet ja ratkaisemattomat matsit testataan, ja Score Brawl todistetaan tavuidenttiseksi hyväksyttyyn baselineen.
5. **Omistajan hyväksyntä.** Omistaja pelaa kunkin muodon ja päättää tuntuuko se oikealta; rule-numerot (1 elämä, 20 fragia, 120 s) ovat designer-ehdotuksia ja muutettavissa.

### Tiedostorajaus ja omistus

- Gameplay: `src/game/modes/**`, `src/game/simulation/**`, `src/game/protocol/**`, `server/ws/**`, `src/game/networking/**`, relevant tests.
- Graphics: `src/game/presentation/**`, `src/style.css`, browser tests.
- Tester: itsenäinen todentaminen; ei omista tuotantokoodia.
- Designer: `docs/M7_GAME_MODES.md`, `docs/GOALS.md`, `docs/ROADMAP.md`, `.github/AGENT_TASKS.yaml`.

### Hyväksyntätestit

- Score Brawlin kiinnitetyt sormenjäljet pysyvät tavuidenttisina; olemassa olevia odotuksia ei muokata.
- Jokaisella muodolla on deterministinen replay-testi, jossa on kiinnitetty lopputila ja tapahtumajärjestys.
- Eliminoitu hahmo ei ota osumia, ei vastaanota inputia eikä näy aktiivisena.
- `npm test`, `npm run build`, koko selainsuite ja `git diff --check` vihreät jokaisella PR-headilla.

### Riskit ja rajat

- Ajastimen tasatilanteet ovat helposti väärin; ne kuuluvat puhtaisiin apufunktioihin yksikkötesteineen.
- HUD-muutokset voivat rikkoa juuri tehdyn luettavuustyön; VIS-05-tarkistukset ajetaan joka PR:ssä.
- Matsin päättymisajankohdan muutos voi vaikuttaa olemassa olevaan selainharnessiin, joka odottaa `fighting`-tilaa; ajetaan koko suite.
- Verkkopelimuodon valinta on erillinen siivu; paikallinen peli toimii ilman sitä.

### Päätösportit

- Omistaja vahvistaa rule-numerot, jos haluaa muuttaa ehdotettuja arvoja.
- Omistaja hyväksyy kunkin muodon tunnun pelaamalla.
- Milestone 7:n hyväksyntä on erillinen omistajapäätös.

## Tavoitedokumentin päivityskäytäntö

Kun omistaja valitsee uuden pitkän aikavälin tavoitteen, päivitä aktiivinen tavoite, omistukset, riippuvuudet, rajaus, todennettavat hyväksymisehdot, riskit ja päätösportti tähän tiedostoon. Säilytä aiempi tavoite lyhyenä päivättynä tulosmerkintänä; älä muuta suunnitelmia jälkikäteen toteutuneiksi faktoiksi.
