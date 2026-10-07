'use strict';
/**
 * Roles, modules and the rules shared across the back office (docs/feest-spec.md sections 2 and 3).
 * Checked on the server for every route; the browser only uses the same answers to hide things.
 * Vendor-specific rules (own vendors, areas) live in src/vendors/permissions.js.
 */
const ROLES = ['sales_rep', 'sales_lead', 'onboarding', 'installation', 'dispatcher', 'ops_lead', 'driver_support', 'finance', 'ceo', 'admin'];
const ROLE_LABELS = {
  sales_rep: 'Sales rep', sales_lead: 'Sales lead', onboarding: 'Onboarding', installation: 'Installation',
  dispatcher: 'Dispatcher', ops_lead: 'Ops lead', driver_support: 'Driver support',
  finance: 'Finance', ceo: 'CEO', admin: 'Admin',
};
const EXEC = ['ceo', 'admin'];

/** The modules in the top bar, in order, with their left menus and the roles that may open them. */
const MODULES = [
  { key: 'overview', label: 'Overview', roles: ['sales_lead', 'dispatcher', 'ops_lead', 'finance', ...EXEC],
    menu: [{ key: 'today', label: 'Today' }] },
  { key: 'vendors', label: 'Vendors', roles: ['sales_rep', 'sales_lead', 'onboarding', 'installation', 'finance', ...EXEC],
    menu: [{ key: 'dashboard', label: 'Dashboard' }, { key: 'new', label: 'Capture' }, { key: 'all', label: 'All vendors' }, { key: 'areas', label: 'Areas and reps' },
      { key: 'ready', label: 'Ready to sign' }, { key: 'signoff', label: 'Awaiting sign-off' }, { key: 'install', label: 'Installation' }, { key: 'live', label: 'Live' }, { key: 'notnow', label: 'Not now' }] },
  { key: 'operations', label: 'Operations', roles: ['dispatcher', 'ops_lead', 'finance', ...EXEC],
    menu: [{ key: 'live-map', label: 'Live map' }, { key: 'orders', label: 'Orders' }, { key: 'exceptions', label: 'Exceptions' }, { key: 'stacked-runs', label: 'Stacked runs' }] },
  { key: 'drivers', label: 'Drivers', roles: ['dispatcher', 'ops_lead', 'driver_support', 'finance', ...EXEC],
    menu: [{ key: 'opt-ins', label: 'Marketplace opt-ins' }, { key: 'onboarding', label: 'Onboarding' }, { key: 'active', label: 'Active drivers' }, { key: 'messages', label: 'Messages' }] },
  { key: 'pricing', label: 'Pricing', roles: ['ops_lead', 'finance', ...EXEC],
    menu: [{ key: 'zones', label: 'Zones' }, { key: 'rate-cards', label: 'Rate cards' }, { key: 'surge', label: 'Surge' }] },
  { key: 'payouts', label: 'Payouts', roles: ['finance', ...EXEC],
    menu: [{ key: 'this-week', label: 'This week' }, { key: 'runs', label: 'Payout runs' }, { key: 'ledger', label: 'Driver ledger' }, { key: 'keychat', label: 'Keychat reconciliation' }] },
  { key: 'metrics', label: 'Metrics', roles: ['dispatcher', 'ops_lead', 'finance', ...EXEC],
    menu: [{ key: 'segments', label: 'Segments' }, { key: 'by-store', label: 'By store' }, { key: 'by-area', label: 'By area' }, { key: 'by-driver', label: 'By driver' }, { key: 'ready-gate', label: 'Ready gate' }] },
  { key: 'integration', label: 'Integration', roles: ['ops_lead', 'finance', ...EXEC],
    menu: [{ key: 'keychat-events', label: 'Keychat events' }, { key: 'partner-keys', label: 'Partner keys' }] },
];

const LEDGER_SECOND_APPROVER_OVER = 500; // rand

const isActive = (user) => !!user && user.active === true && ROLES.includes(user.role);
const has = (user, roles) => isActive(user) && roles.includes(user.role);

const moduleByKey = (key) => MODULES.find((m) => m.key === key) || null;
function canUseModule(user, key) {
  const m = moduleByKey(key);
  return !!m && has(user, m.roles);
}
/** The modules this user sees, without the role lists. */
const modulesFor = (user) => MODULES.filter((m) => has(user, m.roles)).map(({ key, label, menu }) => ({ key, label, menu }));

/** Express middleware: refuse the request unless the user's role may open the module. Needs req.user. */
const requireModule = (key) => (req, res, next) => {
  if (canUseModule(req.user, key)) return next();
  const m = moduleByKey(key);
  res.status(403).json({ error: `Your role can't open ${m ? m.label : 'this module'}. Ask an admin if you need it.` });
};

// Operations and drivers
const canDispatch = (user) => has(user, ['dispatcher', 'ops_lead', ...EXEC]);
const canSupportDrivers = (user) => has(user, ['driver_support', 'ops_lead', ...EXEC]);
const canDecideOnboarding = (user) => has(user, ['ops_lead', ...EXEC]);
const canSuspendDriver = (user) => has(user, ['ops_lead', ...EXEC]);

// Pricing: ops lead previews and saves; finance only looks.
const canPreviewPricing = (user) => has(user, ['ops_lead', ...EXEC]);
const canSavePricing = (user) => has(user, ['ops_lead', ...EXEC]);

// Payouts: two people. Whoever prepared a run can't approve it; approval is Finance or CEO.
const canPreparePayout = (user) => has(user, ['finance', ...EXEC]);
/** run: { prepared_by } */
function canApprovePayout(user, run) {
  if (!has(user, ['finance', 'ceo'])) return false;
  if (!run || !run.prepared_by) return false;
  return run.prepared_by !== user.id;
}

// Driver ledger: manual credits or debits need a reason; over R500 a second person approves.
const canAdjustLedger = (user) => has(user, ['finance', ...EXEC]);
const needsSecondApprover = (amount) => Math.abs(Number(amount) || 0) > LEDGER_SECOND_APPROVER_OVER;
/** entry: { amount, created_by } */
function canApproveLedger(user, entry) {
  if (!canAdjustLedger(user) || !entry || !entry.created_by) return false;
  return entry.created_by !== user.id;
}

module.exports = {
  ROLES, ROLE_LABELS, MODULES, LEDGER_SECOND_APPROVER_OVER,
  isActive, canUseModule, modulesFor, requireModule,
  canDispatch, canSupportDrivers, canDecideOnboarding, canSuspendDriver,
  canPreviewPricing, canSavePricing,
  canPreparePayout, canApprovePayout,
  canAdjustLedger, needsSecondApprover, canApproveLedger,
};
