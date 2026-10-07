#!/usr/bin/env node
'use strict';
// Creates (or resets the password of) a back-office login. Use it once for the first admin.
//   DATABASE_URL=... node scripts/create-user.js --name "Wahlied Cole" --email wahlied@scoothero.co.za --role ceo
// Prints a random password unless --password is given.
const crypto = require('crypto');
const { Client } = require('pg');
const { hashPassword, passwordProblem } = require('../src/lib/auth');
const { ROLES } = require('../src/vendors/permissions');

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
(async () => {
  const name = arg('name'), email = (arg('email') || '').toLowerCase(), role = arg('role') || 'admin';
  let password = arg('password');
  if (!name || !email) throw new Error('Usage: create-user.js --name "Full Name" --email you@example.com [--role ceo|admin|sales_lead|sales_rep|dispatcher|ops_lead|driver_support|...] [--password ...]');
  if (!ROLES.includes(role)) throw new Error(`Role must be one of: ${ROLES.join(', ')}`);
  const generated = !password;
  if (generated) password = crypto.randomBytes(9).toString('base64url');
  const p = passwordProblem(password); if (p) throw new Error(p);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const hash = await hashPassword(password);
    const r = await db.query(`INSERT INTO users (name, email, role, password_hash) VALUES ($1,$2,$3,$4)
      ON CONFLICT (email) WHERE email IS NOT NULL DO UPDATE SET name=$1, role=$3, password_hash=$4, active=true, failed_logins=0, locked_until=NULL, updated_at=now()
      RETURNING id, (xmax = 0) AS created`, [name, email, role, hash]);
    await db.query(`INSERT INTO audit_log (action, entity, entity_id, after) VALUES ('user.cli', 'user', $1, $2)`, [r.rows[0].id, JSON.stringify({ email, role })]);
    console.log(`${r.rows[0].created ? 'Created' : 'Updated'} ${email} (${role}).${generated ? ` Password: ${password}` : ''}`);
  } finally { await db.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
