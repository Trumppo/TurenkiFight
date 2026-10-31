# Pitkän matkan tavoitteet

Tämä on projektin päivitettävä tavoitedokumentti harness- ja agenttityölle. Aktiivinen tavoite on rajattu itsenäiseksi kokonaisuudeksi, jolla on todennettavat hyväksymisehdot. Päivitä tavoite omistajan päätöksen ja uuden näytön perusteella; älä merkitse suunnitelmaa toteutetuksi, hyväksytyksi tai yhdistetyksi ilman näyttöä ja omistajan lupaa.

## Kokonaistavoite: PR:t #21, #25 ja #28 omistajan päätöksentekoon

**Tila:** PR #22, #21 ja #28 on yhdistetty. PR #25 on yhä draft vanhalla headilla; sen current-main-hardening on testattu paikallisesti ja odottaa uutta GitHub CI:tä ennen mergeä. Kokonaistavoite valmistuu, kun PR #25 on omistajan luvalla yhdistetty. PR #21:n merge ei hyväksynyt M1.5-milestonea eikä PR #25 valitse verkkokuljetusta.

**Etenemisjärjestys:** PR #21, #22 ja #28 ovat valmiit. PR #25:n current-main-hardening pusketaan hyväksyttyyn olemassa olevaan haaraan, CI ajetaan ja PR yhdistetään vihreiden tarkistusten jälkeen. WebSocket/WebRTC-valinta pysyy auki.

### Työkokonaisuus A — PR #21: M1.5-VIS-01

**Tila:** valmis PR #21 merge commitilla c0ae871. Omistaja hyväksyi VIS-01:n yhden hahmon ja aseman visuaalisuunnan sekä PR:n merge; tämä ei hyväksy koko M1.5-milestonea eikä tee 48x64-variantista oletusta.

### Tavoite

Tee PR #21:stä perusteellisesti testattu ja omistajan arvioitavissa oleva, opt-in yhden hahmon ja aseman visuaalinen prototyyppi. Säilytä hyväksytty M1-perusta ja nykyinen retro/classic-palautettavuus. Älä laajenna tehtävää muiden hahmojen tai koko HUD:n uudistukseen.

### Peruste ja riippuvuudet

- M1 on hyväksytty dokumentoiduin rajoituksin; M1.5-visuaalisuunta on hyväksytty konseptina, mutta prototyyppiä tai massauudistusta ei ole hyväksytty.
- PR #21:n nykyinen lähtöpiste: `feature/m1-5-visual-prototype`, head `bbee0c1` (seuraa PR:n todellista headia ennen töiden jatkamista).
- VIS-01:n hyväksyntä on riippuvainen omistajan retro/classic-kuvakaappausten katselmoinnista.
- P1:n 32×48 retrovariantti on oletusprototyyppi. 48×64 on toteutettu kokeellinen opt-in, jota ei ole hyväksytty oletukseksi.
- M2:n WebSocket/WebRTC-arkkitehtuuripäätös pysyy avoimena eikä kuulu tähän tavoitteeseen.

### Työpuu ja agenttien omistus

Pidä PR #21:n muutokset erillään Designer-istunnon työhakemistosta. Nykyinen paikallinen työpuu on:

`C:\Users\Marko\AppData\Local\Temp\opencode\TurenkiFight-pr21-visual-proof`

Haara on `revision/m1-5-visual-proof`; se perustuu PR #21:n headiin ja sisältää paikallisia, julkaisemattomia muutoksia. Tarkista haara, head ja työpuun tila ennen jatkoa; polku voi muuttua.

- **Graphics:** `tests/browser/retro.spec.ts` ja visuaaliset testit. Älä muokkaa simulaatiota tai jaettuja scene-tiedostoja tämän tavoitteen puitteissa.
- **Designer:** `docs/visual/M1_5_VISUAL_PROTOTYPE_REPORT.md` ja `docs/visual/M1_5_EXPANDED_FIGHTER_PLAN.md`; päivitä ne vasta kun uudet testitulokset ja kuvat on tarkistettu.
- **Tester:** riippumaton tarkistus, jos saatavilla; raportoi toistettavat viat, älä muuta Graphicsin tiedostoja ilman tehtäväkohtaista omistusta.

