# Office vault (기억)

Standing knowledge every AI app that works for the owner shares across Works. A Work's own request and directions hold
what only it needs (its accounts, its selection rules); the vault holds what applies to many Works: how results are
written, which sources count, what needs the owner's say, how a tool should be used, and where things are on this
computer.

- **Where**: one Markdown file per note in `<state>/data/vault/` (for a profile, that profile's state folder). A small
  header (`id`, `layer`, `scope`, `match`, `status`, `source`, `confirmed`, optional `why`) and the note itself. The notes
  never go into the repository.
- **Layers**: boundary, quality, source, operation, tool, owner, environment.
- **Which notes a run gets**: every active note without keywords, and those whose keywords the Work's title, request or
  directions name (a keyword of up to three letters, such as `X`, matches as a whole word). They go into the run's first
  prompt after the tool notes, boundaries first, within about 8,000 characters. The Work's own request and directions
  win where they differ.
- **Who writes**: the owner on the Memory page (add, edit, retire, restore), or with **Apply to every Work · keep in
  Memory** when sending a direction to a Work. A run may save `VAULT.json` (up to five proposals); they appear on the
  Memory page and as one feed post, and apply only after the owner approves them. A run reads the web, so what it
  learned is not trusted until the owner says so.
- **Refused**: text that looks like a secret, and a note with the same text as another.
- **Shipped notes**: Office writes its general tool notes (how to word X searches through Grok Build, how X Articles
  are found) when a vault lacks them; the owner may change or retire them, and a retired note stays retired.
