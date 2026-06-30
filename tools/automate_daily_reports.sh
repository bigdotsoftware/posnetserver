#!/bin/bash

# Note: This script is intended to be run on a daily basis, e.g. via cron, to automate the process of generating 
#       daily reports from the POSNET server. It retrieves the device ID, generates a daily report for the current 
#       day, and then reads fiscal memory events starting from yesterday. The results are saved in JSON format, 
#       and if jq is available, also converted to CSV for easier analysis.

# --- USAGE HELP ---
usage() {
    cat << EOF
Użycie: $(basename "$0") [opcje]

Opcje:
  -t, --type TYPE              Typ raportu: 'dobowy' lub 'miesieczny' (domyślnie: dobowy)
  -s, --start-date YYYY-MM-DD  Data początkowa dla raportu miesięcznego (wymagane dla typu miesieczny)
  -e, --end-date YYYY-MM-DD    Data końcowa dla raportu miesięcznego (wymagane dla typu miesieczny)
  -d, --detailed               Raport szczegółowy dla raportu miesięcznego (domyślnie: podsumowanie)
  -p, --print                  Drukuj raport na drukarce (domyślnie: tylko dane bez drukowania)
  -h, --help                   Pokaż tę wiadomość pomocy

Przykłady:
  # Raport dobowy, bez drukowania
  $(basename "$0")

  # Raport dobowy z wydrukiem
  $(basename "$0") -p

  # Raport miesięczny szczegółowy od 2026-01-01 do 2026-01-31 z wydrukiem
  $(basename "$0") -t miesieczny -s 2026-01-01 -e 2026-01-31 -d -p

  # Raport miesięczny podsumowanie (bez rozbicia na raporty dobowe)
  $(basename "$0") -t miesieczny -s 2026-01-01 -e 2026-01-31

EOF
    exit 0
}

# --- ARGUMENT PARSING ---
REPORT_TYPE="dobowy"
PRINT_REPORT="false"
DETAILED_REPORT="false"
START_DATE=""
END_DATE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--type)
            REPORT_TYPE="$2"
            shift 2
            ;;
        -s|--start-date)
            START_DATE="$2"
            shift 2
            ;;
        -e|--end-date)
            END_DATE="$2"
            shift 2
            ;;
        -d|--detailed)
            DETAILED_REPORT="true"
            shift
            ;;
        -p|--print)
            PRINT_REPORT="true"
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Błąd: nieznana opcja '$1'"
            echo "Użyj: $(basename "$0") -h do wyświetlenia pomocy"
            exit 1
            ;;
    esac
done

# --- VALIDATION ---
if [ "$REPORT_TYPE" != "dobowy" ] && [ "$REPORT_TYPE" != "miesieczny" ]; then
    echo "Błąd: typ raportu musi być 'dobowy' lub 'miesieczny'"
    exit 1
fi

