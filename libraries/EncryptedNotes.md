---
name: Library/andresousadotpt/Encrypted Notes
tags: meta/library
files:
- encrypted-note.plug.js
---
# Encrypted Notes

Create a note with **Encrypted Note: New** and select an existing one with **Encrypted Note: Open**. Encrypted notes use the `.sben` extension. On every open, enter the note’s passphrase to decrypt it locally. A wrong passphrase or altered ciphertext shows an error and does not display the note.

Each save uses AES-256-GCM authenticated encryption with a fresh random salt and IV. The passphrase is never stored and cannot be recovered. Use a long, unique passphrase and keep a separate backup: losing the passphrase permanently loses the note.

Encryption protects the note contents at rest. File names, sizes, and timestamps are still visible. While unlocked, plaintext exists in the browser editor’s memory, so this is not protection against a compromised device, browser extension, or authorized client. Lock the note when finished; unsaved changes must be saved or explicitly discarded before locking.

[Source and limitations](https://github.com/andresousadotpt/silverbullet-plugs)