### Työvaiheet

1. Tarkasta PR:n diff, nykyinen head, lähtöhaara ja aiempi CI. Älä oleta, että vanhat CI-ajot kattavat uusia muutoksia.
2. Säilytä lobby-kuvat ja varmista oikea kahden pelaajan ottelu: P2 liittyy Shiftillä, P1 käynnistää Enterillä, ja testi odottaa simulaation `fighting`-vaihetta.
3. Kaappaa retro- ja classic-näkymät lobbyssa ja aloitetussa ottelussa 640×360-, 2×-, 3×- ja 390×844-mobiilirajauksissa. Varmista canvasin 640×360-koko, 16:9-suhde sekä puuttuvien assettien ja JavaScript-virheiden puuttuminen.
4. Tarkista kuvat ja pose-artefaktit. Testi siirtää P1:tä tavallisella D-syötteellä kyltin ohi vain kuvakaappausta varten; oletus-spawnia ei muuteta eikä sen näkymää ole vielä omistajan silmin katselmoitu. Älä muuta pelin spawnia tai StationScene.ts.
5. Tarkista laajennettu 48×64-variantti omana kokeilunaan: koko, origin/foot anchor, P2:n muuttumattomuus sekä säilyneet pose-avaimet. Se ei saa muuttua oletukseksi.
6. Päivitä visuaaliset raportit todenmukaisiksi: erottele toteutettu, kokeellinen, CI:llä varmistettu ja omistajan hyväksymä. Älä ilmoita hyväksyntää tai CI-tulosta ilman näyttöä.
7. Toista hyväksyntätestit jokaisen korjauskierroksen jälkeen ja kokoa diff, tulokset, kuvapolut ja jäljelle jäävät riskit omistajan katselmointiin.

### Tiedostorajaus ja ulkopuolinen

Sallitut projektitiedostot tälle tavoitteelle:

- `tests/browser/retro.spec.ts` — Graphics
- `docs/visual/M1_5_VISUAL_PROTOTYPE_REPORT.md` — Designer
- `docs/visual/M1_5_EXPANDED_FIGHTER_PLAN.md` — Designer

Älä muuta `src/game/simulation/**`, pelisääntöjä, hitboxeja, spawn-asetuksia, HUDia, `StationScene.ts`:ää, muita assetteja, pakettiriippuvuuksia tai `package-lock.json`:ia ilman uutta näyttöä ja omistajan lupaa. `artifacts/`, `test-results/` ja muut testien tuotokset ovat lähtökohtaisesti paikallisia artefakteja, eivät PR-sisältöä.

### Hyväksyntätestit

Suorita erikseen:

- Retro: `VITE_VISUAL_STYLE=retro npm run test:browser -- tests/browser/retro.spec.ts`
- Classic: `VITE_VISUAL_STYLE=classic npm run test:browser -- tests/browser/retro.spec.ts`
- Expanded retro: `VITE_VISUAL_STYLE=retro` ja `VITE_FIGHTER_CANVAS=expanded`, sitten sama Playwright-komento
- `npm test`
- `npm run build`
- `git diff --check`

Käytä Windows PowerShellissä ympäristömuuttujille esimerkiksi `$env:VITE_VISUAL_STYLE='retro'`. Kirjaa tarkat testikomennot, tulokset, ohitetut testit ja epäonnistumisten todelliset syyt. Aja selain-smoke ja PR:n CI, jos ympäristö sallii; erottele aiempi CI nykyisen revision tuloksista.

**Nykyinen näyttö:** PR #21 head 93603c0:n pakolliset CI-tarkistukset (quality, browser-smoke, game-harness, retro-visual-QA) läpäisivät; paikalliset retro/expanded/classic-testit, 46 yksikkötestiä ja build myös. PR #25 current-main-hardening: protokollat 60/60, full suite 92/92, build-varoitus, browser smoke 14/14 ja diff-check; riippumaton Tester PASS rajoituksin. PR #25:n uusi head ei ole vielä GitHubissa, joten sen CI puuttuu.

