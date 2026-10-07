'use strict';
/** Who am I and what can I open: the module switcher and left menus come from here. Read-only. */
const express = require('express');
const { requireUser } = require('../lib/auth');
const L = require('../lib/permissions');
const P = require('../vendors/permissions');

const router = express.Router();

router.get('/me', requireUser, (req, res) => {
  const u = req.user;
  res.json({
    me: { ...u, can: { manageUsers: P.canManageUsers(u), editSettings: P.canEditSettings(u), overview: P.canSeeOverview(u), vendors: L.canUseModule(u, 'vendors') } },
    roles: L.ROLES.map((k) => ({ key: k, label: L.ROLE_LABELS[k] })),
    modules: L.modulesFor(u),
  });
});

router.get('/modules/:key', requireUser, (req, res, next) => L.requireModule(req.params.key)(req, res, next), (req, res) => {
  res.json(L.modulesFor(req.user).find((m) => m.key === req.params.key));
});

module.exports = { router };
