"use client";

import * as React from "react";

// A failed parse updates the outer FileThumbnail state so it degrades to the
// shared fallback surface instead of an empty preview layer.
export class ThumbnailErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    fallback: React.ReactNode;
    onError: (error: unknown) => void;
  },
  { failed: boolean }
> {
  constructor(props: {
    children: React.ReactNode;
    fallback: React.ReactNode;
    onError: (error: unknown) => void;
  }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
