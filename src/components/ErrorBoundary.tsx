import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { isChunkLoadError, reloadForChunkError } from '../lib/chunkReload';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  // Changing this value clears a caught error, e.g. when the user switches tab.
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
  reloading: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    if (isChunkLoadError(error) && reloadForChunkError()) {
      this.setState({ reloading: true });
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, reloading: false });
    }
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;

    const stale = isChunkLoadError(error);
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8 min-h-64 text-center">
        <AlertCircle className="w-8 h-8 text-rose-500" />
        <div>
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">
            {reloading
              ? 'Loading the latest version…'
              : stale
                ? 'A new version of Vitality Hub is available.'
                : 'Something went wrong showing this page.'}
          </p>
          {!reloading && !stale && (
            <p className="mt-1 text-sm text-zinc-500 break-words max-w-md">{error.message}</p>
          )}
        </div>
        {!reloading && (
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reload
          </button>
        )}
      </div>
    );
  }
}
