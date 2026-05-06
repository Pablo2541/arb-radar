#!/bin/bash
# ARB RADAR Daemon - Auto-restarts Next.js on crash
LOG=/tmp/radar-daemon.log
while true; do
  cd /home/z/my-project
  export NODE_OPTIONS="--max-old-space-size=2048"
  echo "[$(date)] Starting server..." >> $LOG
  npx next dev -p 3000 >> $LOG 2>&1
  EXIT=$?
  echo "[$(date)] Server exited with code $EXIT" >> $LOG
  sleep 2
done
