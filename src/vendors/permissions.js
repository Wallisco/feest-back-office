'use strict';
/**
 * Who can do what. Checked on the server for every route; the browser only uses
 * the same answers to hide buttons.
 */
const ROLES = ['sales_rep', 'sales_lead', 'onboarding', 'installation', 'finance', 'ceo', 'admin'];
const ROLE_LABELS = {
  sales_rep: 'Sales rep', sales_lead: 'Sales lead', onboarding: 'Onboarding', installation: 'Installation',
  finance: 'Finance', ceo: 'CEO', admin: 'Admin',
};
const MANAGERS = ['sales_lead', 'ceo', 'admin'];

/** areaRepIds: user ids allocated to the vendor's area. */
function canSell(user, vendor, areaRepIds) {
  if (!user || !user.active) return false;
  if (MANAGERS.includes(user.role)) return true;
  if (user.role !== 'sales_rep') return false;
  if (!vendor) return true; // capturing a new vendor
  return vendor.rep_id === user.id || (areaRepIds || []).includes(user.id);
}

/** Installation checklist, quantities and go-live. */
function canInstall(user, vendor, areaRepIds) {
  if (!user || !user.active) return false;
  if (['onboarding', 'installation'].includes(user.role)) return true;
  return canSell(user, vendor, areaRepIds);
}

/** The signing rep must be the logged-in person; managers may sign for FEEST too. */
const canSignForFeest = (user, vendor, areaRepIds) => canSell(user, vendor, areaRepIds);

const canManageAreas = (user) => !!user && user.active && MANAGERS.includes(user.role);
const canManageUsers = (user) => !!user && user.active && ['ceo', 'admin'].includes(user.role);
const canEditSettings = (user) => !!user && user.active && ['ceo', 'admin'].includes(user.role);
const canView = (user) => !!user && user.active && ROLES.includes(user.role);

module.exports = { ROLES, ROLE_LABELS, MANAGERS, canSell, canInstall, canSignForFeest, canManageAreas, canManageUsers, canEditSettings, canView };
