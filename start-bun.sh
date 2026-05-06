#!/bin/bash
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=2048"
# Use bun to run next dev
exec bun x next dev -p 3000 2>&1
