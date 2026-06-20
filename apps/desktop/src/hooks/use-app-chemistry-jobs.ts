import { useCallback, useEffect, useRef, useState } from "react";

import type { StatusKind } from "../components/types";
import {
  cancelConformerRequest,
  cancelXtbRequest,
  installXtbRequest,
  requestConformerStatus,
  requestXtbStatus,
} from "../lib/chemistry-job-requests";
import {
  conformerStatusLine,
  normalizeConformerSettings,
  normalizeXtbSettings,
  readConformerSettings,
  readXtbSettings,
  saveConformerSettings,
  saveXtbSettings,
} from "../lib/chemistry-settings";
import type {
  ConformerJob,
  ConformerSettings,
  ConformerStatus,
  XtbJob,
  XtbSettings,
  XtbStatus,
} from "../types";

type PushStatus = (message: string, kind?: StatusKind, details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type UseAppChemistryJobsOptions = {
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
};

export function useAppChemistryJobs({
  pushErrorStatus,
  pushStatus,
}: UseAppChemistryJobsOptions) {
  const [conformerStatus, setConformerStatus] = useState<ConformerStatus | null>(null);
  const [conformerSettings, setConformerSettingsState] = useState<ConformerSettings>(() => readConformerSettings());
  const [conformerJobs, setConformerJobs] = useState<ConformerJob[]>([]);
  const [xtbStatus, setXtbStatus] = useState<XtbStatus | null>(null);
  const [xtbSettings, setXtbSettingsState] = useState<XtbSettings>(() => readXtbSettings());
  const [xtbJobs, setXtbJobs] = useState<XtbJob[]>([]);
  const cancelledConformerJobIdsRef = useRef(new Set<string>());
  const cancelledXtbJobIdsRef = useRef(new Set<string>());

  const setConformerSettings = useCallback((settings: ConformerSettings) => {
    const normalized = normalizeConformerSettings(settings);
    setConformerSettingsState(normalized);
    saveConformerSettings(normalized);
  }, []);

  const checkConformerStatus = useCallback(async () => {
    try {
      const status = await requestConformerStatus();
      setConformerStatus(status);
      pushStatus(conformerStatusLine(status));
    } catch (error) {
      pushErrorStatus(error, "CREST/PRISM status failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const setXtbSettings = useCallback((settings: XtbSettings) => {
    const normalized = normalizeXtbSettings(settings);
    setXtbSettingsState(normalized);
    saveXtbSettings(normalized);
  }, []);

  const checkXtbStatus = useCallback(async () => {
    try {
      const status = await requestXtbStatus();
      setXtbStatus(status);
      pushStatus(status.installed ? `xTB ready: ${status.version ?? status.executablePath ?? "installed"}` : status.installHint, status.installed ? "success" : "error");
    } catch (error) {
      pushErrorStatus(error, "xTB status failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const installXtb = useCallback(async () => {
    try {
      pushStatus("Installing xTB...");
      const status = await installXtbRequest();
      setXtbStatus(status);
      pushStatus(status.installed ? `xTB installed: ${status.version ?? status.executablePath ?? "ready"}` : status.installHint, status.installed ? "success" : "error");
    } catch (error) {
      pushErrorStatus(error, "xTB install failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const cancelXtbJob = useCallback(async (jobId: string) => {
    cancelledXtbJobIdsRef.current.add(jobId);
    setXtbJobs((previous) => previous.map((job) => job.id === jobId && job.status === "running" ? {
      ...job,
      status: "cancelled",
      completedAt: Date.now(),
      error: "xTB job cancelled.",
    } : job));
    try {
      await cancelXtbRequest(jobId);
      pushStatus("xTB job cancelled");
    } catch (error) {
      pushErrorStatus(error, "Cancel xTB job failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const cancelConformerJob = useCallback(async (jobId: string) => {
    cancelledConformerJobIdsRef.current.add(jobId);
    setConformerJobs((previous) => previous.map((job) => job.id === jobId && job.status === "running" ? {
      ...job,
      status: "cancelled",
      completedAt: Date.now(),
      error: "Conformer job cancelled.",
    } : job));
    try {
      await cancelConformerRequest(jobId);
      pushStatus("Conformer job cancelled");
    } catch (error) {
      pushErrorStatus(error, "Cancel conformer job failed");
    }
  }, [pushErrorStatus, pushStatus]);

  useEffect(() => {
    let cancelled = false;
    void requestXtbStatus()
      .then((status) => {
        if (!cancelled) setXtbStatus(status);
      })
      .catch(() => {});
    void requestConformerStatus()
      .then((status) => {
        if (!cancelled) setConformerStatus(status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    cancelConformerJob,
    cancelXtbJob,
    cancelledConformerJobIdsRef,
    cancelledXtbJobIdsRef,
    checkConformerStatus,
    checkXtbStatus,
    conformerJobs,
    conformerSettings,
    conformerStatus,
    installXtb,
    setConformerJobs,
    setConformerSettings,
    setConformerStatus,
    setXtbJobs,
    setXtbSettings,
    setXtbStatus,
    xtbJobs,
    xtbSettings,
    xtbStatus,
  };
}
