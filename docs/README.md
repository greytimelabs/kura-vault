# Kura Vault documentation

Start with the pages in the first table; they describe the project as it is
today. The design records and the archive explain how it got here and are not
kept in sync with the code.

## Current

| Page | What it covers |
|---|---|
| [Getting started](getting-started.md) | Running the database, API, web client, mobile app and import CLI locally; running the tests |
| [Architecture](architecture.md) | Components, accounts and sharing, setup, upload and viewing flows, the API surface |
| [Cryptography](crypto/README.md) | Algorithms, key hierarchy, how public keys are trusted, wire format, the shared test vectors |
| [Security model](security.md) | What is protected, the rules the code follows, known limits |
| [Database](database/README.md) | Tables, relationships, known gaps; the schema itself is [`schema.dbml`](database/schema.dbml) |

## Design records

Decisions, each written at the time it was made. Numbered in order.

| Record | Decision |
|---|---|
| [0001 System design](design/0001-system-design.md) | The original design: threat model, envelope encryption, multi-vault model, storage tiers, cost estimate |
| [0002 Canonical DBML schema](design/0002-canonical-dbml-schema.md) | One schema file as the source of truth for the data model |
| [0003 Liked album](design/0003-liked-album-replaces-favorites.md) | Per-user "Liked" album replaces per-media favourite and archive flags |
| [0004 React web client](design/0004-react-web-client.md) | A dedicated React web client replaces Flutter web; all clients standardise on Argon2id |
| [0005 Accounts, key pairs and sharing](design/0005-accounts-keys-sharing.md) | Owner-managed accounts, a key pair per user, vault and album sharing by re-wrapping keys |

## Archive

The [original build plans](archive/README.md) the first version was written
from. Useful for background; expect them to disagree with the code.
