# Pitkän matkan tavoitteet

Tämä on projektin päivitettävä tavoitedokumentti harness- ja agenttityölle. Aktiivinen tavoite on rajattu itsenäiseksi kokonaisuudeksi, jolla on todennettavat hyväksymisehdot. Päivitä tavoite omistajan päätöksen ja uuden näytön perusteella; älä merkitse suunnitelmaa toteutetuksi, hyväksytyksi tai yhdistetyksi ilman näyttöä ja omistajan lupaa.

## Arkistoitu tavoite 2026-10-31: PR:t #21, #25 ja #28

Tämä tavoite suljettiin 2026-11-01. Tulokset kirjataan tähän, jotta vanhat väitteet eivät jää elämään aktiivisina.

| PR | Lopputulos | Näyttö |
| --- | --- | --- |
| #21 M1.5-VIS-01 | Yhdistetty | merge `c0ae871`; headin `93603c0` pakolliset CI-tarkistukset vihreät; omistaja hyväksyi VIS-01-tyylisuunnan ja mergen 2026-10-31 |
| #28 OpenCode-työnkulku | Yhdistetty | merge `b78ad75`; check-task, quality, game-harness ja browser-smoke vihreät |
| #25 M2-protokolla | **Suljettu yhdistämättä** | suljettu 2026-10-31 15:15 UTC; sisältö integroitiin PR:issä #41 (`9486947`) ja #43 (`bb6058a`) |

Opetus: tarkista aina remote-PR:n todellinen tila (`gh pr view`/`gh pr checks`) ennen kuin jatkat paikallisesta haarasta. Paikalliset `revision/*`-työpuut ovat tämän jälkeen historiallisia eivätkä osoita PR:n tilaa.

## Aktiivinen tavoite 2026-11-01: M1.5 suljetaan ja M2 valmistellaan kuljetusporttia varten

**Tila:** M1.5 on omistajan hyväksymä 2026-11-01 (visuaalinen suunta ja toteutus, dokumentoiduin rajoituksin). M2:n protokolla v1 ja authorized ingress on yhdistetty ja riippumattomasti arvioitu (PASS WITH LIMITATIONS). Verkkokuljetusta ei ole valittu eikä verkkopeliä ole toteutettu.

### Tavoite

Saata projekti tilaan, jossa (1) M1.5:n hyväksyntä ja sen rajoitukset on kirjattu repositoryyn, (2) dokumentaatio vastaa `main`-haaran todellista tilaa, (3) M2:n seuraava päätösportti — session envelope ja sen jälkeen WS/WebRTC-benchmarkit — on yksiselitteisesti määritelty ja aloitettavissa ilman ristiriitaisia ohjeita.

### Peruste ja riippuvuudet

