import { JobsPanel } from "../../jobs-panel";
import { definePageKind } from "./types";

export type JobsLocation = { kind: "jobs" };

// The Jobs list as a screen of its own, so it can sit in the main strip or the
// floating window next to the structure it is computing.
export const jobsKind = definePageKind<"jobs", JobsLocation>({
  kind: "jobs",
  title: () => "Jobs",
  description: "Calculations",
  keepAlive: true,
  Component: ({ state, actions }) => (
    <div className="screen-stage">
      <div className="screen-scroll">
        <JobsPanel state={state} actions={actions} variant="page" />
      </div>
    </div>
  ),
});
