# Stalowy Pojedynek

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

Gracz 2 musi mieć włączony NumLock. Klawisze można zmienić w **Ustawieniach** (zapis w localStorage). Jeśli jakaś kombinacja nie działa, winna jest zwykle klawiatura, która nie rejestruje wielu klawiszy naraz (ghosting).

Debug: **F1** hitboxy/hurtboxy, **F3** pauza w treningu, **F4** klatka po klatce, **F6** tabela frame data, **F7** tryb manekina, **Esc** pauza.

## Kombo

Powtarzanie przycisku w trakcie ataku płynnie przechodzi w kolejne ciosy:

- **HP, HP, HP** – zamach → zamach zwrotny → młot (przewraca); po zamachu zwrotnym **HK** = obrót 360°
- **LP, LP, LP** – dźgnięcie → podwójne dźgnięcie → taran z dźgnięciem; dalej **HP** = młot
- **LK, LK, LK** – wypad → szarpnięcie zwrotne → wjazd na rampę (wyrzut!); w trakcie **HP** = podbicie
- **HK, HK, HK** – cios z góry → podwójny młot → obrót 360°
- Po wyrzucie przeciwnika: **HP** / **LP** dalej żongluje nim w powietrzu

## Czołgi

| | MAMUT | GROM | OSA |
|---|---|---|---|
| Rola | ciężki | zbalansowany | lekki, 2 karabiny |
| Masa | 60 t | 35 t | 15 t |
| Zasięg lufy | 5,5 m | 4,0 m | 2,2 m |
| Wieża | 540°/s | 900°/s | 1500°/s |

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

## Wdrożenie na GitHub Pages

Repozytorium zawiera workflow `.github/workflows/pages.yml`. Po każdym pushu na `main` uruchamia testy, buduje grę i publikuje ją na Pages.

1. Na GitHubie: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Wypchnij zmiany na `main` (albo uruchom workflow ręcznie w zakładce **Actions**).
3. Gra będzie dostępna pod adresem `https://<użytkownik>.github.io/<repozytorium>/`.

Build używa `base: './'`, więc działa pod dowolną nazwą repozytorium.

Tryb online będzie wymagał serwera Node.js + WebSocket (Render / Railway / Fly.io). Instrukcja pojawi się razem z tym etapem.

## Status

Zobacz [DECISIONS.md](DECISIONS.md), gdzie opisano zakres obecnej wersji i decyzje projektowe.