### Riskit ja rajat

- Kuvakaappausten automaattinen syntyminen ei ole visuaalinen hyväksyntä; omistajan tulee katsoa lopulliset kuvat. Jos agentin käytössä ei ole kuvaa ymmärtävää mallia, tätä rajoitetta ei saa peittää.
- Lobby-overlay, P1:n suhde aseman kylttiin, mobiilin luettavuus ja neljän pelaajan samanaikainen luettavuus vaativat erillistä arviota.
- PR #21:n uudelleenkatselmointi voi vaatia uuden CI-ajon, vaikka aiempi head oli vihreä.

### Haara-, PR- ja päätösportti

Tämä työ on valmis PR #21:n osalta: omistajan hyväksymä VIS-01-prototyyppi merge commitilla c0ae871. Älä merkitse M1.5-milestonea hyväksytyksi.

**Omistajan päätös:** täytetty VIS-01-scopeen; PR #21 yhdistettiin commitilla c0ae871. Tämä ei hyväksy M1.5-milestonea; VIS-02-05 vaativat erillisen laajuuden.

### Työkokonaisuus B — PR #25: M2:n siirtoriippumattoman protokollan ensimmäinen siivu

**Tavoite:** katselmoi versionoidut `InputFrame`-, `StateSnapshot`- ja `EventBatch`-sopimukset sekä rajatut input-/snapshot-bufferi- ja replay-apurit. Korjaa vain osoitetut virheet, dokumentoi rajat ja tuo draft omistajan katselmointiin. Protokollatyö ei valitse WebSocket- tai WebRTC-topologiaa.

**Nykytila:** GitHub PR #25 on draft headilla 63fb566 ja basella 7932aa; sen vanhan headin CI läpäisi ja GitHub näyttää CLEAN/MERGEABLE. Paikallinen revision/m2-protocol-hardening sisältää current mainin c0ae871 merge-commitin, kovennetun koodin ja päivitetyt M2/GOALS-dokumentit. Varmennetut paikalliset tulokset: protokollat 60/60, full suite 92/92, build-varoitus, browser smoke 14/14, diff-check puhdas; Tester PASS rajoituksin. Uuden headin GitHub CI puuttuu.

- **Riippuvuudet:** hyväksytty M1-simulaation input/state/event-sopimus sekä nykyinen `docs/NETWORK_BENCHMARK_PLAN.md`; WebSocket/WebRTC-päätös pysyy avoimena.
- **Omistus ja tiedostot:** Gameplay omistaa `src/game/protocol/**`-koodin ja testit; Designer omistaa `docs/M2_INPUT_PROTOCOL.md`-sopimustekstin ja rajausten katselmoinnin; Tester tarkistaa regressiot itsenäisesti.
- **Hyväksyntä:** strict codec -testit hylkäävät väärän version, ylimääräiset kentät, duplikaattipelaajat, virheelliset tickit ja liian isot payloadit; bufferi/replay-testit osoittavat saman simulaatiotilan identtisillä syötteillä; `npm test`, build, browser smoke ja diff-check läpäisevät nykyisellä headilla. Dokumentaatio sanoo selvästi, ettei codec ole autentikointi, rollback, synkronointi tai kuljetusvalinta.
- **Rajauksen ulkopuolella:** WS/WebRTC-adapterit, session-authority, lobby, client prediction/rollback, salausturva ja gameplay-säännöt.
- **Riski:** PR on vanhalla basella ja snapshotin koko-/rosterirajat ovat nyt kiinteitä; arvioi niiden tarkoituksenmukaisuus ennen protokollan vakauttamista. Älä laajenna ilman omistajan hyväksyntää.
- **Haara/PR:** revision/m2-protocol-hardening sisältää remote PR #25 headin ja current main c0ae871 merge-commitin, joten push feature/m2-input-frame-contract-haaraan on normaalisti fast-forward (ei force-push). Omistaja on hyväksynyt pushin ja mergen; aja uusi CI ja yhdistä vasta kaikkien pakollisten tarkistusten vihreydyttyä.
- **Omistajan portti:** finite-only z/vz + fail-closed on omistajan hyväksymä PR #25 v1 -rajaus; fyysinen hyppykorkeusraja siirretään erilliseksi Gameplay-tehtäväksi ennen authoritative online snapshot/restore -käyttöä. Omistaja on luvittanut PR #25:n pushin ja mergen; jäljellä on uuden remote-headin CI:n läpäisy.

