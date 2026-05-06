#!/bin/bash
cd /home/z/my-project
export DATABASE_URL="postgresql://neondb_owner:npg_4bACo6SRhIFB@ep-odd-mud-ant4xs0i-pooler.c-6.us-east-1.aws.neon.tech/neondb"
export NODE_OPTIONS="--max-old-space-size=4096"
exec npx next dev -p 3000
