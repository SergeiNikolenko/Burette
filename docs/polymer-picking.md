# Private native polymer role picking

P3a adds a source/model-bound one-atom pick transport, without activating a UI.
`capturePolymerPickOwner` uses the existing exact viewer target and the P2 source
snapshot. Native `graphBinding` checks the MOL/SDF parser-input SHA, one frame,
source-row elements and physical positions at native Float32 precision.

The runtime retains real structure/model/source ancestor objects and versions.
Replacement or Undo permanently retires this lifetime and notifies only its host
owner. Pick requests subscribe to actual MolStar interaction events; a singleton
locus maps through its real model's `atomSourceIndex`, including component-local
indices and interleaved explicit H. The BehaviorSubject's initial replay is ignored
because it occurred before arming this role. Foreign models, multi-atom/bond loci
and non-primary clicks cannot assign a role. No camera, global selection
granularity, molecular graph or source mutation is performed.

The private source-binding/pick/release messages have bounded input and are not
CLI/MCP commands. Pending native requests reuse existing cancellation/retired-ACK
transport. A caller releases the owner on close/source replacement and separately
cancels a superseded role pick. Native retirement must also invalidate prepared
polymer publication. A later role never reacquires a model behind older roles.

`vp run test:polymer-pick` executes real MolStar trajectories, native click
observables and the existing host request/ACK path. It is CPU runtime evidence,
not a Browser canvas gesture. `vp run typecheck:polymer-pick` checks the host API.

P3b still needs four explicitly armed role buttons in a modeless workflow,
source/model invalidation of all roles, cached atactic Preview/Create/retry,
duplicate pending Create gating, activation, and actual Browser gestures.
Automatic 3D preparation (03.08), relaxation, other end groups, copolymers and
existing-molecule insertion remain required later stage7 work.
