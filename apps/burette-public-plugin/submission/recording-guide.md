# One-command recording guide

Do not record submission evidence until the candidate is deployed, its live
preflight passes, and the ChatGPT connector has been refreshed. A successful
local build or browser fixture is not production acceptance.

In a fresh conversation with Burette enabled, send exactly one message:

> Use Burette to open public PDB 1CRN as an interactive 3D molecular view, then open Ketcher with ethanol from SMILES CCO. Keep both results available. Use English only. Do not ask me to attach any files. Wait until the views are ready before reporting success.

Record a continuous 1–2 minute clip showing the host application frame:

1. Send the message and show loading through the visible results. The PDB
   result should report 327 atoms, 46 residues and 1 chain; ethanol has 3 atoms
   and 2 bonds. Do not accept an assistant acknowledgement over a blank view.
2. Rotate and zoom 1CRN, expand its toolbar, and select a visible residue.
3. Open the host's expanded display mode if offered, then return to the chat.
   No custom widget resize handle or duplicate bottom dock should appear.
4. Show the ethanol sketch, open Settings, change Rotation Step to 30, apply,
   and reopen Settings to confirm the value. Close without changing the sketch.
5. Press SDF where the host supports downloads and verify the downloaded file.
   A host-capability error is not a successful export.
6. Return to the molecular result, then the editor; collapse/expand both and
   confirm neither is blank. Hosted results are separate cards, not custom tabs.

Repeat on ChatGPT web and a physical iPhone (portrait and landscape). Check
light and dark appearance, clipping, touch rotation/zoom, and one app
background/foreground cycle. Record the device/app versions and date separately.
Responsive emulation is engineering evidence, not an iPhone recording.

Codex is a separate compatibility check. Record whether the hosted connector
or the installed local plugin was used; do not substitute the local plugin's
native pane for proof of the hosted ChatGPT app. For the local plugin, also
check tab switching, dragging/reordering and preserved contents in its pane.

This short demo does not replace the full five-positive/three-negative review
matrix in `manual-review-checklist.md`. Do not show developer tokens, internal
metadata, environment variables, private files or unrelated conversations.
