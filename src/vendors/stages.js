'use strict';
/**
 * Vendor stage: derived from what has happened, never typed in.
 * captured → ready (toolkit done) → signoff (agreement signed) → install (owner signed off) → live
 * notnow when closed. Routes call stageFor() after every action and store the result.
 */
const STAGES = [
  { key: 'captured', label: 'Captured',          hint: 'Visited, details saved' },
  { key: 'ready',    label: 'Ready to sign',     hint: 'Toolkit done, agreement next' },
  { key: 'signoff',  label: 'Awaiting sign-off', hint: 'Signed on screen, pack emailed' },
  { key: 'install',  label: 'Installation',      hint: 'Signed off, setting up' },
  { key: 'live',     label: 'Live',              hint: 'Taking orders' },
  { key: 'notnow',   label: 'Not now',           hint: 'Closed, revisit later' },
];

/** facts: {closedAt, liveAt, signedOffOn, hasAgreement, toolkitCompletedAt} */
function stageFor(f) {
  if (f.closedAt) return 'notnow';
  if (f.liveAt) return 'live';
  if (f.signedOffOn) return 'install';
  if (f.hasAgreement) return 'signoff';
  if (f.toolkitCompletedAt) return 'ready';
  return 'captured';
}

/** Which steps of the vendor record can be opened. */
function stepsOpen(f) {
  return {
    details: true,
    services: true,
    toolkit: !!f.model,
    agreement: !!f.toolkitCompletedAt,
    pack: !!f.hasAgreement,
    install: !!f.signedOffOn,
  };
}

module.exports = { STAGES, stageFor, stepsOpen };
