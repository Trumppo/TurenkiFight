# Pitkän matkan tavoitteet

Tämä on projektin päivitettävä tavoitedokumentti harness- ja agenttityölle. Aktiivinen tavoite on rajattu itsenäiseksi kokonaisuudeksi, jolla on todennettavat hyväksymisehdot. Päivitä tavoite omistajan päätöksen ja uuden näytön perusteella; älä merkitse suunnitelmaa toteutetuksi, hyväksytyksi tai yhdistetyksi ilman näyttöä ja omistajan lupaa.

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

**Omistajan päätökset 2026-11-02 (M7):** VIS05-02/VIS05-03 hyväksytty sellaisenaan; areenaksi valittu **Ravintola Mesku**.

**Omistajan jo tekemät päätökset tässä tavoitteessa:** envelope-sopimus 2026-11-01; PR:ien #94–#107 merget on hyväksytty ja yhdistetty; 2026-11-02 milestone 5 -portti muutettu lähdekatsaukseksi ja yhden koneen mittauksiksi, painotuksena latenssi ja liikkeen sujuvuus.

## Aktiivinen tavoite 2026-11-02: M7 — paikallisen pelin polish

**Valittu omistajan päätöksellä 2026-11-02.** M2-kuljetuspäätös on suljettu (arkkitehtuuri A). Tämä tavoite keskittyy paikallisen pelin laatuun; verkkoon ei kosketa.

### Tavoite

Saata paikallinen neljän pelaajan peli visuaalisesti ja luettavuudeltaan hyväksyttävään kuntoon kaikilla tuetuilla näyttöko'oilla, ja avaa areenatyö omistajan valitsemalla konseptilla. Tavoite ei muuta simulaatiota, determinismiä eikä pelisääntöjä.

### Rajaus ja vaiheet

1. **Responsiivisuuden todentaminen (Tester).** Tehtävä `M1-5-RESPONSIVE-VISUAL-REVIEW`. Tuota tuore näyttö nykyisestä `main`-buildista 1920×1080- ja 390×844-viewporteilla: mittaa käyttämätön pinta-ala, HUD-tekstin todellinen pikselikoko, canvasin sijoittuminen ja skaalauskerroin. Tuloksena yksilöidyt, toistettavat löydökset (VIS05-02, VIS05-03) ja konkreettiset korjausvaihtoehdot kannanottoineen. Ei mutu-arvioita: jokainen väite perustuu kuvaan tai mittaan.

2. **Korjaukset vain vahvistettuihin löydöksiin (Graphics).** Tehtävä `M1-5-RESPONSIVE-VISUAL-FIX`. Säilytä 640×360-looginen kamera, pelaajamäärät, pose-sopimukset ja deterministinen simulaatio. Lisää kohdennettu selainregressiotesti jokaiselle korjatulle löydökselle. Ei uusia taidetyylejä tässä vaiheessa.

3. **Uudelleentestaus ja omistajan visuaalinen hyväksyntä (Tester + omistaja).** ✅ Tehty: PR #112 (`715cd8a`). Tester antoi PASS WITH LIMITATIONS ja sulki molemmat löydökset uusintatarkistuksessa; **omistaja hyväksyi tuloksen 2026-11-02**. VIS05-02 ja VIS05-03 ovat suljettuja.

4. **Areena omistajan valinnalla.** ✅ Valinta tehty 2026-11-02: **Ravintola Mesku** ([NEXT_ARENA_CONCEPT.md](visual/NEXT_ARENA_CONCEPT.md), PR #70 konsepti). Toteutus on aktivoitu tehtävässä `M2-VIS-ARENA-ARCH`: ensin tyypitetty, presentaatio-only areenamanifesti (asema ensimmäisenä manifestina, oletukset ja kuvat ennallaan), sitten Mesku toisena areenana 320×180-ruudukolla ja konseptin paletilla. Ei simulaatio- eikä pelisääntömuutoksia.

5. **Valinnainen myöhemmin:** ääni, osumapalautteen hienosäätö ja tasapainotus. Ei kuulu tämän tavoitteen hyväksymisehtoihin, ellei omistaja erikseen pyydä.

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

## Tavoitedokumentin päivityskäytäntö

Kun omistaja valitsee uuden pitkän aikavälin tavoitteen, päivitä aktiivinen tavoite, omistukset, riippuvuudet, rajaus, todennettavat hyväksymisehdot, riskit ja päätösportti tähän tiedostoon. Säilytä aiempi tavoite lyhyenä päivättynä tulosmerkintänä; älä muuta suunnitelmia jälkikäteen toteutuneiksi faktoiksi.
