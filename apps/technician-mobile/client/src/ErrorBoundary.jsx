import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <pre style={{ whiteSpace: 'pre-wrap', padding: 16, color: 'crimson' }}>
          {String(this.state.error)}
        </pre>
      );
    }
    return this.props.children;
  }
}
