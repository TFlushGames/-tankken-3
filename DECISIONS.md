# Decyzje projektowe

Miejsca, w których specyfikacja zostawiała wybór, i co wybrano.

## Zakres pierwszej wersji
- Zrealizowano grywalny trzon: kamienie milowe 1–3 i większość 4 (menu, wybór czołgu, rundy, HUD, K.O., dźwięk, ustawienia z rebindem, trening z frame data).
- **Gra online (etap 5) nie jest jeszcze zrobiona**. Symulacja jest od początku deterministyczna i ma snapshot/restore oraz hash, więc rollback da się dołożyć bez przebudowy. GitHub Pages hostuje tylko pliki statyczne, więc serwer WebSocket trafi na Render/Railway/Fly.io.
- Druga arena (zimowy poligon) jest dostępna w wyborze czołgu (Tab).

## Tempo i kombo (wersja 2)
- Na prośbę o większą dynamikę prędkości jazdy, maks. prędkości wieży/lufy i przyspieszenia zostały podniesione względem tabeli startowej (MAMUT jest nadal najwolniejszy, OSA najszybsza – proporcje zachowane). `ACCEL_SCALE = 3`, `HOLD_SCALE = 0.5`, grawitacja 30 mm/kl² (krótsze, ostrzejsze skoki).
- **Łańcuchy kombo**: każdy ruch może mieć `chains` – ten sam (lub inny) przycisk wciśnięty w trakcie ataku jest buforowany i od pierwszej aktywnej fazy ruch przechodzi w kolejny. Wieża zachowuje pęd, więc np. zamach zwrotny startuje z końca poprzedniego zamachu. Łańcuch działa także po pudle – „walenie w przycisk” zawsze daje płynną sekwencję.
- Ruchy `chainOnly` są dostępne tylko jako kontynuacje.
- **Wyrzut**: podbicie i „wjazd na rampę” wyrzucają wysoko (lżejszy czołg leci wyżej) i do tyłu; trafienie w powietrzu podbija ponownie (malejąco) i mocniej odrzuca; mocny upadek daje jedno odbicie od ziemi.
- **Przechyły**: ataki mają mocniejsze uniesienie/opuszczenie przodu kadłuba (pancerny zrzut nurkuje nosem ~28°). Pochylenie w locie i salto po wyrzucie liczy renderer z prędkości i stanu – nie wpływa na symulację.
- **Lufa**: oś elewacji (czopy) jest z przodu wieży, a lufa wysuwa się teleskopowo z kołyski przymocowanej do jarzma – w symulacji i w modelu, więc lufa nigdy nie odstaje od wieży.

## Grafika (wersja 2)
- Styl komiksowy inspirowany ogólnie „szalonymi” grami akcji: cieniowanie toon (4 progi), czarne kontury metodą odwróconej skorupy z wygładzonymi normalnymi, nasycone kolory z akcentami, gwiazdy uderzeń, napisy komiksowe, smugi ciosów, błysk ekranu i „kopnięcie” FOV przy mocnych trafieniach. Żadne zasoby ani projekty innych gier nie są kopiowane.

## Symulacja
- Jednostki: 1 = 1 mm, kąty w setnych stopnia (36000 = pełny obrót), sin/cos z tablicy skalowanej przez 16384, atan2 z tablicy 1024 kroków.
- Tablice trygonometryczne są generowane przy starcie przez `Math.sin`/`Math.atan` i **zaokrąglane do liczb całkowitych**. Różnice ostatniego bitu między przeglądarkami nie przeżywają zaokrąglenia, więc wynik jest identyczny. Liczby zmiennoprzecinkowe występują tylko w `src/sim/params.ts` przy kompilacji danych i też są zaokrąglane.
- Stan jest mutowany w miejscu (`step` zwraca ten sam obiekt) – szybciej, a do rollbacku i tak służy `snapshot()` (structuredClone).
- Zdarzenia kosmetyczne (`state.events`) są częścią stanu tylko na jedną klatkę. Renderer i dźwięk deduplikują je kluczem (klatka, typ, aktor, pozycja), więc po resymulacji nic nie zagra dwa razy.

## Fizyka wieży i ruchów
- Każdy napęd (obrót wieży, elewacja, wysunięcie lufy, uniesienie kadłuba, piwot) ma limit prędkości i przyspieszenia z danych czołgu.
- Klatka kluczowa kończy się, gdy napędy osiągną cel. W fazie aktywnej napęd działa w trybie **slam**: nie hamuje przed celem, przelatuje przez niego, a wytracanie pędu tworzy recovery.
- Pole `hold` (minimalny czas fazy) jest skalowane przez √(masa/35 t), czyli tak samo jak czas ruchu napędów. Dlatego frame data wynikają z masy i osiągów, a nie z ręcznego mnożnika (ciężki ≈1,3×, lekki ≈0,65× startupu GROM-a).
- Przyspieszenie „mięśni” kadłuba jest ∝ 1/masa (ta sama siła napędu).
- `ACCEL_SCALE = 1.0`: przyspieszenia wieży wzięte wprost z tabeli specyfikacji. Stała zostaje jako pokrętło do strojenia.
- Obrót 360° ma aktywny hitbox przez cały obrót (to „młyn” – łapie uniki z każdej strony), więc faza aktywna jest dłuższa niż 8 klatek z tabeli.
- Obrażenia: baza × mnożnik czołgu × (80–120% zależnie od prędkości końca lufy/kadłuba względem maksimum czołgu). W kombo obrażenia maleją o 15% za trafienie (min. 40%).

## Bloki i poziomy ataków
- Blok stojący: high, mid, overhead. Blok w kucki: low, mid.
- Ataki high nie trafiają kucającego (zasada) – dodatkowo wynika to z geometrii, bo kadłub się obniża.
- Wysokie ciosy lufą mają lekko ujemną elewację, żeby lufa trafiała w kadłub zamiast przelatywać nad pokładem przed wieżą.

## Rzut
- Przód + LP **z bliska** = rzut. Z daleka to samo wejście daje zwykłe dźgnięcie (jak w klasycznych bijatykach).
- Okno ucieczki (6 klatek) zaczyna się w chwili złapania. Odległość rzutu ∝ 1/masa rzucanego.

## Przeskok
- Gdy skaczący ląduje na przeciwniku i leci w jego stronę, a jego środek minął połowę zachodzenia kadłubów, jest przerzucany na drugą stronę.

## Kamera i strony
- Oś walki = wektor między zawodnikami. Symulacja trzyma `camRight` (kierunek „prawo ekranu”) i wybiera ten z dwóch zwrotów osi, który jest bliżej poprzedniego – dzięki temu przeskok zmienia stronę zawodników, a nie obraca kamery o 180°.
- „Przód/tył” są przeliczane względem tej osi (kto jest po lewej na ekranie, ten patrzy w prawo).

## Wejście
- Klawisz wciśnięty i puszczony między dwoma krokami symulacji jest „zatrzaskiwany” na jeden krok, żeby krótkie stuknięcia nie ginęły.

## Grafika
- `PCFSoftShadowMap` usunięto w three r18x, używany jest `PCFShadowMap`.
- Ślady gąsienic malowane są na teksturze canvas nałożonej na arenę.
- Odłamki (fartuchy, wieża przy K.O.) i decale trafień są czysto kosmetyczne.
