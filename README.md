# Tankken 3

Przeglądarkowa bijatyka 1 na 1, w której walczą czołgi. Lufa służy za ręce i miecz, kadłub i gąsienice za nogi. Grafika 3D (three.js), wszystkie modele, tekstury i dźwięki są generowane z kodu. Gra nie używa żadnych zewnętrznych plików.

## Szybki start

```bash
npm install
npm run dev        # serwer deweloperski: http://localhost:5173
npm test           # testy determinizmu, frame data i rozgrywki
npm run build      # build produkcyjny do dist/
npm run preview    # podgląd buildu
```

## Sterowanie (domyślne)

| Akcja | Gracz 1 | Gracz 2 |
|---|---|---|
| Ruch / skok / kucanie | W A S D | Strzałki |
| High punch (HP) | T | Num 7 |
| Low punch (LP) | G | Num 4 |
| Bieg (RUN) + przód | H | Num 5 |
| Low kick (LK) | J | Num 6 |
| High kick (HK) | U | Num 9 |
| Blok | Spacja | Num 0 |
| Unik w głąb | B | Num 1 |
| Unik do kamery | M | Num 3 |

**Ruchy specjalne (dla obu graczy):** podwójne stuknięcie przód/tył – doskok; skok w powietrzu – podwójny skok z saltem; RUN + kierunek w powietrzu – doskok w powietrzu.

**Akrobatyka (RUN + przycisk):** RUN+HK – skok o lufie (salto i lądowanie na przeciwniku), RUN+HP – młynek na lufie, RUN+LK – wybicie wystrzałem w ziemię, RUN+LP – szarża; w powietrzu RUN+HP/LP – strzał w locie z odrzutem.

Gracz 2 musi mieć włączony NumLock. Klawisze można zmienić w **Ustawieniach** (zapis w localStorage). Jeśli jakaś kombinacja nie działa, winna jest zwykle klawiatura, która nie rejestruje wielu klawiszy naraz (ghosting).

Debug: **F1** hitboxy/hurtboxy, **F3** pauza w treningu, **F4** klatka po klatce, **F6** tabela frame data, **F7** tryb manekina, **Esc** pauza.

## Ataki specjalne (jak w MK4: kierunki po kolei + przycisk)

F = przód (do przeciwnika), B = tył, D = dół. Kierunki stukamy po kolei, potem przycisk. Lista z klawiszami jest w trybie treningu.

| Czołg | Ruch | Wejście |
|---|---|---|
| WASP | Sky Ambush – wyskok poza arenę i powrót zza pleców | D, B + HP |
| WASP | Hook Shot – harpun przyciągający przeciwnika | B, F + LP |
| WASP | Sting Rush – wślizg z 3 trafieniami | D, F + LK |
| THUNDER | Cannon Shell – pocisk (da się przykucnąć) | B, F + HP |
| THUNDER | Rising Smash – nietykalne podbicie przeciwlotnicze | D, F + HP |
| THUNDER | Ground Wave – fala po ziemi (przeskocz albo blok dolny) | D, B + LK |
| MAMMOTH | Big Bertha – wolny, ogromny pocisk | B, F + HP |
| MAMMOTH | Earthquake – trzęsienie ziemi dookoła | D, D + HK |
| MAMMOTH | Bulldozer – długi taran przez arenę | B, F + LK |
| COBRA | Railgun – ładowany, błyskawiczny strzał | B, F + HP |
| COBRA | Drill Spin – obrót kadłubem z 3 trafieniami | D, F + HK |
| COBRA | Ambush Slide – niski wślizg przewracający | D, B + LK |

Pociski są obiektami symulacji: można je zablokować, przeskoczyć, ominąć unikiem, a dwa pociski znoszą się nawzajem.

## Kombo

Powtarzanie przycisku w trakcie ataku płynnie przechodzi w kolejne ciosy:

- **HP, HP, HP** – zamach → zamach zwrotny → młot (przewraca); po zamachu zwrotnym **HK** = obrót 360°
- **LP, LP, LP** – dźgnięcie → podwójne dźgnięcie → taran z dźgnięciem; dalej **HP** = młot
- **LK, LK, LK** – wypad → szarpnięcie zwrotne → wjazd na rampę (wyrzut!); w trakcie **HP** = podbicie
- **HK, HK, HK** – cios z góry → podwójny młot → obrót 360°
- Po wyrzucie przeciwnika: **HP** / **LP** dalej żongluje nim w powietrzu

## Czołgi

| | MAMUT | GROM | OSA | KOBRA |
|---|---|---|---|---|
| Wzór | ciężki, kanciasta wieża | średni, kopułowa wieża | lekki, wieża z tyłu, 2 lufy | niszczyciel bez wieży |
| Masa | 60 t | 35 t | 15 t | 45 t |
| Zasięg lufy | 5,5 m | 4,0 m | 2,2 m | 4,8 m |

