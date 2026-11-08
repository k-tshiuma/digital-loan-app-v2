// Prefixes every console line with the backend's name ("[borrower]" / "[admin]") so the two processes'
// logs can be told apart when they share a terminal or a log collector.
function prefixConsole(name) {
  for (const method of ['log', 'info', 'warn', 'error']) {
    const original = console[method].bind(console);
    console[method] = (...args) => original(`[${name}]`, ...args);
  }
}

module.exports = { prefixConsole };
