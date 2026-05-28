#!/bin/bash

# Note: This script is intended to be run on a daily basis, e.g. via cron, to automate the process of generating 
#       daily reports from the POSNET server. It retrieves the device ID, generates a daily report for the current 
#       day, and then reads fiscal memory events starting from yesterday. The results are saved in JSON format, 
#       and if jq is available, also converted to CSV for easier analysis.

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
POSNETSERVERHOST='http://localhost:3050'
# POSNETSERVERHOST='http://192.168.0.201/api/posnetserver'
YESTERDAY=`date -d "yesterday" '+%Y-%m-%d'`
TODAY=`date -d "today" '+%Y-%m-%d'`
FULLDEBUG="true"    #true/false

OUTPUT_DIRECTORY="/tmp"
PRETTY_HOSTNAME=$(hostname -f)
DEVICEID=""

### Create output directory
mkdir -p $OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/ 2>/dev/null

### Get device ID (request compatible with version >= 4.4; when using older version, comment below request and set DEVICEID manually in this script)
result=`curl -s -XGET "$POSNETSERVERHOST/deviceid?fulldebug=$FULLDEBUG" -H "Content-type: application/json"`
echo $result
ok=`echo $result|jq -r '.ok'`
if [ "$ok" == "true" ]; then
    DEVICEID=`echo $result|jq -r '.device.id'`
else
    echo "Error: Cannot read unique device ID"
    exit 1
fi

### Print daily report for today
curl -XPOST "$POSNETSERVERHOST/raporty/dobowy?fulldebug=true" -H "Content-type: application/json" -d "{
    \"da\": \"$TODAY\"
}"

### Start reading fiscal memory since yesterday, with merging sections and without using cache
result=`curl -s -XPOST "$POSNETSERVERHOST/raporty/events/dobowy?fulldebug=$FULLDEBUG" -H "Content-type: application/json" -d "
{
  \"dateFrom\": \"${YESTERDAY}T00:00:00+02:00\",
  \"mergeSections\": true,
  \"useCache\": false
}"`
# result=`curl -s -XPOST "$POSNETSERVERHOST/raporty/fiscalmemory?fulldebug=$FULLDEBUG" -H "Content-type: application/json" -d "
# {
#   \"dateFrom\": \"${YESTERDAY}T00:00:00+02:00\",
#   \"dateTo\": \"${YESTERDAY}T23:59:59+02:00\",
#   \"saveResults\": \"/tmp/sellhistory.json\",
#   \"dumpContent\": \"/tmp/\"
# }"`

### Wait for task to be finished
if [ "$ok" == "true" ]; then

    task=`echo $result | jq -r '.task'`
    processing="true"
    while [ "$processing" == "true" ]; do
        sleep 1
        echo "Checking task $task"
        result=`curl -s -XGET "$POSNETSERVERHOST/tasks/get/$task?fulldebug=$FULLDEBUG" -H "Content-type: application/json"`
        processing=`echo $result|jq -r '.hits.task.inprogress'`
        echo $result
    done

else
    echo "Error: Cannot read fiscal memory events"
    echo $result
    exit 1
fi

JSON_FILE="$OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/$DEVICEID.json"
CSV_FILE="$OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/$DEVICEID.csv"

echo "$result" > "$JSON_FILE"
echo "DONE, results: $JSON_FILE"

### Convert JSON to CSV (if jq is available). Skip keys ending with _65 or _112, as values 
### are coming from additional headers and footers, and are not relevant for the report.
if command -v jq >/dev/null 2>&1; then
  jq -r '
    [ .hits.task.result.results[] | .sections[0] ] as $rows
    | ($rows | map(keys) | add | unique | sort | map(select(test("(_65|_112)$") | not))) as $keys
    | ($keys | @csv),
      ($rows[] | [ .[ $keys[] ] ] | @csv)
  ' "$JSON_FILE" > "$CSV_FILE"
  echo "CSV generated: $CSV_FILE"
else
  echo "Warning: jq is required to generate CSV; install jq and rerun to create $CSV_FILE"
fi

cat "$JSON_FILE" | jq
