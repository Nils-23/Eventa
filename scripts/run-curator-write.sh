#!/bin/bash
# Runs the Firestore write for the latest curator JSON. Meant for launchd/cron on the Mac.
export PATH="/Users/nilsakonkwa/.nvm/versions/node/v22.14.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
REPO="$HOME/Desktop/Eventa_Ant"
JSON="$REPO/eventas_curator_events.json"
LOG="$REPO/curator-write.log"

cd "$REPO" || { echo "$(date): repo not found" >> "$LOG"; exit 1; }

# only run if the JSON was refreshed in the last 12 hours (avoids re-writing a stale file)
if [ ! -f "$JSON" ] || [ -z "$(find "$JSON" -mmin -720 2>/dev/null)" ]; then
  echo "$(date): no fresh JSON, skipping" >> "$LOG"
  exit 0
fi

echo "$(date): writing $JSON" >> "$LOG"
node scripts/curatorWriteProposals.js "$JSON" >> "$LOG" 2>&1
STATUS=$?

# archive the file so it isn't written again next run
if [ $STATUS -eq 0 ]; then
  mv "$JSON" "$REPO/eventas_curator_events.$(date +%Y%m%d).json"
  echo "$(date): done, archived" >> "$LOG"
else
  echo "$(date): script exited $STATUS" >> "$LOG"
fi
