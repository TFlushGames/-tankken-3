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

## Wersja 4
- Nazwa gry: **Tankken 3**; wszystkie teksty w grze po angielsku (nazwy czołgów: MAMMOTH, THUNDER, WASP, COBRA). Dokumentacja i komentarze w kodzie zostają po polsku.
- **Online**: zamiast własnego serwera Node (wymagałby konta na hostingu) – WebRTC P2P przez PeerJS z darmowym publicznym serwerem sygnalizacyjnym; dzięki temu gra online działa na GitHub Pages. Netcode od razu jako rollback (etap „lockstep” pominięty – rollback go zastępuje). Wejścia wysyłane z redundancją i potwierdzeniem (`ack`), więc po krótkim zerwaniu brakujące klatki są dosyłane.
- **Muzyka**: biblioteki z darmowymi dźwiękami nie są osiągalne z tego środowiska (dostępny tylko rejestr npm), więc muzyka jest syntezowana sekwencerem (osobne utwory do menu i walki). Opcjonalne pliki w `public/audio/` mają pierwszeństwo.
- **Ciężar ciosów**: kadłub skręca i odchyla się na zamachu, pochyla przy uderzeniu; mocne ciosy (≥70 obrażeń) na moment odrywają gąsienice od ziemi; trafiony czołg podskakuje i przechyla się do tyłu (amortyzacja). Zatrzymanie przy trafieniu i wstrząs kamery rosną z masą atakującego; wybrzmienie ruchów skaluje się bezwładnością.
- Renderer nie używa już sprężyn (przy nierównym FPS „galaretowały”) – tylko tłumienie wykładnicze z ograniczonym krokiem czasu.

## Wersja 3: „ninja w pancerzu”
- Trafienie **nie zależy od wysokości** sylwetki: gdy obaj stoją na ziemi, hitbox jest rzutowany na wysokość przeciwnika (decyduje zasięg i poziom ciosu, jak w bijatykach). Lufa dodatkowo automatycznie celuje w środek sylwetki przeciwnika.
- Kadłub ma w symulacji pełny przewrót przód–tył (`bodyPitch`) – hurtboxy i hitboxy obracają się razem z nim, więc salta i stójki na lufie trafiają tam, gdzie widać.
- Tyczka: w fazie z `plant` koniec lufy jest punktem stałym, a pozycja czołgu wynika z obrotu wokół niego. Po puszczeniu prędkość jest ograniczana, żeby czołg nie wystrzelił w kosmos.
- Skok o lufie jest naprowadzany (`leap`): prędkość pozioma wyliczana tak, by wylądować przy przeciwniku; kończy go fala uderzeniowa.
- Doskok (podwójne stuknięcie), doskok w powietrzu (RUN + kierunek), podwójny skok z saltem; doskok można przerwać atakiem od 5. klatki.
- KOBRA (niszczyciel bez wieży): działo ma tylko ±15° obrotu; zamachy z kluczy `yaw` są zamieniane na obrót całego kadłuba na gąsienicach.
- Limity czasu faz skalują się bezwładnością (ciężkie czołgi nie ucinają zamachów).

## Grafika (wersja 3)
- Styl stylizowanego low-poly w wieczornym świetle (inspiracja ogólna z przesłanych obrazków, bez kopiowania): złota łąka z falującą trawą (instancje + shader wiatru, przygniatanie przez czołgi i ślady gąsienic) oraz wyspa z animowaną wodą; puchate obłoczki kurzu, winieta.
- Modele czołgów budowane z „przekrojów” (`loft`) – skośne płyty, pochylone burty, różne wieże: kanciasta (ciężki), kopułowa (średni), oscylacyjna z koszem (lekki), kazamata (niszczyciel). Różne zawieszenia: koła zachodzące, duże Christie, małe z rolkami.

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
