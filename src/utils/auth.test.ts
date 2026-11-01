import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIMARY_ADMIN_EMAIL,
  createInitialACL,
  evaluateUserAccess,
  requestUserAccess,
  authorizeUserByAdmin,
  revokeUserByAdmin,
  removeUserRecordByAdmin,
  mergeACLRecords
} from './auth';

test('primary administrator (giuseppe.vitiello@gmail.com) is authorized as ADMIN by default', () => {
  assert.equal(PRIMARY_ADMIN_EMAIL, 'giuseppe.vitiello@gmail.com');
  const acl = createInitialACL();
  const res = evaluateUserAccess('giuseppe.vitiello@gmail.com', acl);
  assert.equal(res.isAuthorized, true);
  assert.equal(res.isAdmin, true);
  assert.equal(res.status, 'AUTHORIZED');
  assert.equal(res.record?.role, 'ADMIN');
});

test('other Gmail users are blocked by default until authorized by admin', () => {
  const acl = createInitialACL();
  const res = evaluateUserAccess('mario.rossi@gmail.com', acl);
  assert.equal(res.isAuthorized, false);
  assert.equal(res.isAdmin, false);
  assert.equal(res.status, 'UNREGISTERED');
});

test('user access request sets status to PENDING and approved user always enters as USER (never ADMIN)', () => {
  let acl = createInitialACL();
  acl = requestUserAccess(acl, {
    email: 'mario.rossi@gmail.com',
    name: 'Mario Rossi',
    note: 'Richiedo accesso al generatore'
  });

  const pendingCheck = evaluateUserAccess('mario.rossi@gmail.com', acl);
  assert.equal(pendingCheck.isAuthorized, false);
  assert.equal(pendingCheck.isAdmin, false);
  assert.equal(pendingCheck.status, 'PENDING');
  assert.equal(pendingCheck.record?.name, 'Mario Rossi');

  // Now admin approves Mario Rossi (even if role option is passed, non-admin always gets USER)
  acl = authorizeUserByAdmin(acl, PRIMARY_ADMIN_EMAIL, 'mario.rossi@gmail.com', {
    role: 'ADMIN'
  });
  const approvedCheck = evaluateUserAccess('mario.rossi@gmail.com', acl);
  assert.equal(approvedCheck.isAuthorized, true);
  assert.equal(approvedCheck.isAdmin, false);
  assert.equal(approvedCheck.status, 'AUTHORIZED');
  assert.equal(approvedCheck.record?.role, 'USER');
  assert.equal(approvedCheck.record?.authorizedBy, 'Amministratore');
});

test('non-admin cannot authorize or revoke users', () => {
  const acl = createInitialACL();
  assert.throws(() => {
    authorizeUserByAdmin(acl, 'hacker@gmail.com', 'friend@gmail.com');
  }, /amministratore/);
});

test('admin can pre-authorize and later revoke a user, but cannot revoke primary admin', () => {
  let acl = createInitialACL();
  acl = authorizeUserByAdmin(acl, PRIMARY_ADMIN_EMAIL, 'luca.bianchi@gmail.com', {
    name: 'Luca Bianchi'
  });
  const lucaCheck = evaluateUserAccess('luca.bianchi@gmail.com', acl);
  assert.equal(lucaCheck.isAuthorized, true);
  assert.equal(lucaCheck.isAdmin, false);
  assert.equal(lucaCheck.record?.role, 'USER');

  acl = revokeUserByAdmin(acl, PRIMARY_ADMIN_EMAIL, 'luca.bianchi@gmail.com');
  const revoked = evaluateUserAccess('luca.bianchi@gmail.com', acl);
  assert.equal(revoked.isAuthorized, false);
  assert.equal(revoked.status, 'REJECTED');

  // Cannot revoke primary admin
  assert.throws(() => {
    revokeUserByAdmin(acl, PRIMARY_ADMIN_EMAIL, PRIMARY_ADMIN_EMAIL);
  }, /amministratore principale/);

  // Cannot remove primary admin
  assert.throws(() => {
    removeUserRecordByAdmin(acl, PRIMARY_ADMIN_EMAIL, PRIMARY_ADMIN_EMAIL);
  }, /amministratore principale/);
});

test('mergeACLRecords preserves pending and authorized requests even if server ACL resets to initial bootstrap', () => {
  let localAcl = createInitialACL();
  localAcl = requestUserAccess(localAcl, {
    email: 'nuovo.utente@gmail.com',
    name: 'Nuovo Utente',
    note: 'Richiesta accesso'
  });

  const freshServerAcl = createInitialACL();
  const merged = mergeACLRecords(freshServerAcl, localAcl);

  const check = evaluateUserAccess('nuovo.utente@gmail.com', merged);
  assert.equal(check.status, 'PENDING');
  assert.equal(check.record?.email, 'nuovo.utente@gmail.com');
});