### Työkokonaisuus C — PR #28: OpenCode-agenttityönkulku

**Tavoite:** varmista, että projektin Designer-, Gameplay-, Graphics- ja Tester-roolit, malli-ID:t, delegointirajat ja hyväksyntäportit vastaavat todellista käyttöä, ja esitä PR #28 merge-valmiina tai listaa jäljellä olevat esteet.

**Nykytila:** valmis; PR #28 yhdistettiin commitilla b78ad75. CI check-task, quality, game-harness ja browser-smoke läpäisivät; haavoittuvuusskannaus ohitettiin. Graphics-delegoinnin live-testi onnistui.

- **Riippuvuudet:** omistajan käyttämä OpenCode V2 -projektilataus sekä `.opencode/agents/*.md`- ja `opencode.json`-asetukset. Mallien saatavuus ja Go-tilauksen käyttöoikeus ovat runtime-tietoja; älä päättele niitä pelkästä tiedostosta.
- **Omistus ja tiedostot:** Designer omistaa `.opencode/agents/designer.md`, `.opencode/agents/gameplay.md`, `AGENTS.md`, `docs/OPENCODE_HANDOFF.md`, `opencode.json` ja tämän tavoitedokumentin `docs/GOALS.md`; agenttikohtaiset mallivalinnat tarkistetaan agenttitiedostoista. Gameplay-agentin protokollan muokkausoikeus on rajattu `src/game/protocol/**`-polkuun.
- **Hyväksyntä:** tarkista PR-diff, `opencode.json`-jäsennys, agenttien frontmatterit, `scripts/validate_agent_tasks.py`, `git diff --check`, tuore PR-CI sekä kevyt live-delegointi (Graphics käynnistyy mallillaan ja Gameplay pystyy muokkaamaan vain sille rajattua protokollapolkua). Päivitä PR-kuvauksen vanhentuneet tarkistusväitteet tarvittaessa. Älä väitä paikallista `npm test` -ajoa tehdyksi, jos sitä ei ajettu.
- **Rajauksen ulkopuolella:** suojattujen asetusten muuttaminen, tunnusten tai salaisuuksien lukeminen, mallipalveluntarjoajan tai tietosuojareitityksen vaihtaminen, gameplay-/visual-featuret.
- **Riski:** GitHubin vihreä CI ei todista paikallisen OpenCode-instanssin kaikkien agenttien tai mallien toimivuutta; yksi onnistunut Graphics-delegointi ei kata Gameplay-/Tester-rooleja.
- **Haara/PR:** PR #28 on yhdistetty; sen merge commit on mainissa. Muutokset sen jälkeen agenttiasetuksiin vaativat uuden rajatun PR:n ja omistajan päätöksen.
- **Omistajan portti:** täytetty; omistaja hyväksyi PR #28:n yhdistämisen ja merge toteutui commitilla b78ad75.

## Tavoitedokumentin päivityskäytäntö

Kun omistaja valitsee uuden pitkän aikavälin tavoitteen, päivitä aktiivinen tavoite, omistukset, riippuvuudet, rajaus, todennettavat hyväksymisehdot, riskit ja päätösportti tähän tiedostoon. Säilytä aiempi tavoite lyhyenä päivättyinä päätös-/tulosmerkintöinä; älä muuta suunnitelmia jälkikäteen toteutuneiksi faktoiksi.
