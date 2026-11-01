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

## Aktiivinen tavoite 2026-11-02: M2-kuljetuspäätös evidence-gatella

**Tila:** Session envelope -sopimus on hyväksytty ja sen ensimmäinen transport-neutraali toteutus on katselmoitavana (PR #94). Verkkokuljetusta ei ole valittu, eikä verkkopeliä ole toteutettu. M2:n benchmark harness on yhdistetty ja itsenäisesti validoitu korrektiuden osalta; suorituskykymittauksia ei ole.

### Tavoite

Tuota mitattu, toistettava näyttö WebSocket-palvelimen ja WebRTC-selainhostin välillä ja saata päätös kirjattavaksi ADR:ään. Tavoite ei ennalta valitse voittajaa eikä lupaa verkkopeliä tuotantoon.

### Peruste ja riippuvuudet

- M1 hyväksytty rajoituksin 2026-10-30; M1.5 hyväksytty rajoituksin 2026-11-01.
- M2 v1 -kodeekit, authorized ingress ja hardening ovat `main`issa (#41, #43) ja itsenäisesti arvioitu (PASS WITH LIMITATIONS).
- Session envelope -sopimus on hyväksytty ([M2_SESSION_ENVELOPE_V1.md](M2_SESSION_ENVELOPE_V1.md)); toteutus on työpuussa/PR:ssä.
- Benchmark harness ja sen itsenäinen korrektius-QA ovat valmiit (PR #79, #93); manifesti ja fixtuurit ovat toistettavia.
- Skenaariogate on dokumentoitu ([M2_BENCHMARK_SCENARIO_GATES.md](M2_BENCHMARK_SCENARIO_GATES.md)); mittaussuunnitelma on [NETWORK_BENCHMARK_PLAN.md](NETWORK_BENCHMARK_PLAN.md).
- WS/WebRTC-valinta on **avoin** eikä sitä saa päätellä yhdestä mittarista.

### Työvaiheet

1. **Envelope toteutus maaliin.** Gameplay saattaa PR #94:n katselmointikuntoon; Tester antaa itsenäisen negatiivisen testauksen (spoofing, cross-room, replay, myöhäiset/future-tickit, monipaikkainen omistajuus, reconnect). Vasta vihreän CI:n ja Tester-raportin jälkeen merge. Ei soketteja tässä siivussa.
2. **Skenaariot toteutuskelpoisiksi.** Määritä 4 ja 8 pelaajan, 30/60 Hz inputin, 10/20/30 Hz snapshotin, viiveen/jitterin/lossin ja host-exitin tapaukset ajettaviksi harnessilla. Ei keksittyjä raja-arvoja: perusta kodeekkien ja sessionikkunan rajoihin.
3. **Sama työkuorma molemmille arkkitehtuureille.** Rakenna WS-palvelinprototyyppi (Milestone 3) ja WebRTC-selainhost + signalointi (Milestone 4) erillisiin PR:iin, mutta samoilla seedeillä, fixtuureilla ja snapshottitiheyksillä. Loopback ei ole LAN-näyttöä.
4. **Mittaa.** Vähintään 5 × 120 s ajoa keskeisistä tapauksista fyysisellä LANilla ja internetillä, mukaan lukien pakettihäviö, jitter, NAT/CGNAT ja TURN-relay. Kirjaa p50/p95/p99, tick-duration, tavut/s, CPU/RAM, join-onnistuminen ja kustannusarvio. Tallennukset `benchmarks/results/` (ei salaisuuksia, ei yksityisiä IP:itä).
5. **Päätä evidence-gatella.** Julkaise `benchmarks/RESULTS.md` ja `docs/adr/0001-network-topology.md`. Jos molemmat kelpaavat, suosi yksinkertaisempaa ja luotettavampaa; valinta on omistajan päätös.
6. **Siivoa.** Poista vanhentuneet paikalliset työpuut ja sulje vanhentuneet haarat vasta, kun niiden sisältö on todistetusti mainissa.

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
- Benchmarkit: sama seed ja fixtuuri tuottavat identtiset loppu- ja tapahtumasormenjäljet molemmilla arkkitehtuureilla ennen kuin yhtään suorituskykylukua raportoidaan.
- ADR:ään ei merkitä valintaa ilman vähintään viittä mitattua ajoa keskeisistä tapauksista ja raportoituja rajoitteita.

### Riskit ja rajat

- Session envelope suojaa vain muodon ja omistajuuden; se ei ole autentikointi, salaus eikä DoS-suoja. Transport adapterin on todennettava connection ID.
- Fyysistä gamepad-laitteistoa ei ole varmennettu; testit käyttävät simuloituja ohjaimia.
- Playwright-sarja on kuormaherkkä (120 s harness aikakatkaisi kerran rinnakkaisajossa); flakeä seurataan.
- Selaintuki WebRTC:lle, TURN-kustannukset ja CGNAT käyttäytyminen ovat avoimia, kunnes mitataan.
- VIS05-02/VIS05-03 ja areenatyö on tarkoituksella siirretty myöhemmäksi; älä avaa niitä ilman omistajan päätöstä.

### Haara-, PR- ja päätösportit

Työ tehdään omassa haarassa, yksi PR per yhtenäinen työpaketti (`DESIGNER:`/`LOGIC:`/`GRAPHICS:`/`TESTER:`-etuliite, `Task: <id>` kuvauksessa). Aja CI ja korjaa havainnot samassa PR:ssä. Älä yhdistä ilman omistajan lupaa. Jokainen milestone-hyväksyntä ja kuljetusvalinta on erillinen omistajapäätös.

**Omistajan päätökset, jotka ovat vielä auki:** (1) PR #94:n ja tulevien PR:ien merget, (2) WS/WebRTC-valinta mittausten jälkeen, (3) lisenssit (M0).

## Tavoitedokumentin päivityskäytäntö

Kun omistaja valitsee uuden pitkän aikavälin tavoitteen, päivitä aktiivinen tavoite, omistukset, riippuvuudet, rajaus, todennettavat hyväksymisehdot, riskit ja päätösportti tähän tiedostoon. Säilytä aiempi tavoite lyhyenä päivättynä tulosmerkintänä; älä muuta suunnitelmia jälkikäteen toteutuneiksi faktoiksi.
