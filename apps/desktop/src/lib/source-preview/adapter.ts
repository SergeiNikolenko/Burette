import type {
  SourcePreviewCandidate,
  SourcePreviewFrameSnapshot,
  SourcePreviewIdentity,
  SourcePreviewPromotionResult,
  SourcePreviewRuntime,
  SourcePreviewSlot,
  SourcePreviewStageFailure,
  SourcePreviewTransferContext,
} from "./types";

type SourcePreviewAdapterOptions = {
  activeRuntime: SourcePreviewRuntime;
  onChange: (snapshot: SourcePreviewFrameSnapshot) => void;
  onStageFailure?: (identity: SourcePreviewIdentity, reason: SourcePreviewStageFailure) => void;
  stageTimeoutMs?: number;
  transferBudgetMs?: number;
};

const DEFAULT_STAGE_TIMEOUT_MS = 10_000;
const DEFAULT_TRANSFER_BUDGET_MS = 150;

function otherSlot(slot: SourcePreviewSlot): SourcePreviewSlot {
  return slot === "primary" ? "secondary" : "primary";
}

function matchesIdentity(candidate: SourcePreviewRuntime | null, identity: SourcePreviewIdentity): candidate is SourcePreviewCandidate {
  const current = candidate?.identity;
  return current?.documentId === identity.documentId
    && current.sessionId === identity.sessionId
    && current.requestId === identity.requestId
    && current.revision === identity.revision;
}

function immutableSnapshot(
  activeSlot: SourcePreviewSlot,
  primary: SourcePreviewRuntime | null,
  secondary: SourcePreviewRuntime | null,
): SourcePreviewFrameSnapshot {
  return {
    activeSlot,
    slots: { primary, secondary },
  };
}

async function withinBudget(work: Promise<void>, budgetMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class SourcePreviewAdapter {
  private activeSlot: SourcePreviewSlot = "primary";
  private slots: Record<SourcePreviewSlot, SourcePreviewRuntime | null>;
  private stageTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly options: SourcePreviewAdapterOptions) {
    this.slots = { primary: options.activeRuntime, secondary: null };
  }

  getSnapshot(): SourcePreviewFrameSnapshot {
    return immutableSnapshot(this.activeSlot, this.slots.primary, this.slots.secondary);
  }

  stage(candidate: SourcePreviewCandidate): SourcePreviewFrameSnapshot {
    this.assertActive();
    const stagingSlot = otherSlot(this.activeSlot);
    const previous = this.slots[stagingSlot];
    if (previous?.identity) {
      this.options.onStageFailure?.(previous.identity, "superseded");
    }
    this.clearStageTimer();
    this.slots = { ...this.slots, [stagingSlot]: candidate };
    this.stageTimer = setTimeout(() => {
      if (!matchesIdentity(this.slots[stagingSlot], candidate.identity)) return;
      this.slots = { ...this.slots, [stagingSlot]: null };
      this.stageTimer = undefined;
      this.options.onStageFailure?.(candidate.identity, "timed-out");
      this.emit();
    }, this.options.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS);
    this.emit();
    return this.getSnapshot();
  }

  reject(identity: SourcePreviewIdentity): boolean {
    this.assertActive();
    const stagingSlot = otherSlot(this.activeSlot);
    if (!matchesIdentity(this.slots[stagingSlot], identity)) return false;
    this.clearStageTimer();
    this.slots = { ...this.slots, [stagingSlot]: null };
    this.options.onStageFailure?.(identity, "rejected");
    this.emit();
    return true;
  }

  async ready(
    identity: SourcePreviewIdentity,
    transferViewState?: (context: SourcePreviewTransferContext) => Promise<void>,
  ): Promise<SourcePreviewPromotionResult> {
    this.assertActive();
    const stagingSlot = otherSlot(this.activeSlot);
    const staging = this.slots[stagingSlot];
    const active = this.slots[this.activeSlot];
    if (!active || !matchesIdentity(staging, identity)) return { status: "stale" };

    this.clearStageTimer();
    if (transferViewState) {
      await withinBudget(
        transferViewState({ active, staging }),
        this.options.transferBudgetMs ?? DEFAULT_TRANSFER_BUDGET_MS,
      );
    }

    if (this.disposed || !matchesIdentity(this.slots[stagingSlot], identity)) {
      return { status: "stale" };
    }
    this.activeSlot = stagingSlot;
    this.slots = { ...this.slots, [otherSlot(stagingSlot)]: null };
    this.emit();
    return { status: "promoted", revision: identity.revision };
  }

  resetActive(activeRuntime: SourcePreviewRuntime): SourcePreviewFrameSnapshot {
    this.assertActive();
    const previousStage = this.slots[otherSlot(this.activeSlot)];
    if (previousStage?.identity) {
      this.options.onStageFailure?.(previousStage.identity, "superseded");
    }
    this.clearStageTimer();
    this.activeSlot = "primary";
    this.slots = { primary: activeRuntime, secondary: null };
    this.emit();
    return this.getSnapshot();
  }

  dispose(): void {
    if (this.disposed) return;
    const stage = this.slots[otherSlot(this.activeSlot)];
    if (stage?.identity) {
      this.options.onStageFailure?.(stage.identity, "superseded");
    }
    this.clearStageTimer();
    this.disposed = true;
    this.slots = { primary: null, secondary: null };
  }

  private emit(): void {
    this.options.onChange(this.getSnapshot());
  }

  private clearStageTimer(): void {
    if (this.stageTimer === undefined) return;
    clearTimeout(this.stageTimer);
    this.stageTimer = undefined;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Source preview adapter is disposed");
  }
}