- M1 on hyväksytty rajoituksin 2026-10-30 ([M1 acceptance report](M1_ACCEPTANCE_REPORT.md)).
- M1.5:n visuaalinen toteutus on `main`issa: VIS-01 #21, P2 #30, P3/P4 #36, HUD #39, asema #44, hit-flash #47, viewport-korjaukset #76/#83, retro-tuotantobuild #85. VIS-05:n automaattinen QA ja kuvakatselmus on tehty; VIS05-02 (3×-skaalaus) ja VIS05-03 (mobiilin luettavuus) jäävät kirjatuiksi jatkoseurannoiksi.
- M2 v1 -kodeekit ja session ingress ovat `main`issa (#41, #43) ja riippumaton Tester-gate on annettu ([M2 independent tester report](M2_INDEPENDENT_TESTER_REPORT.md)). Session envelope on yhä **ehdotus** ([M2_SESSION_ENVELOPE_V1.md](M2_SESSION_ENVELOPE_V1.md)).
- Benchmark harness -toteutus on avoin PR #79; se vaatii riippumattoman Tester-gaten ennen mergeä.
- WebSocket vs WebRTC -päätös pysyy **auki**, kunnes molemmat on mitattu ([NETWORK_BENCHMARK_PLAN.md](NETWORK_BENCHMARK_PLAN.md)).

### Työvaiheet

1. **Dokumentaation reconciliation (tämä työpaketti).** Päivitä `docs/GOALS.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `.github/AGENT_TASKS.yaml` ja kirjaa M1.5:n hyväksyntä uuteen `docs/M1_5_ACCEPTANCE_REPORT.md`-tiedostoon. Poista vanhentuneet väitteet PR #25:stä aktiivisena porttina. Tämä ei muuta pelikoodia eikä hyväksy verkkoarkkitehtuuria.
2. **M1.5-julkaisun varmistus.** Varmista, että tuotanto-Pages palvelee retrobuildia ja ettei konsolissa/verkossa ole virheitä. Tarvittaessa lisää pieni savutesti tai dokumentoitu manuaalinen tarkistus; älä muuta visuaalisuuntaa ilman uutta omistajapäätöstä.
3. **Benchmark harness -gate.** Tester arvioi PR #79:n (fixture-toistettavuus, manifestin NOT_MEASURED-semantiikka, negatiiviset testit). PASSin jälkeen omistaja hyväksyy mergen. Tämän jälkeen `WP-M2-BENCHMARK-VALIDATION` voi käynnistyä.
4. **Session envelope -päätös.** Omistaja päättää omistajuusmallin (connection→player), duplikaatti- ja myöhäisen inputin politiikan, tikkijakauman ja reconnect-käytännön. Vasta sen jälkeen `M2-ENVELOPE-IMPLEMENTATION` voidaan avata. Ei WS/WebRTC-valintaa tässä vaiheessa.
5. **Kuljetusbenchmarkit.** Vasta kun envelope ja harness ovat valmiit, toteutetaan A (WebSocket) ja B (WebRTC) samoilla syötteillä ja mitataan ≥5 ajoa skenaariota kohden. Tulos kirjataan `benchmarks/RESULTS.md`:hen ja ADR:ään; valinta on erillinen omistajapäätös.
6. **Underhåll (rinnalla):** CI:n riippuvuusvakaus (issue #23: `package-lock.json` + `npm ci`), `test-results/`/`artifacts/` `.gitignore`en, avoimien planning-PR:ien (#77, #80, #81, #82) siivous ja vanhentuneiden työpuiden poisto.

### Tiedostorajaus ja omistus

- Designer: `docs/GOALS.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/M1_5_ACCEPTANCE_REPORT.md`, `docs/M2_*.md`, `.github/AGENT_TASKS.yaml`, `.opencode/agents/**`, `opencode.json`, `AGENTS.md`.
- Gameplay: `src/game/simulation/**`, `src/game/modes/**`, `src/game/input/**`, `src/game/protocol/**`, `src/game/session/**`, `benchmarks/**`, relevant tests.
- Graphics: `public/assets/**`, `src/game/presentation/**`, `src/style.css`, visual tests.
- Tester: itsenäinen todentaminen; ei omista tuotantokoodia eikä hyväksy omia muutoksiaan.

### Hyväksyntätestit

- `python scripts/validate_agent_tasks.py` → PASS.
- `npm test`, `npm run build` ja `npm run test:browser` vihreät (dokumentaatiomuutoksessa riittää, että CI ajaa ne; kirjaa erikseen mitä itse ajoit).
- `git diff --check` puhdas.
- Dokumenttien ristiriidattomuus: GOALS/ROADMAP/ARCHITECTURE eivät väitä M1.5:tä tai verkkopeliä hyväksytyksi/toteutetuksi eri tavalla kuin `main` ja omistajan päätökset osoittavat.
- PR:n CI vihreä lopullisella headilla ennen mergeä.

### Riskit ja rajat

- M1.5:n VIS05-02 ja VIS05-03 ovat avoimia laatu- ja saavutettavuushuomioita; hyväksyntä ei poista niitä.
- Fyysistä gamepad-laitteistoa ei ole varmennettu; testit käyttävät simuloituja ohjaimia.
- Playwrightin koko sarja on herkkä rinnakkaiselle kuormitukselle: paikallisessa ajossa 2 workerilla 120 s harness aikakatkaisi kerran ja meni läpi yksin ajettuna. CI on vihreä, mutta flakeä on seurattava.
- Session envelope, autentikointi ja kuljetusturva ovat toteuttamatta; v1-kodeekkia ei saa kuvata turvalliseksi verkkoprotokollaksi.
- Avoimet planning-PR:t voivat sisältää vanhentunutta tehtäväjonoa; älä palauta ylikirjoitettuja tehtäviä.

### Haara-, PR- ja päätösportit

Työ tehdään omassa haarassa ja yhdessä PR:ssä per työpaketti (`DESIGNER:`-etuliite, `Task: <id>` PR-kuvauksessa). Älä yhdistä ilman omistajan lupaa. Jokainen milestone-hyväksyntä ja kuljetusvalinta on erillinen omistajapäätös.

**Omistajan päätökset, jotka ovat vielä auki:** (1) session envelope -mallin hyväksyntä, (2) PR #79:n ja muiden avoimien PR:ien merget, (3) WS/WebRTC-valinta mittausten jälkeen, (4) lisenssit (M0).

## Tavoitedokumentin päivityskäytäntö

Kun omistaja valitsee uuden pitkän aikavälin tavoitteen, päivitä aktiivinen tavoite, omistukset, riippuvuudet, rajaus, todennettavat hyväksymisehdot, riskit ja päätösportti tähän tiedostoon. Säilytä aiempi tavoite lyhyenä päivättyinä päätös-/tulosmerkintöinä; älä muuta suunnitelmia jälkikäteen toteutuneiksi faktoiksi.
