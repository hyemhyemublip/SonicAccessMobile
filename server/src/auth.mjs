/**
 * Bearer-token auth. Three roles, each backed by an env token:
 *   admin  -> ADMIN_TOKEN   (registrar / provisioning)
 *   node   -> NODE_TOKEN    (gate nodes)
 *   read   -> READ_TOKEN    (dashboards)
 *
 * A role whose token is unset is refused (fail closed). `requireRole(...roles)`
 * accepts a request whose bearer matches ANY of the listed roles.
 */

import { timingSafeEqual } from 'node:crypto';

const TOKENS = {
  admin: process.env.ADMIN_TOKEN || '',
  node: process.env.NODE_TOKEN || '',
  read: process.env.READ_TOKEN || '',
};

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function bearer(req) {
  const h = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

/** Which configured roles does this request's token satisfy? */
export function rolesFor(req) {
  const t = bearer(req);
  if (!t) return [];
  return Object.entries(TOKENS)
    .filter(([, val]) => val && safeEqual(t, val))
    .map(([role]) => role);
}

export function requireRole(...allowed) {
  return (req, res, next) => {
    const unconfigured = allowed.filter((r) => !TOKENS[r]);
    if (unconfigured.length === allowed.length) {
      return res.status(503).json({
        error: `no token configured for role(s): ${allowed.join(', ')}`,
      });
    }
    const have = rolesFor(req);
    if (allowed.some((r) => have.includes(r))) {
      req.authRoles = have;
      return next();
    }
    return res.status(401).json({ error: 'invalid or missing bearer token' });
  };
}

export const tokenRolesConfigured = () =>
  Object.entries(TOKENS)
    .filter(([, v]) => v)
    .map(([r]) => r);
