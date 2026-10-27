import { Component } from 'react'

// Last line of defence: a render error anywhere used to leave a
// blank white page — fatal for a grandparent on a phone who has no
// idea what to do about it. This shows a plain message and a button
// instead. (React error boundaries must be class components.)
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    // Visible in the browser console for debugging; nothing is sent anywhere.
    console.error('Toy Library render error', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="page narrow">
        <h1>Something went wrong</h1>
        <p>This page hit a snag. Reloading usually fixes it.</p>
        <button className="btn" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </main>
    )
  }
}
