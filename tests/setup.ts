// Test setup file
// Mock any browser APIs that might be needed
global.console = {
  ...console,
  log: console.log,
  warn: console.warn,
  error: console.error,
};
