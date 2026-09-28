// libsodium "sealed box" (crypto_box_seal), the format GitHub requires for Actions secrets.
// The value is encrypted in the browser with the repository public key; nobody but
// GitHub Actions can decrypt it, not even this app.

import { blake2b } from '@noble/hashes/blake2.js';
import nacl from 'tweetnacl';

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

// nonce = BLAKE2b-192(ephemeral public key || recipient public key)
function sealNonce(ephemeralPublicKey, recipientPublicKey) {
  const input = new Uint8Array(ephemeralPublicKey.length + recipientPublicKey.length);
  input.set(ephemeralPublicKey);
  input.set(recipientPublicKey, ephemeralPublicKey.length);
  return blake2b(input, { dkLen: nacl.box.nonceLength });
}

export function sealSecret(plaintext, recipientPublicKeyBase64) {
  const recipient = base64ToBytes(recipientPublicKeyBase64);
  const ephemeral = nacl.box.keyPair();
  const box = nacl.box(new TextEncoder().encode(plaintext), sealNonce(ephemeral.publicKey, recipient), recipient, ephemeral.secretKey);

  const sealed = new Uint8Array(ephemeral.publicKey.length + box.length);
  sealed.set(ephemeral.publicKey);
  sealed.set(box, ephemeral.publicKey.length);
  return bytesToBase64(sealed);
}

/** Inverse of sealSecret, only used by the tests to prove the format. */
export function openSealedSecret(sealedBase64, recipientKeyPair) {
  const sealed = base64ToBytes(sealedBase64);
  const ephemeralPublicKey = sealed.slice(0, nacl.box.publicKeyLength);
  const box = sealed.slice(nacl.box.publicKeyLength);
  const opened = nacl.box.open(box, sealNonce(ephemeralPublicKey, recipientKeyPair.publicKey), ephemeralPublicKey, recipientKeyPair.secretKey);
  return opened ? new TextDecoder().decode(opened) : null;
}
