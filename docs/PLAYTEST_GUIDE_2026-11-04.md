# Playtest guide 2026-11-04

Tämä on omistajan playtestin muistilista. Tavoite ei ole löytää koodivikoja vaan päättää, miltä peli tuntuu ja mitä
seuraavaksi rakennetaan. Jokainen kohta päättyy kysymykseen, johon riittää lyhyt vastaus.

## Käynnistys

```powershell
npm ci
npm run dev
```

Avaa selaimessa `http://127.0.0.1:5173`.

- **Retro-tyyli:** käynnistä retro-buildilla `$env:VITE_VISUAL_STYLE='retro'; npm run dev` (Windows PowerShell).
- **Ravintola Mesku:** lisää osoitteeseen `?arena=mesku`.
- **Tuotantobuildin testaus:** `npm run build; npm run preview`.

## Perusasiat, jotka pitää tietää ennen pelaamista

| Toiminto | Näppäin / tapa |
| --- | --- |
| Botin lisääminen vapaaseen slottiin | `B` tai slotin oma BOT-painike |
| Botin poistaminen | `V` tai slotin REMOVE-painike |
| Matsin aloitus | `Enter` (tai pad Start) |
| Uusintamatsi tuloksista | `Enter` |
| RESET (palaa lobbyyn, rosteri ja muoto säilyvät) | `Esc` tai RESET-painike |
| RESET lobbyissa (tyhjentää botit, jättää P1:n) | `Esc` tai RESET-painike |
| ALL BOTS -matsi (kaikki 8 botin ohjaamana) | `O` tai ALL BOTS -painike |
| Pelimuoto | MODE-valikko HUDissa |
| P1 liike / lyönti / potku / hyppy | WASD / F / G / H |

## 1. Kolme pelimuotoa

Pelaa jokainen muoto vähintään yksi kokonainen erä (botteja vastaan riittää).

**Score Brawl (oletus).** Pisteet kertyvät osumista ja KO:ista; KO antaa +500 ja KO:n kokenut menettää 200, joten
negatiivinen pistemäärä on tarkoituksellinen.

- Kysymys: tuntuuko pistelasku reilulta ja ymmärrätkö tuloksesta, miksi hävisit tai voitit?

**Deathmatch.** Fragit ratkaisevat, 20 fragin raja tai aika.

- Kysymys: onko frag-raja oikealla tasolla, vai loppuuko erä liian aikaisin tai myöhään?

**Last Man Standing.** Yksi elämä, viimeinen elossa oleva voittaa.

- Kysymys: onko yhden elämän muoto liian ankara botteja vastaan, ja kestääkö erä sopivasti?

**Tasapeli.** Jos kaikki on tasan, matsi päättyy tasapeliin eikä keksittyyn voittajaan. Tämä on päätetty sääntö.

## 2. Kahdeksan pelaajaa

1. Lisää botit slotteihin P2–P8 (`B` kuusi kertaa).
2. Aloita `Enter`illä ja pelaa erä.
3. Katso erityisesti: **erotatko ruuhkasta, kuka on kuka, kuka on KO:ssa ja ketä juuri lyötiin?**

Viimeksi todettu raja: KO-hahmolla on nyt pelaajatunnus ja osumapalautteessa on yksi täysi frame kuudesta, mutta
tiivis kahdeksan hahmon rypäs ei silti ole täysin luettava.

- Kysymys: onko kahdeksan pelaajan erä hauskaa ja riittävän luettavaa, vai pitäisikö käytännön maksimin laskea
  kuuteen tai neljään?

## 3. ALL BOTS -matsi (uusi)

Paina lobbyssä `O` tai ALL BOTS -painiketta. Kaikki kahdeksan slottia täyttyvät boteilla, P1 mukaan lukien, ja matsi
alkaa itsestään. RESET palauttaa ihmis-P1:n.

- Kysymys: onko tämä hyödyllinen testaus- ja katselutila, ja pitäisikö sen näkyä vielä selvemmin (esim. "spectator"
  -tila, joka piilottaa P1:n näppäinohjeet)?

## 4. Tulossivu ja voitonjuhla

Pelaa erä loppuun ja katso tulossivu.

- Voittajan nimi isolla pelaajan värillä, 2. ja 3. sija mittareineen, 4.–8. sija tiiviinä rivinä.
- Tasapeli näytetään `DRAW`-tekstinä.
- Mikä tahansa näppäin tai klikkaus ohittaa paljastuksen; RESET ja Esc toimivat myös paljastuksen aikana.
- 640×360:llä paneeli jättää 65 % areenasta näkyviin.

- Kysymys: onko juhla sopivan mittainen ja näyttävä, ja jääkö jokin tieto puuttumaan?

## 5. Äänet

Voittoääni soi podium-paljastuksen alkaessa; `match-end` soi samaan aikaan hetken.

- Kysymys: kuulostaako voittoääni hyvältä ja erottuuko se, vai meneekö päällekkäisyys sotkuiseksi? Tarvitaanko
  duckaus tai viive? Tarvitaanko oikeat samplet nyt vai myöhemmin?

## 6. Verkkopeli (vapaaehtoinen, vaatii kaksi selainta)

```powershell
npm run serve:match -- --rematch
```

Avaa `http://127.0.0.1:5173/online.html` kahdessa selainikkunassa (tai kahdella koneella LANissa). Pelatkaa erä
loppuun: tuloskortti näyttää voittajan, syyn ja sijoitukset, ja REMATCH käynnistää uuden matsin ilman latausta.

- Kysymys: toimiiko rematch käytännössä, ja onko tuloskortti yhtä selkeä kuin paikallinen?

## 7. Mitä ei tarvitse testata nyt

- Yli kahdeksan pelaajaa — uusi päätös ja mittaus.
- Verkkopelin turvallisuus (TLS, auth, rate limit) — ei kuulu tähän vaiheeseen.
- Oikeat äänisamplet ja miksaus — odottaa kuuntelupäätöstä.
- Kahdeksan pelaajan verkkopeli — vaatii kahden koneen mittauksen.

## Raportointi

Lyhyt vastaus riittää, esimerkiksi:

1. Score Brawl: pitää / ei pidä, miksi
2. Deathmatch: frag-raja kohdallaan / liian pieni / liian suuri
3. Last Man Standing: kesto ja ankaruus
4. Kahdeksan pelaajaa: luettava / ei, ja pitääkö maksimia laskea
5. ALL BOTS: hyödyllinen / turha, ja tarvitseeko se oman tilan
6. Tulossivu: selkeä / puuttuu jotain
7. Äänet: hyvä / sotkuinen / samplet myöhemmin

Näiden perusteella päivitän `docs/GOALS.md`-tavoitetilan ja avaan seuraavan työpaketin. Mikään milestone ei ole
hyväksytty ennen kuin sanot sen erikseen.
