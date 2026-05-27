#!/bin/bash

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

echo $result > $OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/$DEVICEID.json
echo "DONE, results: $OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/$DEVICEID.json"

cat $OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/$DEVICEID.json | jq
