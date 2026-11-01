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

**Omistajan jo tekemät päätökset tässä tavoitteessa:** envelope-sopimus 2026-11-01; PR:ien #94–#107 merget on hyväksytty ja yhdistetty; 2026-11-02 milestone 5 -portti muutettu lähdekatsaukseksi ja yhden koneen mittauksiksi, painotuksena latenssi ja liikkeen sujuvuus.

## Seuraava tavoite: ehdotus (odottaa omistajan valintaa)

M2-kuljetuspäätös on valmis. Seuraavaksi tarvitaan omistajan valinta suunnasta; tässä kolme realistista vaihtoehtoa.

**Vaihtoehto 1 — Verkkopelin ensimmäinen pelattava siivu (M6 alku).** Keskitetty WebSocket-palvelin, TLS ja autentikointi, rate limiting, reconnect, huoneen elinkaari ja interpolointi asiakaspäässä. Tavoite: kaksi selainta samassa verkossa pelaa yhden matsin ilman käsin tehtyjä askelia. Tämä on luontevin jatko hyväksytylle ADR:lle.

**Vaihtoehto 2 — Latenssibudjetti ja playtest.** Määritä mitattava input-to-photon-budjetti ja pelaa 2–4 pelaajan matsi oikeassa verkossa. Tulos joko vahvistaa ADR:n tai laukaisee uudelleenarvioinnin (WebTransport / redundanssi). Pienin työ, suurin tiedollinen arvo seuraavalle päätökselle.

**Vaihtoehto 3 — Paikallisen pelin viimeistely (M7).** VIS05-02/VIS05-03, areenatyö ja muu polish, jotka omistaja siirsi aiemmin. Ei edistä verkkopeliä.

Suositus: **Vaihtoehto 2 ensin** (halpa, poistaa suurimman avoimen riskin) ja sen jälkeen **Vaihtoehto 1**. Kumpikaan ei käynnisty ilman omistajan valintaa.

## Tavoitedokumentin päivityskäytäntö

Kun omistaja valitsee uuden pitkän aikavälin tavoitteen, päivitä aktiivinen tavoite, omistukset, riippuvuudet, rajaus, todennettavat hyväksymisehdot, riskit ja päätösportti tähän tiedostoon. Säilytä aiempi tavoite lyhyenä päivättynä tulosmerkintänä; älä muuta suunnitelmia jälkikäteen toteutuneiksi faktoiksi.
