import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';

const adminEmail = 'giuseppe.vitiello@gmail.com';
const aliceEmail = 'alice-fixture@gmail.com';
const bobEmail = 'bob-fixture@gmail.com';
const now = '2026-11-20T00:00:00.000Z';
const projectId = 'demo-supersmart';
let env;

function identity(uid, email, provider = 'google.com', verified = true) {
  return env.authenticatedContext(uid, {
    email, email_verified: verified, firebase: { sign_in_provider: provider, identities: {} },
  }).firestore();
}

function requestRecord(email, uid, status = 'PENDING') {
  return { uid, email, name: 'Fixture', role: 'USER', status, requestedAt: now, updatedAt: now };
}

function play(id, userEmail) {
  return {
    id, userEmail, createdAt: now, targetContestId: 'fixture', mode: 'manual',
    cost: 1, poolNumbers: [1, 2, 3, 4, 5, 6], columns: [{ numbers: [1, 2, 3, 4, 5, 6] }],
    status: 'IN_ATTESA',
  };
}

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Start the local Firestore emulator first.');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env?.cleanup());

test('signed identities cannot list accounts or self-approve; an Admin can grant and revoke', async () => {
  const guest = env.unauthenticatedContext().firestore();
  const alice = identity('alice', aliceEmail);
  const admin = identity('admin', adminEmail);
  const fakeAdmin = identity('fixture-password', adminEmail, 'password');
  const unverifiedAdmin = identity('fixture-unverified', adminEmail, 'google.com', false);
  const acl = db => doc(db, 'acl_verified', aliceEmail);
  const acct = db => doc(db, 'user_systems', aliceEmail);
  await assertFails(getDocs(collection(guest, 'acl')));
  await assertFails(getDocs(collection(guest, 'acl_verified')));
  await assertFails(getDocs(collection(fakeAdmin, 'acl_verified')));
  await assertFails(getDocs(collection(unverifiedAdmin, 'acl_verified')));
  await assertFails(getDocs(collection(alice, 'acl_verified')));
  await assertFails(setDoc(acl(alice), requestRecord(aliceEmail, 'alice', 'AUTHORIZED')));
  await assertSucceeds(setDoc(acl(alice), requestRecord(aliceEmail, 'alice')));
  await assertSucceeds(getDoc(acl(alice)));
  await assertFails(updateDoc(acl(alice), { status: 'AUTHORIZED' }));
  await assertFails(getDoc(acct(alice)));
  await assertSucceeds(getDocs(collection(admin, 'acl_verified')));
  await assertSucceeds(updateDoc(acl(admin), { status: 'AUTHORIZED', updatedAt: now }));
  await assertSucceeds(getDoc(acct(alice)));
  await assertFails(getDoc(acct(identity('different-uid', aliceEmail))));
  await assertSucceeds(updateDoc(acl(admin), { status: 'REJECTED', updatedAt: now }));
  await assertFails(getDoc(acct(alice)));
});

test('approved users read only their own data and delete only their own saved plays', async () => {
  const admin = identity('admin', adminEmail);
  const bob = identity('bob', bobEmail);
  const acct = db => doc(db, 'acl_verified', bobEmail);
  await assertSucceeds(setDoc(acct(bob), requestRecord(bobEmail, 'bob')));
  await assertSucceeds(updateDoc(acct(admin), { status: 'AUTHORIZED', updatedAt: now }));
  await assertSucceeds(getDoc(doc(bob, 'user_systems', `camel::${bobEmail}`)));
  await assertFails(getDoc(doc(bob, 'user_systems', `wfi::${aliceEmail}`)));
  await assertFails(getDocs(collection(bob, 'plays')));
  await assertSucceeds(getDocs(query(collection(bob, 'plays'), where('userEmail', '==', bobEmail))));
  await assertFails(setDoc(doc(bob, 'plays', 'foreign'), play('foreign', aliceEmail)));
  await assertSucceeds(setDoc(doc(bob, 'plays', 'own'), play('own', bobEmail)));
  await assertFails(updateDoc(doc(bob, 'plays', 'own'), { userEmail: aliceEmail }));
  await assertFails(deleteDoc(doc(bob, 'custom_draws', 'fixture')));
  const batch = writeBatch(bob);
  batch.delete(doc(bob, 'plays', 'own'));
  batch.set(doc(bob, 'deleted_plays', 'own'), { id: 'own', deletedAt: now, userEmail: bobEmail });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDocs(query(collection(bob, 'deleted_plays'), where('userEmail', '==', bobEmail))));
  await assertFails(setDoc(doc(bob, 'plays', 'own'), play('own', bobEmail)));
});
