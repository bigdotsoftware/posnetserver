#!/bin/bash

# --- configuration
POSNETSERVERHOST='http://localhost:3050'
YESTERDAY=`date -d "yesterday" '+%Y-%m-%d'`
TODAY=`date -d "today" '+%Y-%m-%d'`
REPORT_FROM="2020-01-01"
FULLDEBUG="true"    #true/false
CACHE_TYPE="full"
OUTPUT_DIRECTORY="/tmp"
PRETTY_HOSTNAME=$(hostname -f)
DEVICEID=""


# get device ID (request compatible with version >= 4.4; when using older version, comment below request and set DEVICEID manually in this script)
result=`curl -s -XGET "$POSNETSERVERHOST/deviceid?fulldebug=$FULLDEBUG" -H "Content-type: application/json"
ok=`echo $result|jq -r '.ok'`
if [ "$ok" == "true" ]; then
    DEVICEID=`echo $result|jq -r '.device.id'`
else
    echo "Error: Cannot read unique device ID"
    exit 1
fi

# --- check if cache exists
result=`curl -s -XGET "$POSNETSERVERHOST/cache/ranges?fulldebug=$FULLDEBUG" -H "Content-type: application/json"`
ok=`echo $result|jq -r '.ok'`

if [ "$ok" == "true" ]; then
    # --- check if existing cache type match to requested type
    cache_type=`echo $result|jq -r '.cache.type'`
    cache_dateFrom=`echo $result|jq -r '.cache.dateFrom'`
    iso_dateFrom=`date -d @$cache_dateFrom '+%Y-%m-%d'`
    if [ "$cache_type" == "$CACHE_TYPE" ]; then
        # --- cache exists, expand it
        echo "Expanding cache from $iso_dateFrom"
        result=`curl -s -XPOST "$POSNETSERVERHOST/cache/update?fulldebug=$FULLDEBUG" -H "Content-type: application/json" -d "
        {
            \"dateFrom\":\"${iso_dateFrom}T00:00:00+02:00\",
            \"dateTo\":\"${TODAY}T23:59:59+02:00\"
        }"`
        ok=`echo $result|jq -r '.ok'`
        
        echo $result
    else
        echo "Error: Cannot extend cache, cache types are different"
        exit 1
    fi
else
    # --- cache doesn't exist, build it
    # --- build cache from yesterday till today
    echo "Building cache from $YESTERDAY"
    result=`curl -s -XPOST "$POSNETSERVERHOST/cache/build?fulldebug=$FULLDEBUG" -H "Content-type: application/json" -d "
    {
       \"dateFrom\":\"${YESTERDAY}T00:00:00+02:00\",
       \"dateTo\":\"${TODAY}T23:59:59+02:00\",
       \"cacheType\" : \"$CACHE_TYPE\"
    }"`
    ok=`echo $result|jq -r '.ok'`
    echo $result
fi

# --- when build/update succeeded, wait for task to be finished
if [ "$ok" == "true" ]; then

    task=`echo $result|jq -r '.task'`
    processing="true"
    while [ "$processing" == "true" ]; do
        sleep 1
        echo "Checking task $task"
        result=`curl -s -XGET "$POSNETSERVERHOST/tasks/get/$task?fulldebug=$FULLDEBUG" -H "Content-type: application/json"`
        processing=`echo $result|jq -r '.hits.task.inprogress'`
        echo $result
    done

else

    echo "Error: Cannot build/update existing cache"
    echo $result
    exit 1
fi

# --- use existing cache to list all daily reports
mkdir -p $OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/ 2>/dev/null

curl -s -XPOST "$POSNETSERVERHOST/raporty/events/dobowy?fulldebug=$FULLDEBUG" -H "Content-type: application/json" -d "
{
  \"dateFrom\": \"${REPORT_FROM}T00:00:00+02:00\",
  \"mergeSections\": true,
  \"useCache\": true
}" > $OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/$DEVICEID.json

echo "DONE, results: $OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/$DEVICEID.json"
