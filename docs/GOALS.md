# Pitkän matkan tavoitteet

Tämä on projektin päivitettävä tavoitedokumentti harness- ja agenttityölle. Aktiivinen tavoite on rajattu itsenäiseksi kokonaisuudeksi, jolla on todennettavat hyväksymisehdot. Päivitä tavoite omistajan päätöksen ja uuden näytön perusteella; älä merkitse suunnitelmaa toteutetuksi, hyväksytyksi tai yhdistetyksi ilman näyttöä ja omistajan lupaa.

## Kokonaistavoite: PR:t #21, #25 ja #28 omistajan päätöksentekoon

**Tila:** PR #22 ja #28 on yhdistetty. PR #21 ja #25 ovat draft; omistaja on hyväksynyt niiden nykyiset rajatut muutokset sekä push/merge-etenemisen vihreiden tarkistusten jälkeen. PR #21:n merge ei hyväksy koko M1.5-milestonea, eikä PR #25 lukitse verkkokuljetusta.

**Etenemisjärjestys:** PR #28 valmis (merge commit b78ad75). PR #21:n owner-approved visuaalipaketti pusketaan päivitettynä, CI ajetaan ja yhdistetään vihreiden tarkistusten jälkeen. PR #25:n nyky-main-integraatio pusketaan olemassa olevaan haaraan ilman force-pushia, CI ajetaan ja yhdistetään vihreiden tarkistusten jälkeen. WebSocket/WebRTC-valinta pysyy auki.

### Työkokonaisuus A — PR #21: M1.5-VIS-01

**Tila:** omistaja hyväksyi PR #21:n VIS-01-visuaalisen suunnan ja antoi push-/merge-luvan. Paikallinen prototyyppi on testattu; uusi PR-headin CI on ajettava ennen mergeä. Tämä ei hyväksy koko M1.5-milestonea eikä tee 48×64-variantista oletusta.

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

**Nykyinen paikallinen näyttö:** PR #21: retro 13/1 ohitettu, expanded 12/2, classic 9/5, yksikkötestit 39/39, build läpi; Tester vahvisti F1/F2-korjaukset ja omistaja hyväksyi visuaalisen suunnan. PR #25 current-main-integraatio: protokollat 60/60, koko suite 92/92, build-varoitus, browser smoke 14/14, diff-check läpi; Tester PASS rajoituksin ja self-hitTargets-fix tarkistettu. Nämä ovat paikallisia tuloksia; uudet PR-head CI-ajot ovat vielä tarpeen.

### Riskit ja rajat

- Kuvakaappausten automaattinen syntyminen ei ole visuaalinen hyväksyntä; omistajan tulee katsoa lopulliset kuvat. Jos agentin käytössä ei ole kuvaa ymmärtävää mallia, tätä rajoitetta ei saa peittää.
- Lobby-overlay, P1:n suhde aseman kylttiin, mobiilin luettavuus ja neljän pelaajan samanaikainen luettavuus vaativat erillistä arviota.
- PR #21:n uudelleenkatselmointi voi vaatia uuden CI-ajon, vaikka aiempi head oli vihreä.

### Haara-, PR- ja päätösportti

Tee työ nykyisessä eristetyssä PR #21 -työpuussa. Omistaja on jo antanut push- ja merge-luvan tälle prototyypille; push/päivitä PR vasta kun diff on tarkistettu, ja mergeä vasta sen uusien pakollisten CI-tarkistusten vihreyden jälkeen. Älä merkitse M1.5-milestonea hyväksytyksi.

**Omistajan päätös:** hyväksyykö omistaja P1:n ja aseman visuaalisen suunnan, pyytääkö muutoksia vai pysäyttääkö jatkon? Vasta tämän päätöksen jälkeen voidaan suunnitella VIS-02–05. Tämä tavoite ei hyväksy M1.5-milestonea.

### Työkokonaisuus B — PR #25: M2:n siirtoriippumattoman protokollan ensimmäinen siivu

**Tavoite:** katselmoi versionoidut `InputFrame`-, `StateSnapshot`- ja `EventBatch`-sopimukset sekä rajatut input-/snapshot-bufferi- ja replay-apurit. Korjaa vain osoitetut virheet, dokumentoi rajat ja tuo draft omistajan katselmointiin. Protokollatyö ei valitse WebSocket- tai WebRTC-topologiaa.

**Nykytila:** GitHubin PR #25 on draft headilla 63fb566 ja vanhalla basella 7932aa; GitHub näyttää tilaksi CLEAN/MERGEABLE ja vanhan headin pakolliset tarkistukset ovat vihreät. Tämä ei kata paikallisia kovennuksia. Paikallinen integraatiohaara revision/m2-protocol-mainline perustuu mainiin b78ad75 ja sisältää korjatun protokollan sekä M2-dokumentin. Paikalliset tulokset: 60/60 protocol, 92/92 koko suite, build-varoitus, browser smoke 14/14 ja diff-check. Tester lopputarkistus PASS rajoituksin. Uuden PR-headin GitHub CI:tä ei ole ajettu. Omistaja hyväksyi finite-only z/vz + fail-closed -rajauksen tähän siivuun; fyysinen raja siirretään tulevaan Gameplay-tehtävään ennen authoritative online snapshot/restore -käyttöä.

- **Riippuvuudet:** hyväksytty M1-simulaation input/state/event-sopimus sekä nykyinen `docs/NETWORK_BENCHMARK_PLAN.md`; WebSocket/WebRTC-päätös pysyy avoimena.
- **Omistus ja tiedostot:** Gameplay omistaa `src/game/protocol/**`-koodin ja testit; Designer omistaa `docs/M2_INPUT_PROTOCOL.md`-sopimustekstin ja rajausten katselmoinnin; Tester tarkistaa regressiot itsenäisesti.
- **Hyväksyntä:** strict codec -testit hylkäävät väärän version, ylimääräiset kentät, duplikaattipelaajat, virheelliset tickit ja liian isot payloadit; bufferi/replay-testit osoittavat saman simulaatiotilan identtisillä syötteillä; `npm test`, build, browser smoke ja diff-check läpäisevät nykyisellä headilla. Dokumentaatio sanoo selvästi, ettei codec ole autentikointi, rollback, synkronointi tai kuljetusvalinta.
- **Rajauksen ulkopuolella:** WS/WebRTC-adapterit, session-authority, lobby, client prediction/rollback, salausturva ja gameplay-säännöt.
- **Riski:** PR on vanhalla basella ja snapshotin koko-/rosterirajat ovat nyt kiinteitä; arvioi niiden tarkoituksenmukaisuus ennen protokollan vakauttamista. Älä laajenna ilman omistajan hyväksyntää.
- **Haara/PR:** nykyinen integraatiopohja on revision/m2-protocol-mainline (origin/main b78ad75 + PR #25 -kovennus). Omistaja valtuutti pushin ja mergen; siirrä sisältö olemassa olevaan feature/m2-input-frame-contract-haaraan normaalina fast-forwardina, ilman force-pushia, aja tuore CI ja mergeä vasta vihreiden tarkistusten jälkeen.
- **Omistajan portti:** finite-only z/vz + fail-closed -rajaus on hyväksytty tähän M2-siivuun. Owner on valtuuttanut PR #25:n pushin ja mergen; lopullinen ehto on uuden PR-headin CI:n läpäisy. Fyysinen z/vz-raja jää erilliseksi Gameplay-tehtäväksi ennen authoritative online snapshot/restore -käyttöä.

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
