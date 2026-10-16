# POS Kasa — Posnet Server 6.1+

Gotowa aplikacja kasjerska HTML/CSS/JS.

## Uruchomienie

1. Skopiuj zawartość katalogu w miejsce gdzie jest zainstalowany PosnetServer, do podkatalogu `webapp`
2. Uruchom PosnetServer
3. Otwórz adres `http://localhost:3050`. Jeśli PosnetServer wykryje plik `index.html` w katalogu `webapp`, wyświetli w oknie przeglądarki zawartość aplikacji znajdującej się w tym katalogu. W przeciwnym razie wyświetli standardowy komunikat heartbeat zawierający informacje o licencji.
4. Kliknij ⚙ i ustaw parametry drukarki fiskalnej

## Produkty

Katalog demonstracyjny znajduje się w tablicy `PRODUCTS` w pliku `app.js`. Można go zastąpić katalogiem pobieranym z własnego API lub bazy danych (DB). Wszelkie zmiany w katalogu produktów są przechowywane w pamięci `Local Storage` przeglądarki, przypisanej do adresu `http://localhost:3050`.

## Terminal płatniczy

Aplikacja rejestruje płatność kartą w dokumencie fiskalnym. Nie steruje natomiast terminalem płatniczym. Funckjonalność ta może zostać dodana za pomocą IngenicoServer (https://bigdotsoftware.pl/ingenicoserver-restful-service-dla-terminali-platniczych/)

