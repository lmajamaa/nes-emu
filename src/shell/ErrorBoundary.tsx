import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

// A class, as React has no hook for catching render errors
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    override state: ErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(error, errorInfo.componentStack);
    }

    override render() {
        return this.state.hasError ? <h1>Something went wrong.</h1> : this.props.children;
    }
}

export default ErrorBoundary;
