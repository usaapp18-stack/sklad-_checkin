import React from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Произошла непредвиденная ошибка интерфейса',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught UI error:', error, errorInfo);
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  handleGoHome = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="min-h-screen min-h-[100dvh] bg-[#f7f9ff] text-[#111111] flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white border border-[#d9dbe0] rounded-md p-6 sm:p-8 space-y-4 text-center">
            <AlertTriangle className="w-7 h-7 text-rose-600 mx-auto" />
            <div className="space-y-1.5">
              <h1 className="text-lg font-bold text-[#111111]">
                {this.props.fallbackTitle || 'Ошибка отображения раздела'}
              </h1>
              <p className="text-xs sm:text-sm text-[#5d6270] leading-relaxed">
                Возник сбой при отрисовке страницы. Ваши данные в системе сохранены.
              </p>
              {this.state.errorMessage && (
                <p className="text-xs font-mono text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 break-words">
                  {this.state.errorMessage}
                </p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white text-xs font-semibold rounded inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Обновить страницу</span>
              </button>
              <button
                type="button"
                onClick={this.handleGoHome}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 bg-white hover:bg-[#f7f9ff] text-[#111111] border border-[#d9dbe0] text-xs font-semibold rounded inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Home className="w-4 h-4" />
                <span>На главную</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