if [ "$REPORT_TYPE" == "miesieczny" ]; then
    if [ -z "$START_DATE" ] || [ -z "$END_DATE" ]; then
        echo "Błąd: dla raportu miesięcznego wymagane są opcje -s i -e"
        exit 1
    fi
    
    # Validate date format (YYYY-MM-DD)
    if ! [[ $START_DATE =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        echo "Błąd: nieprawidłowy format daty początkowej, wymagany format: YYYY-MM-DD"
        exit 1
    fi
    if ! [[ $END_DATE =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        echo "Błąd: nieprawidłowy format daty końcowej, wymagany format: YYYY-MM-DD"
        exit 1
    fi
fi

### Create output directory
mkdir -p $OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/ 2>/dev/null

# Uwaga: Wydrukowane raporty dobowe zawierają pozycje "SPRZEDAŻ OPODATKOWANA PTU A", "SPRZEDAŻ OPODATKOWANA PTU B" itd., 
# które są sumą sprzedaży opodatkowanej odpowiednią stawką PTU, ale są to kwoty netto. Dalej na typowym wydruku
# znajduje się pozycja: "KWOTA PTU A", "KWOTA PTU B" itd., które zawierają wartość kwoty podatku dla konkretnej stawki. 
# Aby obliczyć kwotę brutto, należy dodać kwotę netto do kwoty podatku w odpowidniej stawce. Na przykład, 
# jeśli "SPRZEDAŻ OPODATKOWANA PTU A" wynosi 100 PLN, a "KWOTA PTU A" wynosi 23 PLN, to kwota brutto dla tej pozycji 
# wynosi 123 PLN. 
# Drukarka w pamięci chroninej przechowuje jedynie kwoty brutto, więc poniższy skrypt, dla powyższego przyładu zwróci 
# jedynie wartość 123 PLN. Aby obliczyć kwotę netto lub wartość podatku, należy to przeliczyć ręcznie, 
# np 123 PLN/1.23 = 100 PLN (kwota netto), 123 PLN - 100 PLN = 23 PLN (kwota podatku).

# --- configuration
# POSNETSERVERHOST='http://localhost:3050'
POSNETSERVERHOST='http://192.168.0.103/api/posnetserver'

# --- DETERMINE DATES ---
if [ "$REPORT_TYPE" == "dobowy" ]; then
    YESTERDAY=`date -d "yesterday" '+%Y-%m-%d'`
    TODAY=`date -d "today" '+%Y-%m-%d'`
    REPORT_DATE="$TODAY"
    DATE_FROM="${YESTERDAY}T00:00:00+02:00"
    DATE_TO="${YESTERDAY}T23:59:59+02:00"
    REPORT_NAME="raport_dobowy_$TODAY"
else
    # Monthly report
    REPORT_DATE="${START_DATE}_do_${END_DATE}"
    DATE_FROM="${START_DATE}T00:00:00+02:00"
    DATE_TO="${END_DATE}T23:59:59+02:00"
    REPORT_NAME="raport_miesieczny_${REPORT_DATE}"
fi

FULLDEBUG="true"    #true/false

OUTPUT_DIRECTORY="/tmp"
PRETTY_HOSTNAME=$(hostname -f)
DEVICEID=""

echo "=========================================="
echo "POSNET Raport - Typ: $REPORT_TYPE"
echo "Data raportu: $REPORT_DATE"
echo "Drukowanie: $PRINT_REPORT"
if [ "$REPORT_TYPE" == "miesieczny" ]; then
    echo "Szczegółowy: $DETAILED_REPORT"
fi
echo "=========================================="



### Get device ID (request compatible with version >= 4.4; when using older version, comment below request and set DEVICEID manually in this script)
result=`curl -s -XGET "$POSNETSERVERHOST/deviceid?fulldebug=$FULLDEBUG" -H "Content-type: application/json"`
echo "Device ID Response: $result"
ok=`echo $result|jq -r '.ok'`
if [ "$ok" != "true" ]; then
    echo "Error: Cannot read unique device ID"
    exit 1
fi
DEVICEID=`echo $result|jq -r '.device.id'`
echo "Device ID: $DEVICEID"

### Print report if requested
if [ "$PRINT_REPORT" == "true" ]; then
    echo ""
    echo "Drukowanie raportu $REPORT_TYPE..."
    if [ "$REPORT_TYPE" == "dobowy" ]; then
        curl -XPOST "$POSNETSERVERHOST/raporty/dobowy?fulldebug=true" -H "Content-type: application/json" -d "{
            \"da\": \"$START_DATE\"
        }"
    else
        # Monthly report printing
        PRINT_PARAMS="{
            \"da\": \"$START_DATE\""
        
        if [ "$DETAILED_REPORT" == "true" ]; then
            PRINT_PARAMS="$PRINT_PARAMS,
            \"su\": false"
        else
            PRINT_PARAMS="$PRINT_PARAMS,
            \"su\": true"
        fi
        
        PRINT_PARAMS="$PRINT_PARAMS
        }"
        
        curl -XPOST "$POSNETSERVERHOST/raporty/miesieczny?fulldebug=true" -H "Content-type: application/json" -d "$PRINT_PARAMS"
    fi
    echo ""
fi

### Extract data from fiscal memory
echo ""
echo "Pobieranie danych z pamięci fiskalnej..."


### Start reading fiscal memory
if [ "$REPORT_TYPE" == "dobowy" ]; then
    # Daily report - read from yesterday
    result=`curl -s -XPOST "$POSNETSERVERHOST/raporty/events/dobowy?fulldebug=$FULLDEBUG" -H "Content-type: application/json" -d "
    {
      \"dateFrom\": \"$DATE_FROM\",
      \"mergeSections\": true,
      \"useCache\": false
    }"`
else
    # Monthly report - read from specified date range
    # DETAILED_FLAG="false"
    # if [ "$DETAILED_REPORT" == "true" ]; then
    #     DETAILED_FLAG="true"
    # fi
    
    result=`curl -s -XPOST "$POSNETSERVERHOST/raporty/events/dobowy?fulldebug=$FULLDEBUG" -H "Content-type: application/json" -d "
    {
      \"dateFrom\": \"$DATE_FROM\",
      \"dateTo\": \"$DATE_TO\",
      \"mergeSections\": true,
      \"useCache\": false
    }"`
fi

### Wait for task to be finished
if [ "$ok" == "true" ]; then

    task=`echo $result | jq -r '.task'`
    if [ -z "$task" ] || [ "$task" == "null" ]; then
        echo "Błąd: nie otrzymano identyfikatora zadania"
        echo "Response: $result"
        exit 1
    fi
    
    processing="true"
    counter=0
    while [ "$processing" == "true" ]; do
        sleep 1
        counter=$((counter + 1))
        echo "[$counter] checking task $task..."
        result=`curl -s -XGET "$POSNETSERVERHOST/tasks/get/$task?fulldebug=$FULLDEBUG" -H "Content-type: application/json"`
        processing=`echo $result|jq -r '.hits.task.inprogress'`
        
        # Check for errors
        task_status=`echo $result|jq -r '.hits.task.status'`
        if [ "$task_status" == "error" ]; then
            echo "Błąd: zadanie zakończyło się błędem"
            echo $result
            exit 1
        fi
    done
    echo "Zadanie ukończone"
    echo $result

else
    echo "Error: Cannot read fiscal memory events"
    echo $result
    exit 1
fi

JSON_FILE="$OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/${REPORT_NAME}_$DEVICEID.json"
JSON_FILE_AGG="$OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/${REPORT_NAME}_aggregated_$DEVICEID.json"
CSV_FILE="$OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/${REPORT_NAME}_$DEVICEID.csv"
CSV_FILE_AGG="$OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/${REPORT_NAME}_aggregated_$DEVICEID.csv"

echo "$result" > "$JSON_FILE"
echo ""
echo "✓ DONE, results saved:"
echo "  JSON: $JSON_FILE"


### Convert JSON to CSV (if jq is available). Skip keys ending with _65 or _112, as values 
### are coming from additional headers and footers, and are not relevant for the report.
if command -v jq >/dev/null 2>&1; then
  jq -r '
    [ .hits.task.result.results[] | .sections[0] ] as $rows
    | ($rows | map(keys) | add | unique | sort | map(select(test("(_65|_112)$") | not))) as $keys
    | ($keys | @csv),
      ($rows[] | [ .[ $keys[] ] ] | @csv)
  ' "$JSON_FILE" > "$CSV_FILE"
  echo "  CSV: $CSV_FILE"
else
  echo "  Uwaga: jq wymagane do wygenerowania CSV; zainstaluj jq aby uzyskać $CSV_FILE"
fi



if command -v jq >/dev/null 2>&1; then
jq '
.hits.task.result.results
| map(.sections)
| add
| reduce .[] as $item ({}; 

    (
      $item
      | with_entries(
          select(
            (.key | test("date|ts"; "i") | not)
            and
            (.value|type != "number")
          )
        )
      | tostring
    ) as $key

    |

    .[$key] =
      if has($key) then
        reduce ($item|to_entries[]) as $e (.[$key];
          if ($e.key | test("date|ts"; "i")) then
            .
          elif ($e.value|type) == "number" then
            .[$e.key] += $e.value
          else
            .
          end
        )
      else
        $item
      end
)
| to_entries
| map(.value)
' "$JSON_FILE" > "$JSON_FILE_AGG"

jq -r '
  . as $rows
  | ($rows | map(keys) | add | unique | sort | map(select(test("(_65|_112)$") | not))) as $keys
  | ($keys | @csv),
    ($rows[] | [ $keys[] as $k | .[$k] ] | @csv)
' "$JSON_FILE_AGG" > "$CSV_FILE_AGG"
  echo "  CSV: $CSV_FILE_AGG"

else
  echo "  Uwaga: jq wymagane do wygenerowania CSV; zainstaluj jq aby uzyskać $CSV_FILE"
fi

echo ""
echo "=========================================="
echo "Raport JSON:"
echo "=========================================="
cat "$JSON_FILE" | jq