## Architektura

```
src/sim     deterministyczna symulacja 60 Hz (czysty TS, liczby całkowite, bez DOM/three.js)
src/data    statystyki czołgów i lista ruchów – tu się stroi grę
src/render  three.js: modele proceduralne, areny, cząsteczki, kamera, interpolacja
src/game    pętla, ekrany, HUD, wejście z klawiatury
src/audio   proceduralny dźwięk WebAudio
tests       testy (vitest)
```

- `step(state, inputP1, inputP2)` przesuwa grę o jedną klatkę. Wejście to bitmaska (4 kierunki + 8 przycisków).
- `snapshot()`, `restore()` i `hashState()` w `src/sim/snapshot.ts` to fundament pod rollback online.
- Renderer tylko czyta stan i interpoluje między klatkami.

## Jak dodać nowy ruch

1. Dopisz obiekt do `MOVES` w `src/data/moves.ts`:
   ```ts
   {
     id: 'nowy', name: 'Nowy cios', desc: '…',
     input: { sequence: ['D', 'B'], button: 'HP', window: 12 }, // dół, tył, HP
     stance: ['stand'], level: 'mid', kind: 'rotational', source: 'barrel',
     damage: 90, hitstun: 20, blockstun: 12, knockback: 4, hitstop: 7, recoveryPad: 6,
     keys: [
       { yaw: 40, pitch: -5, hold: 6 },             // zamach (napędy hamują przed celem)
       { yaw: -20, pitch: -5, ext: 1, active: true }, // faza aktywna (slam – przelatuje przez cel)
     ],
   }
   ```
2. Ruchy z dłuższą sekwencją umieść **wyżej** na liście (pierwsze dopasowanie wygrywa).
3. Uruchom trening (Menu → Trening). Panel pokaże wyliczone frame data. Strojenie polega na zmianie klatek kluczowych i parametrów czołgu.
4. Ruch tylko dla jednego czołgu: `moveOverrides` w `src/data/tanks.ts`.

Bufor wejść trzyma 60 ostatnich klatek z kierunkami przeliczonymi na przód/tył, więc kombosy i ciosy specjalne z sekwencji są już obsługiwane przez `sequenceMatches()`.

## Gra online

Menu → **Online** → **Create room** daje kod i link (`…/?room=KOD`). Drugi gracz otwiera link (albo wpisuje kod) i obaj trafiają do lobby: wybór czołgu, **Ready**, walka. Rewanż odbywa się w tym samym pokoju. Każdy gracz steruje klawiszami gracza 1.

- Połączenie jest bezpośrednie (WebRTC P2P). Do zestawienia połączenia używany jest darmowy publiczny serwer PeerJS, więc nie trzeba stawiać własnego serwera, a gra działa na GitHub Pages.
- Netcode: rollback w stylu GGPO (opóźnienie wejścia 2 klatki, maks. cofanie 8 klatek, wstrzymanie przy większym lagu, synchronizacja tempa, porównanie hasha stanu co 30 klatek). **F2** pokazuje statystyki sieci.
- Symulacja słabego łącza: `?lag=120&jitter=30&loss=5`.
- Własny serwer PeerJS (opcjonalnie): `?peerhost=host&peerport=443&peerpath=/&peersecure=1`.
- W niektórych sieciach (część firmowych i komórkowych) samo P2P się nie zestawi – wtedy potrzebny byłby serwer TURN.

## Muzyka i dźwięk

Muzyka i efekty są generowane na żywo (WebAudio). Jeśli w `public/audio/` pojawią się pliki `music-menu.mp3` / `music-fight.mp3` (np. darmowe utwory CC0), gra użyje ich zamiast syntezy.

## Wdrożenie na GitHub Pages

Repozytorium zawiera workflow `.github/workflows/pages.yml`. Po każdym pushu na `main` uruchamia testy, buduje grę i publikuje ją na Pages.

1. Na GitHubie: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Wypchnij zmiany na `main` (albo uruchom workflow ręcznie w zakładce **Actions**).
3. Gra będzie dostępna pod adresem `https://<użytkownik>.github.io/<repozytorium>/`.

Build używa `base: './'`, więc działa pod dowolną nazwą repozytorium.

Tryb online będzie wymagał serwera Node.js + WebSocket (Render / Railway / Fly.io). Instrukcja pojawi się razem z tym etapem.

## Status

Zobacz [DECISIONS.md](DECISIONS.md), gdzie opisano zakres obecnej wersji i decyzje projektowe.
