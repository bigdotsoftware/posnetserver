#!/bin/bash
set -e
#shopt -s expand_aliases

if ! [ -x "$(command -v jq)" ]; then
   echo 'Error: jq is not installed.' >&2
   exit 1
fi 

LOGS_DIR=$1 

if [ -z "$LOGS_DIR" ]; then
   echo "-------------------------------------------------------"
   echo "Sample usage: "
   echo "./logs_analyzer.sh /opt/posnetserver/logs" 
   echo "-------------------------------------------------------"
   exit
fi

STAT_FAKTURA_BEGIN=0
STAT_FAKTURA_OK=0
STAT_FAKTURY_BEGIN=0
STAT_FAKTURY_OK=0

STAT_PARAGON_BEGIN=0
STAT_PARAGON_OK=0
STAT_PARAGONY_BEGIN=0
STAT_PARAGONY_OK=0

STAT_CMDS_BEGIN=0
STAT_CMDS_OK=0


STAT_PA_DETAILS=()
STAT_FV_DETAILS=()
STAT_CMDS_DETAILS=()
STAT_ERROR_DETAILS=()

TOTAL_FILES=`ls $LOGS_DIR/*.log | wc -l`
IDX=1

shopt -s lastpipe
for filename in $LOGS_DIR/*.log; do
   echo "..... Procsssing $IDX/$TOTAL_FILES ( $(echo "$filename") )"
   
   firstline=`head -n 1 $filename`
   
   # check if first line is a JSON, otherwise, skip this file
   if jq -e . >/dev/null 2>&1 <<<"$firstline"; then

      shopt -s lastpipe      
      #-a to force --text mode (avoid extra text: Binary file <filename>.log matches)
      grep -a \
           -e 'Drukowanie faktury start' -e 'Drukowanie faktury OK' -e 'POST /faktura' \
           -e 'Drukowanie faktur start' -e 'Drukowanie faktur OK' \
           -e 'Drukowanie paragonu start' -e 'Drukowanie paragonu OK' -e 'POST /paragon' \
           -e 'Drukowanie paragonow start' -e 'Drukowanie paragonow OK' \
           -e 'Wysylanie polecenia start' -e 'Wysylanie polecenia OK' -e '  -> sending' \
           -e 'error' -e 'took' \
           $filename | while IFS= read -r line
      do
         #echo "-------------- $line"
         #start=`date +%s.%N`
         message=`echo "$line" | jq -r 'select(.message|type=="string") | .message'`
         #echo " ---- message = '$message'"
         if [[ $message == "Drukowanie"* || $message == "Wysylanie"* || $message == "POST"* || $message == "  -> sending"* ]]; then
            if [[ $message == "Drukowanie paragonu start" ]]; then
               ((STAT_PARAGON_BEGIN+=1))
               STAT_PA_DETAILS+=("$line")
            elif [[ $message == "POST /paragon"* ]]; then
               STAT_PA_DETAILS+=("$line")
            elif [[ $message == "Drukowanie paragonu OK"* ]]; then
               STAT_PARAGON_OK=$((STAT_PARAGON_OK+1))
               STAT_PA_DETAILS+=("$line")
               
            elif [[ $message == "Drukowanie faktury start" ]]; then
               ((STAT_FAKTURA_BEGIN+=1))
               STAT_FV_DETAILS+=("$line")
            elif [[ $message == "POST /faktura"* ]]; then
               STAT_FV_DETAILS+=("$line")
            elif [[ $message == "Drukowanie faktury OK"* ]]; then
               STAT_FAKTURA_OK=$((STAT_FAKTURA_OK+1))
               STAT_FV_DETAILS+=("$line")
               
            elif [[ $message == "Drukowanie paragonow start" ]]; then
               ((STAT_PARAGONY_BEGIN+=1))
               STAT_PA_DETAILS+=("$line")
            elif [[ $message == "Drukowanie paragonow OK"* ]]; then
               STAT_PARAGONY_OK=$((STAT_PARAGONY_OK+1))
               STAT_PA_DETAILS+=("$line")
               
            elif [[ $message == "Drukowanie faktur start" ]]; then
               ((STAT_FAKTURY_BEGIN+=1))
               STAT_FV_DETAILS+=("$line")
            elif [[ $message == "Drukowanie faktur OK"* ]]; then
               STAT_FAKTURY_OK=$((STAT_FAKTURY_OK+1))
               STAT_FV_DETAILS+=("$line")
               
            elif [[ $message == "Wysylanie polecenia start" ]]; then
               ((STAT_CMDS_BEGIN+=1))
               STAT_CMDS_DETAILS+=("$line")
            elif [[ $message == "  -> sending"* ]]; then
               STAT_CMDS_DETAILS+=("$line")
            elif [[ $message == "Wysylanie polecenia OK"* ]]; then
               if [[ $message == *"\"ok\":true"* ]]; then
                  ((STAT_CMDS_OK+=1))
               fi
               STAT_CMDS_DETAILS+=("$line")
               
            fi
            
         #elif [ `echo $line | jq '(has("bn")) and (has("hn"))'` == "true" ]; then
         #   STAT_PA_DETAILS+=("$line")
         #elif [ `echo $line | jq '(has("fn")) and (has("hn"))'` == "true" ]; then
         #   STAT_FV_DETAILS+=("$line")
         #elif [ `echo $line | jq '(has("ok")) and (.level == "error")'` == "true" ]; then
         #   STAT_ERROR_DETAILS+=("$line")
         elif [ `echo $line | jq '(.level == "error")'` == "true" ]; then
            STAT_ERROR_DETAILS+=("$line")
         fi
         #end=`date +%s.%N`
         #runtime=$(python -c "print(${end} - ${start})")
         #echo "--- file took: $runtime"
         #echo "."
      done
      
   fi
   #echo $filename
   IDX=$((IDX+1))
done

echo "-------------------------------------------"
echo "                 SUMMARY                   "
echo "-------------------------------------------"
echo "paragon: $STAT_PARAGON_BEGIN (success: $STAT_PARAGON_OK)"
echo "paragony: $STAT_PARAGONY_BEGIN (success: $STAT_PARAGONY_OK)"
echo "faktura: $STAT_FAKTURA_BEGIN (success: $STAT_FAKTURA_OK)"
echo "faktury: $STAT_FAKTURY_BEGIN (success: $STAT_FAKTURY_OK)"
echo "commands: $STAT_CMDS_BEGIN (success: $STAT_CMDS_OK)"
echo "-------------------------------------------"
echo "                 PARAGON                   "
echo "-------------------------------------------"
for value in "${STAT_PA_DETAILS[@]}"; do
     echo $value
done
echo "-------------------------------------------"
echo "                 FAKTURA                   "
echo "-------------------------------------------"
for value in "${STAT_FV_DETAILS[@]}"; do
     echo $value
done
echo "-------------------------------------------"
echo "                 COMMANDS                   "
echo "-------------------------------------------"
for value in "${STAT_CMDS_DETAILS[@]}"; do
     echo $value
done
echo "-------------------------------------------"
echo "                 ERRORS                    "
echo "-------------------------------------------"
for value in "${STAT_ERROR_DETAILS[@]}"; do
     echo $value
done
echo "-------------------------------------------"

#jq '.result.property_history | select(.) | map(select(.event_name == "Sold"))[0:1][].date'
#echo '{"message":"Drukowanie faktury start","level":"info","timestamp":"2021-03-23T09:08:14.412Z"}' | jq '(.message|type=="string") and (has("message"))'
#echo '{"message":"Drukowanie faktury start","level":"info","timestamp":"2021-03-23T09:08:14.412Z"}' | jq '.message == "Drukowanie faktury start"'
#echo '{"message":"Drukowanie faktury start","level":"info","timestamp":"2021-03-23T09:08:14.412Z"}' | jq '.message | startswith("Drukowanie")'
#echo '{"message":"Drukowanie paragonu start","level":"info","timestamp":"2021-05-12T10:09:03.602Z"}' | jq '(.message|type=="string") and (.message == "Drukowanie paragonu start")'
#echo '{"message":"Drukowanie paragonu start","level":"info","timestamp":"2021-05-12T10:09:03.602Z"}' | jq '(.message|type=="string") and (.message | startswith("Drukowanie"))'
#echo '{"message":"Wysylanie polecenia OK:","level":"info","timestamp":"2021-11-15T09:17:10.962Z"}' | jq 'select(.message|type=="string") | .message'
#echo '{"message":"","level":"info","timestamp":"2021-09-06T22:00:13.531Z"}' | jq -e . >/dev/null 2>&1