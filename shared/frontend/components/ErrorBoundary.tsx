import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import { Language } from '../types';
import { t } from '../i18n/translations';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  language?: Language;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center bg-rose-50 border border-rose-200 rounded-2xl my-4 max-w-md mx-auto">
          <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 mb-3 shadow-sm">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-1">
            {this.props.fallbackTitle || t(this.props.language || 'en', 'errorBoundary.title')}
          </h3>
          <p className="text-sm text-slate-600 mb-4">
            {t(this.props.language || 'en', 'errorBoundary.text')}
          </p>

          {this.state.error && (
            <div className="w-full bg-white/80 p-3 rounded-lg border border-rose-200/60 text-start mb-4 overflow-auto max-h-36">
              <p className="text-xs font-mono text-rose-700 font-semibold break-all">
                {this.state.error.name}: {this.state.error.message}
              </p>
            </div>
          )}

          <div className="flex gap-2 w-full">
            <button
              onClick={this.handleReset}
              className="flex-1 py-2.5 px-3 bg-white border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 transition flex items-center justify-center gap-1.5 shadow-sm"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t(this.props.language || 'en', 'errorBoundary.tryAgain')}
            </button>
            <button
              onClick={this.handleReload}
              className="flex-1 py-2.5 px-3 bg-blue-900 text-white rounded-xl text-xs font-semibold hover:bg-blue-800 transition flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Home className="w-3.5 h-3.5" />
              {t(this.props.language || 'en', 'errorBoundary.reload')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
