'use strict';
/** Every write goes through here: who, what, when, before and after. */
async function audit(client, { actorId, action, entity, entityId, before = null, after = null, ip = null }) {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, before, after, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actorId || null, action, entity, entityId || null, before ? JSON.stringify(strip(before)) : null, after ? JSON.stringify(strip(after)) : null, ip || null]
  );
}

// Keep secrets and signature images out of the log.
function strip(o) {
  if (!o || typeof o !== 'object') return o;
  const out = Array.isArray(o) ? [] : {};
  for (const [k, v] of Object.entries(o)) {
    if (/password|sig$|signature|dataUrl/i.test(k)) continue;
    out[k] = v && typeof v === 'object' && !(v instanceof Date) ? strip(v) : v;
  }
  return out;
}

module.exports = { audit };
