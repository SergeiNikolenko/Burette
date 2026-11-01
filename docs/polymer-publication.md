# Native validation before polymer document adoption

The host cannot synchronously observe an internal native model change: retirement
notifications are queued messages. A cached host receipt alone is insufficient
while a new document is being prepared.

`openStructureRecords` accepts an optional host-only `validateBeforeAdopt` callback
for its direct text-record preparation/adoption route. It runs once after actual
document preparation and before the existing final `shouldApply` check and
synchronous insertion. False releases the unadopted documents and returns none;
throw/abort releases them and propagates the error. The existing source/request
guard is checked again after the awaited callback. Callers that omit the callback
and the existing folder-save path retain their behavior. The callback is never
included in serialized Tauri arguments or CLI/tool contracts.

The prepared polymer owner forwards this callback. Its native picking owner now
provides `validate()`, an ACK against the retained lease's existing current-model
check. It never rebinds an old calculation to a replacement model. A native change
or Undo before this validation rejects even when its retirement notification is
still withheld. The native validation ACK is the explicit acceptance point;
this is not an atomic cross-frame transaction or knowledge of future changes.
Subsequent host source/request cancellation remains covered by the final guard.

`vp run test:polymer-publication` uses actual compiled polymer work, real source
and document-open hooks, real native MolStar model changes/Undo, and queued
host/native message delivery. It covers held preparation with retirement withheld,
late cancellation/request replacement during a held successful ACK, false/throw/
abort cleanup, and independent repeated Create with identical cached SDF. Existing
callers and their original tests remain unchanged. Browser UI/picks/activation,
automatic 3D preparation, relaxation and the remaining full stage7 scope remain
separate requirements.
