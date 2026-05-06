#!/usr/bin/env node
// ARB//RADAR V3.3.1 — Server starter with process detachment
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const LOG_FILE = path.join(__dirname, 'dev.log');
const PID_FILE = path.join(__dirname, '.next-dev.pid');

// Kill existing process if any
try {
  const oldPid = fs.readFileSync(PID_FILE, 'utf8').trim();
  if (oldPid) {
    try { process.kill(parseInt(oldPid), 'SIGTERM'); } catch(e) {}
    try { process.kill(parseInt(oldPid) + 1, 'SIGTERM'); } catch(e) {}
  }
} catch(e) {}

const env = { ...process.env };
env.DATABASE_URL = 'postgresql://neondb_owner:npg_4bACo6SRhIFB@ep-odd-mud-ant4xs0i-pooler.c-6.us-east-1.aws.neon.tech/neondb';
env.NODE_OPTIONS = '--max-old-space-size=3072';

const logStream = fs.openSync(LOG_FILE, 'w');

const child = spawn('node', [path.join(__dirname, 'node_modules/.bin/next'), 'dev', '-p', '3000'], {
  cwd: __dirname,
  env,
  detached: true,
  stdio: ['ignore', logStream, logStream]
});

child.unref();

fs.writeFileSync(PID_FILE, child.pid.toString());
console.log(`ARB//RADAR V3.3.1 — Server started (PID: ${child.pid})`);
console.log(`Log: tail -f ${LOG_FILE}`);
